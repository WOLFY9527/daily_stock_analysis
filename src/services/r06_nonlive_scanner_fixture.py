"""Strict, run-scoped provenance for the R06 non-live Scanner fixture.

The fixture is intentionally opt-in.  A normal local-US cache keeps its
existing semantics unless every R06 environment input, descriptor, manifest,
and cache output passes validation.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Mapping

import exchange_calendars as xcals
import numpy as np
import pandas as pd

from src.services.us_ohlcv_coverage_readiness import starter_us_ohlcv_coverage_symbols
from src.services.us_history_helper import get_configured_us_stock_parquet_dir


R06_FIXTURE_ROOT_ENV = "WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_ROOT"
R06_FIXTURE_DESCRIPTOR_ENV = "WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_DESCRIPTOR"
R06_FIXTURE_MANIFEST_ENV = "WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_MANIFEST"
R06_FIXTURE_MANIFEST_SHA256_ENV = "WOLFYSTOCK_R06_NONLIVE_SCANNER_FIXTURE_MANIFEST_SHA256"
R06_FIXTURE_LIFECYCLE_ROOT_ENV = "SCANNER_UNIVERSE_LIFECYCLE_ROOT"
R06_FIXTURE_ENV_KEYS = (
    R06_FIXTURE_ROOT_ENV,
    R06_FIXTURE_DESCRIPTOR_ENV,
    R06_FIXTURE_MANIFEST_ENV,
    R06_FIXTURE_MANIFEST_SHA256_ENV,
)
R06_DESCRIPTOR_SCHEMA = "wolfystock.r06.nonlive-us-scanner-fixture.v1"
R06_RUNTIME_MANIFEST_SCHEMA = "wolfystock.r06.nonlive-us-scanner-runtime-manifest.v1"
R06_CACHE_DIRECTORY = "cache"
# This label is deliberately distinct from a normal local cache.  Every
# consumer that receives an R06 bar must preserve its qualification-only
# provenance instead of recovering ordinary cache authority from its path.
R06_NONLIVE_QUALIFICATION_SOURCE = "r06_nonlive_qualification_fixture"


class R06NonliveScannerFixtureContextError(ValueError):
    """A requested R06 fixture context was incomplete or untrustworthy."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class R06NonliveScannerFixtureContext:
    """Validated, non-secret identity for one isolated fixture run."""

    fixture_id: str
    fixture_version: str
    expected_session: date
    cache_root: Path
    run_root: Path
    descriptor_sha256: str
    manifest_sha256: str
    output_hashes: Mapping[str, str]
    symbols: tuple[str, ...]

    source: str = "fixture"
    source_type: str = "synthetic_fixture"
    no_external_calls: bool = True
    provider_calls_enabled: bool = False
    observation_only: bool = True

    def matches_symbol(self, symbol: str) -> bool:
        return str(symbol or "").strip().upper() in self.symbols

    def require_expected_session(self, expected_session: date | None) -> None:
        if expected_session != self.expected_session:
            raise R06NonliveScannerFixtureContextError("expected_session_mismatch")


