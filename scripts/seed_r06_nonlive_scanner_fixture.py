#!/usr/bin/env python3
"""Create one isolated, deterministic Local-US cache for the R06 test fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from typing import Mapping

import exchange_calendars as xcals
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.services.market_scanner_service import MarketScannerService
from src.services.r06_nonlive_scanner_fixture import (
    R06_CACHE_DIRECTORY,
    R06_FIXTURE_DESCRIPTOR_ENV,
    R06_FIXTURE_LIFECYCLE_ROOT_ENV,
    R06_FIXTURE_MANIFEST_ENV,
    R06_FIXTURE_MANIFEST_SHA256_ENV,
    R06_FIXTURE_ROOT_ENV,
    R06_RUNTIME_MANIFEST_SCHEMA,
    _is_explicit_false,
    _validate_descriptor,
)
from src.services.us_history_helper import persist_local_us_daily_history


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", required=True, type=Path)
    parser.add_argument("--descriptor", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _require_test_no_live_environment(os.environ)
    raw_run_root = args.run_root.expanduser()
    raw_descriptor_path = args.descriptor.expanduser()
    if raw_run_root.is_symlink() or raw_descriptor_path.is_symlink():
        raise ValueError("run_root_or_descriptor_symlink")
    run_root = raw_run_root.resolve()
    descriptor_path = raw_descriptor_path.resolve()
    canonical_descriptor = ROOT / "tests" / "fixtures" / "scanner" / "r06_nonlive_us_data_ready_v1.json"
    if descriptor_path != canonical_descriptor or not descriptor_path.is_file():
        raise ValueError("descriptor_invalid")
    if _is_within(run_root, ROOT) or run_root.is_symlink() or not run_root.parent.is_dir() or run_root.parent.is_symlink():
        raise ValueError("run_root_must_be_outside_repository")
    if run_root.exists() or run_root.parent.resolve() == run_root.resolve():
        raise ValueError("run_root_must_be_new")

    descriptor = _read_json(descriptor_path)
    _validate_descriptor(descriptor)
    expected_session = MarketScannerService._latest_expected_us_session()
    if expected_session is None:
        raise ValueError("us_session_calendar_unavailable")

    run_root.mkdir(mode=0o700, parents=False)
    cache_root = run_root / R06_CACHE_DIRECTORY
    lifecycle_root = run_root / "scanner-universe-lifecycle"
    lifecycle_root.mkdir(mode=0o700)
    outputs = _write_outputs(cache_root, descriptor=descriptor, expected_session=expected_session)
    manifest_path = run_root / "r06-nonlive-scanner-runtime-manifest.json"
    manifest = {
        "schemaVersion": R06_RUNTIME_MANIFEST_SCHEMA,
        "fixtureId": descriptor["fixtureId"],
        "fixtureVersion": descriptor["fixtureVersion"],
        "descriptorSha256": _sha256_file(descriptor_path),
        "expectedSession": expected_session.isoformat(),
        "runRootId": run_root.name,
        "cacheDirectory": R06_CACHE_DIRECTORY,
        "lifecycleDirectory": lifecycle_root.name,
        "outputs": outputs,
        "noExternalCalls": True,
        "providerCallsEnabled": False,
    }
    _write_json_exclusive(manifest_path, manifest)
    manifest_sha256 = _sha256_file(manifest_path)

    environment = {
        "APP_ENV": "test",
        "WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS": "true",
        "WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED": "false",
        "WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED": "false",
        "LOCAL_US_PARQUET_DIR": str(cache_root),
        "US_STOCK_PARQUET_DIR": "",
        R06_FIXTURE_LIFECYCLE_ROOT_ENV: str(lifecycle_root),
        R06_FIXTURE_ROOT_ENV: str(run_root),
        R06_FIXTURE_DESCRIPTOR_ENV: str(descriptor_path),
        R06_FIXTURE_MANIFEST_ENV: str(manifest_path),
        R06_FIXTURE_MANIFEST_SHA256_ENV: manifest_sha256,
    }
    print(json.dumps({"environment": environment, "manifest": manifest}, sort_keys=True))
    return 0


def _require_test_no_live_environment(env: Mapping[str, str]) -> None:
    if str(env.get("APP_ENV") or "").strip().lower() != "test":
        raise ValueError("test_environment_required")
    if str(env.get("WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS") or "").strip().lower() != "true":
        raise ValueError("no_live_gate_required")
    if not _is_explicit_false(env.get("WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED")):
        raise ValueError("live_provider_gate_enabled")
    if not _is_explicit_false(env.get("WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED")):
        raise ValueError("live_provider_gate_enabled")
    if str(env.get("WOLFYSTOCK_UAT_LIVE_PROVIDER_ALLOWLIST") or "").strip():
        raise ValueError("live_provider_allowlist_not_empty")


def _write_outputs(cache_root: Path, *, descriptor: Mapping[str, object], expected_session) -> list[dict[str, object]]:
    history_bars = int(descriptor["historyBars"])
    calendar = xcals.get_calendar("XNYS")
    sessions = calendar.sessions_in_range(expected_session - timedelta(days=history_bars * 4), expected_session)
    session_dates = [session.date() for session in sessions[-history_bars:]]
    if len(session_dates) != history_bars or session_dates[-1] != expected_session:
        raise ValueError("expected_session_mismatch")

    outputs: list[dict[str, object]] = []
    seed = descriptor["deterministicOhlcvSeed"]
    assert isinstance(seed, Mapping)
    for offset, item in enumerate(descriptor["symbols"]):
        assert isinstance(item, Mapping)
        symbol = str(item["symbol"]).upper()
        frame = _deterministic_ohlcv_frame(
            session_dates,
            price_start=float(seed["priceStart"]),
            price_step=float(seed["priceStep"]),
            volume_start=int(seed["volumeStart"]),
            volume_step=int(seed["volumeStep"]),
            price_offset=offset * 25.0,
        )
        persisted = persist_local_us_daily_history(symbol, frame, parquet_dir=cache_root)
        if persisted.status != "saved" or persisted.rows != history_bars or persisted.path.parent.resolve() != cache_root.resolve():
            raise ValueError("fixture_persist_failed")
        output_path = persisted.path.resolve()
        outputs.append(
            {
                "symbol": symbol,
                "file": output_path.name,
                "sha256": _sha256_file(output_path),
                "rows": persisted.rows,
                "firstSession": session_dates[0].isoformat(),
                "lastSession": session_dates[-1].isoformat(),
                "asOf": f"{expected_session.isoformat()}T00:00:00Z",
            }
        )
    return outputs


def _deterministic_ohlcv_frame(
    session_dates,
    *,
    price_start: float,
    price_step: float,
    volume_start: int,
    volume_step: int,
    price_offset: float,
) -> pd.DataFrame:
    records = []
    for index, session_date in enumerate(session_dates):
        close = price_start + price_offset + index * price_step
        volume = volume_start + index * volume_step
        records.append(
            {
                "date": session_date.isoformat(),
                "open": close - 0.25,
                "high": close + 0.5,
                "low": close - 0.5,
                "close": close,
                "volume": volume,
                "amount": close * volume,
                "pct_chg": price_step,
                "adjusted_close": close,
            }
        )
    return pd.DataFrame(records)


def _read_json(path: Path) -> Mapping[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise ValueError("descriptor_invalid")
    return value


def _write_json_exclusive(path: Path, value: Mapping[str, object]) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        handle.write("\n")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return False
    return True


if __name__ == "__main__":
    raise SystemExit(main())