def resolve_optional_r06_nonlive_scanner_fixture_context(
    env: Mapping[str, str] | None = None,
) -> R06NonliveScannerFixtureContext | None:
    """Return the fixture context only when it was completely requested.

    The normal cache path deliberately remains untouched when none of the R06
    fixture knobs are present.  A partial request is an error, not a fallback.
    """

    source = os.environ if env is None else env
    requested_values = {key: str(source.get(key, "") or "").strip() for key in R06_FIXTURE_ENV_KEYS}
    if not any(key in source for key in R06_FIXTURE_ENV_KEYS):
        return None
    if not all(requested_values.values()):
        raise R06NonliveScannerFixtureContextError("fixture_context_incomplete")

    if str(source.get("APP_ENV", "") or "").strip().lower() != "test":
        raise R06NonliveScannerFixtureContextError("test_environment_required")
    if not _is_true(source.get("WOLFYSTOCK_UAT_NO_LIVE_PROVIDERS")):
        raise R06NonliveScannerFixtureContextError("no_live_gate_required")
    if not _is_explicit_false(source.get("WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED")):
        raise R06NonliveScannerFixtureContextError("live_provider_gate_enabled")
    if not _is_explicit_false(source.get("WOLFYSTOCK_YFINANCE_US_OHLCV_CACHE_ENABLED")):
        raise R06NonliveScannerFixtureContextError("live_provider_gate_enabled")
    if str(source.get("WOLFYSTOCK_UAT_LIVE_PROVIDER_ALLOWLIST", "") or "").strip():
        raise R06NonliveScannerFixtureContextError("live_provider_allowlist_not_empty")

    run_root = _resolved_existing_directory(requested_values[R06_FIXTURE_ROOT_ENV], "run_root_not_isolated")
    descriptor_path = _resolved_existing_file(requested_values[R06_FIXTURE_DESCRIPTOR_ENV], "descriptor_invalid")
    manifest_path = _resolved_existing_file(requested_values[R06_FIXTURE_MANIFEST_ENV], "manifest_invalid")
    canonical_descriptor = _repository_roots()[0] / "tests" / "fixtures" / "scanner" / "r06_nonlive_us_data_ready_v1.json"
    if descriptor_path != canonical_descriptor.resolve():
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    if any(_is_within(run_root, root) for root in _repository_roots()):
        raise R06NonliveScannerFixtureContextError("run_root_not_isolated")
    if manifest_path.parent != run_root or manifest_path.name != "r06-nonlive-scanner-runtime-manifest.json":
        raise R06NonliveScannerFixtureContextError("run_root_not_isolated")

    configured_cache_root = get_configured_us_stock_parquet_dir(source)
    cache_root = (run_root / R06_CACHE_DIRECTORY).resolve()
    if configured_cache_root is None or configured_cache_root.expanduser().resolve() != cache_root:
        raise R06NonliveScannerFixtureContextError("cache_root_mismatch")
    secondary_cache_root = str(source.get("US_STOCK_PARQUET_DIR", "") or "").strip()
    if secondary_cache_root and Path(secondary_cache_root).expanduser().resolve() != cache_root:
        raise R06NonliveScannerFixtureContextError("cache_root_mismatch")
    lifecycle_root = _resolved_existing_directory(
        str(source.get(R06_FIXTURE_LIFECYCLE_ROOT_ENV, "") or ""),
        "run_root_not_isolated",
    )
    if not cache_root.is_dir() or cache_root.parent != run_root or lifecycle_root.parent != run_root:
        raise R06NonliveScannerFixtureContextError("run_root_not_isolated")

    manifest_sha256 = requested_values[R06_FIXTURE_MANIFEST_SHA256_ENV].lower()
    if not _is_sha256(manifest_sha256):
        raise R06NonliveScannerFixtureContextError("manifest_hash_mismatch")
    if _sha256_file(manifest_path) != manifest_sha256:
        raise R06NonliveScannerFixtureContextError("manifest_hash_mismatch")

    descriptor = _read_json(descriptor_path, "descriptor_invalid")
    manifest = _read_json(manifest_path, "manifest_invalid")
    descriptor_sha256 = _sha256_file(descriptor_path)
    _validate_descriptor(descriptor)
    _validate_manifest(
        manifest,
        descriptor=descriptor,
        descriptor_sha256=descriptor_sha256,
        run_root=run_root,
        lifecycle_root=lifecycle_root,
    )

    symbols = tuple(item["symbol"] for item in descriptor["symbols"])
    outputs = manifest["outputs"]
    output_hashes: dict[str, str] = {}
    expected_paths: set[Path] = set()
    for item in outputs:
        symbol = str(item["symbol"])
        output_path = (cache_root / str(item["file"])).resolve()
        if output_path.parent != cache_root or output_path.suffix != ".parquet" or output_path.is_symlink():
            raise R06NonliveScannerFixtureContextError("unexpected_cache_output")
        if not output_path.is_file() or _sha256_file(output_path) != str(item["sha256"]):
            raise R06NonliveScannerFixtureContextError("output_hash_mismatch")
        _validate_output_frame(output_path, item=item, expected_session=str(manifest["expectedSession"]))
        expected_paths.add(output_path)
        output_hashes[symbol] = str(item["sha256"])
    observed_paths = {path.resolve() for path in cache_root.rglob("*") if path.is_file()}
    if observed_paths != expected_paths or any(path.is_symlink() for path in cache_root.rglob("*")):
        raise R06NonliveScannerFixtureContextError("unexpected_cache_output")
    expected_run_entries = {cache_root, lifecycle_root, manifest_path}
    observed_run_entries = {path.resolve() for path in run_root.iterdir()}
    if observed_run_entries != expected_run_entries or any(path.is_symlink() for path in run_root.iterdir()):
        raise R06NonliveScannerFixtureContextError("unexpected_cache_output")

    try:
        expected_session = date.fromisoformat(str(manifest["expectedSession"]))
    except (TypeError, ValueError) as exc:
        raise R06NonliveScannerFixtureContextError("manifest_invalid") from exc
    return R06NonliveScannerFixtureContext(
        fixture_id=str(manifest["fixtureId"]),
        fixture_version=str(manifest["fixtureVersion"]),
        expected_session=expected_session,
        cache_root=cache_root,
        run_root=run_root,
        descriptor_sha256=descriptor_sha256,
        manifest_sha256=manifest_sha256,
        output_hashes=output_hashes,
        symbols=symbols,
    )


def _validate_descriptor(descriptor: Mapping[str, object]) -> None:
    if descriptor.get("schemaVersion") != R06_DESCRIPTOR_SCHEMA:
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    if descriptor.get("market") != "us" or not str(descriptor.get("fixtureId") or "") or not str(descriptor.get("fixtureVersion") or ""):
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    symbols = descriptor.get("symbols")
    if not isinstance(symbols, list) or not symbols:
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    allowed = set(starter_us_ohlcv_coverage_symbols())
    normalized: list[str] = []
    roles: dict[str, str] = {}
    for item in symbols:
        if not isinstance(item, Mapping):
            raise R06NonliveScannerFixtureContextError("descriptor_invalid")
        symbol = str(item.get("symbol") or "").strip().upper()
        role = str(item.get("role") or "").strip().lower()
        if not symbol or symbol not in allowed or symbol in normalized or role not in {"benchmark", "candidate"}:
            raise R06NonliveScannerFixtureContextError("symbol_not_bounded")
        normalized.append(symbol)
        roles[symbol] = role
    if roles.get("SPY") != "benchmark" or not any(role == "candidate" for role in roles.values()):
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    if int(descriptor.get("historyBars") or 0) < 70:
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    seed = descriptor.get("deterministicOhlcvSeed")
    if not isinstance(seed, Mapping):
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")
    try:
        price_start = float(seed.get("priceStart"))
        price_step = float(seed.get("priceStep"))
        volume_start = int(seed.get("volumeStart"))
        volume_step = int(seed.get("volumeStep"))
    except (TypeError, ValueError) as exc:
        raise R06NonliveScannerFixtureContextError("descriptor_invalid") from exc
    if not np.isfinite(price_start) or price_start <= 0 or not np.isfinite(price_step) or price_step <= 0 or volume_start <= 0 or volume_step < 0:
        raise R06NonliveScannerFixtureContextError("descriptor_invalid")


def _validate_manifest(
    manifest: Mapping[str, object],
    *,
    descriptor: Mapping[str, object],
    descriptor_sha256: str,
    run_root: Path,
    lifecycle_root: Path,
) -> None:
    if manifest.get("schemaVersion") != R06_RUNTIME_MANIFEST_SCHEMA:
        raise R06NonliveScannerFixtureContextError("manifest_invalid")
    if manifest.get("fixtureId") != descriptor.get("fixtureId") or manifest.get("fixtureVersion") != descriptor.get("fixtureVersion"):
        raise R06NonliveScannerFixtureContextError("manifest_invalid")
    if manifest.get("descriptorSha256") != descriptor_sha256:
        raise R06NonliveScannerFixtureContextError("descriptor_hash_mismatch")
    if (
        manifest.get("cacheDirectory") != R06_CACHE_DIRECTORY
        or manifest.get("lifecycleDirectory") != lifecycle_root.name
        or manifest.get("runRootId") != run_root.name
    ):
        raise R06NonliveScannerFixtureContextError("run_root_not_isolated")
    if manifest.get("noExternalCalls") is not True or manifest.get("providerCallsEnabled") is not False:
        raise R06NonliveScannerFixtureContextError("manifest_invalid")
    outputs = manifest.get("outputs")
    symbols = [str(item.get("symbol") or "").strip().upper() for item in descriptor["symbols"] if isinstance(item, Mapping)]
    if not isinstance(outputs, list) or len(outputs) != len(symbols):
        raise R06NonliveScannerFixtureContextError("manifest_invalid")
    output_symbols: list[str] = []
    for item in outputs:
        if not isinstance(item, Mapping):
            raise R06NonliveScannerFixtureContextError("manifest_invalid")
        symbol = str(item.get("symbol") or "").strip().upper()
        if (
            not symbol
            or symbol in output_symbols
            or str(item.get("file") or "") != f"{symbol}.parquet"
            or not _is_sha256(str(item.get("sha256") or ""))
            or int(item.get("rows") or 0) != int(descriptor.get("historyBars") or 0)
            or str(item.get("firstSession") or "") >= str(item.get("lastSession") or "")
            or str(item.get("lastSession") or "") != str(manifest.get("expectedSession") or "")
        ):
            raise R06NonliveScannerFixtureContextError("manifest_invalid")
        output_symbols.append(symbol)
    if tuple(output_symbols) != tuple(symbols):
        raise R06NonliveScannerFixtureContextError("manifest_invalid")


def _validate_output_frame(path: Path, *, item: Mapping[str, object], expected_session: str) -> None:
    try:
        frame = pd.read_parquet(path)
        observed_dates = pd.to_datetime(frame["date"], errors="coerce")
        numeric = frame[["open", "high", "low", "close", "volume"]].apply(pd.to_numeric, errors="coerce")
    except (KeyError, OSError, ValueError, TypeError) as exc:
        raise R06NonliveScannerFixtureContextError("manifest_invalid") from exc
    if len(frame) != int(item["rows"]) or observed_dates.isna().any() or observed_dates.duplicated().any():
        raise R06NonliveScannerFixtureContextError("duplicate_or_invalid_session")
    if not np.isfinite(numeric.to_numpy(dtype=float)).all() or (numeric[["open", "high", "low", "close"]] <= 0).any().any() or (numeric["volume"] < 0).any():
        raise R06NonliveScannerFixtureContextError("manifest_invalid")
    observed = [value.date() for value in observed_dates]
    try:
        calendar = xcals.get_calendar("XNYS")
        expected = [value.date() for value in calendar.sessions_in_range(observed[0], observed[-1])]
    except Exception as exc:
        raise R06NonliveScannerFixtureContextError("expected_session_mismatch") from exc
    if (
        observed != expected
        or observed[0].isoformat() != str(item.get("firstSession") or "")
        or observed[-1].isoformat() != expected_session
        or str(item.get("asOf") or "") != f"{expected_session}T00:00:00Z"
    ):
        raise R06NonliveScannerFixtureContextError("expected_session_mismatch")


def _repository_roots() -> tuple[Path, ...]:
    return (Path(__file__).resolve().parents[2],)


def _is_true(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_explicit_false(value: object) -> bool:
    return str(value or "").strip().lower() in {"0", "false", "no", "off"}


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _is_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value.lower())


def _read_json(path: Path, code: str) -> Mapping[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise R06NonliveScannerFixtureContextError(code) from exc
    if not isinstance(value, Mapping):
        raise R06NonliveScannerFixtureContextError(code)
    return value


def _resolved_existing_directory(value: str, code: str) -> Path:
    raw_path = Path(value).expanduser()
    if raw_path.is_symlink():
        raise R06NonliveScannerFixtureContextError(code)
    path = raw_path.resolve()
    if not path.is_dir() or path.is_symlink():
        raise R06NonliveScannerFixtureContextError(code)
    return path


def _resolved_existing_file(value: str, code: str) -> Path:
    raw_path = Path(value).expanduser()
    if raw_path.is_symlink():
        raise R06NonliveScannerFixtureContextError(code)
    path = raw_path.resolve()
    if not path.is_file() or path.is_symlink():
        raise R06NonliveScannerFixtureContextError(code)
    return path


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
