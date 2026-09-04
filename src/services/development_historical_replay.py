"""Local-only, non-production historical OHLCV replay for development."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.repositories.historical_market_data_repo import HistoricalMarketDataRepository
from src.services.historical_market_data_foundation import (
    CanonicalHistoricalBar,
    HistoricalMarketDataFoundation,
    resolve_historical_symbol_identity,
)
from src.services.historical_ohlcv_readiness import (
    HistoricalOhlcvProviderResult,
    HistoricalOhlcvReadinessRequest,
)
from src.services.market_data_source_registry import resolve_source_type


DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_ENV = "WOLFYSTOCK_DEVELOPMENT_DATA_MANIFEST"
DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_VERSION = "wolfystock_development_historical_replay_v1"
_LOCAL_REPLAY = "local_replay"
_REPLAY_OBSERVATION_SOURCE_TYPES = frozenset(
    {
        "authorized_licensed_feed",
        "cache_snapshot",
        "exchange_public",
        "official_public",
        "public_proxy",
        "unofficial_proxy",
    }
)


class DevelopmentDataPlaneHistoricalOhlcvProvider:
    """Market-aware composition of the existing local-US and replay seams.

    A configured US parquet cache remains the exclusive US source when present;
    the replay provider supplies CN/HK (and US only when no US cache exists).
    No network provider is introduced by this composition.
    """

    def __init__(self, *, local_us_provider: Any = None, replay_provider: Any = None) -> None:
        self.local_us_provider = local_us_provider
        self.replay_provider = replay_provider

    def fetch_ohlcv_history(
        self,
        request: HistoricalOhlcvReadinessRequest,
    ) -> HistoricalOhlcvProviderResult:
        market = str(request.market or "").strip().upper()
        if market == "US" and self.local_us_provider is not None:
            return self.local_us_provider.fetch_ohlcv_history(request)
        if self.replay_provider is not None:
            return self.replay_provider.fetch_ohlcv_history(request)
        if self.local_us_provider is not None:
            return self.local_us_provider.fetch_ohlcv_history(request)
        return HistoricalOhlcvProviderResult.unavailable("provider_missing")


def compose_development_historical_ohlcv_provider(
    *,
    local_us_provider: Any = None,
    replay_provider: Any = None,
) -> Any:
    """Return the canonical market-aware provider when either source exists."""

    if local_us_provider is None and replay_provider is None:
        return None
    if local_us_provider is None:
        return replay_provider
    if replay_provider is None:
        return local_us_provider
    return DevelopmentDataPlaneHistoricalOhlcvProvider(
        local_us_provider=local_us_provider,
        replay_provider=replay_provider,
    )


class DevelopmentHistoricalReplayError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class _ReplayObservation:
    market: str
    canonical_symbol: str
    interval: str
    provider: str
    source: str
    observed_at: str
    as_of: str


class DevelopmentHistoricalReplayProvider:
    """Read verified local historical observations through the canonical foundation.

    The manifest and its JSON payloads are deliberately separate so the manifest
    binds each exact payload digest before any observation enters SQLite.
    """

    def __init__(self, manifest_path: str | Path) -> None:
        self.manifest_path = Path(manifest_path)
        self._temporary_directory: TemporaryDirectory[str] | None = None
        self._foundation: HistoricalMarketDataFoundation | None = None
        self._observations: dict[tuple[str, str, str], _ReplayObservation] = {}
        self._load_error: DevelopmentHistoricalReplayError | None = None

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> "DevelopmentHistoricalReplayProvider | None":
        configured = str((os.environ if env is None else env).get(DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_ENV) or "").strip()
        if not configured:
            return None
        manifest_path = Path(configured).expanduser()
        return cls(manifest_path)

    def fetch_ohlcv_history(
        self,
        request: HistoricalOhlcvReadinessRequest,
    ) -> HistoricalOhlcvProviderResult:
        if not self._ensure_loaded():
            return HistoricalOhlcvProviderResult.unavailable(
                "provider_unavailable",
                metadata={
                    "runtimeStatus": "unavailable",
                    "developmentReplayReason": self._load_error.code if self._load_error else "manifest_invalid",
                    "development": True,
                    "historical": True,
                    "replay": True,
                    "delivery": _LOCAL_REPLAY,
                    "authority": False,
                    "fallback": False,
                    "productionEligible": False,
                    "observationOnly": True,
                },
            )

        try:
            identity = resolve_historical_symbol_identity(symbol=request.symbol, market=request.market)
        except ValueError:
            return HistoricalOhlcvProviderResult.unavailable(
                "provider_missing",
                metadata=self._unavailable_metadata("symbol_not_replayed"),
            )

        foundation = self._foundation
        if foundation is None:
            return HistoricalOhlcvProviderResult.unavailable(
                "provider_unavailable",
                metadata=self._unavailable_metadata("replay_not_loaded"),
            )
        interval = _normalize_interval(request.timeframe)
        observation = self._observations.get((identity["market"], identity["canonical_symbol"], interval))
        if observation is None:
            return HistoricalOhlcvProviderResult.unavailable(
                "provider_missing",
                metadata=self._unavailable_metadata("symbol_not_replayed"),
            )

        start = request.start or date(1900, 1, 1)
        end = request.end or date(2999, 12, 31)
        bars = foundation.query_bars(
            symbol=identity["canonical_symbol"],
            market=identity["market"],
            interval=interval,
            start=start,
            end=end,
        )
        if request.lookback_bars and request.lookback_bars > 0:
            bars = bars[-request.lookback_bars :]
        if not bars:
            return HistoricalOhlcvProviderResult.unavailable(
                "provider_missing",
                metadata=self._unavailable_metadata("requested_range_unavailable"),
            )
        return HistoricalOhlcvProviderResult.available(
            [_as_ohlcv_row(bar) for bar in bars],
            adjustments_available=all(bar.adjustment_status == "adjusted" for bar in bars),
            # A replay is historical by construction. It must not be represented
            # as a current market observation by readiness consumers.
            freshness_state="stale",
            metadata={
                "runtimeStatus": "available",
                "development": True,
                "historical": True,
                "replay": True,
                "delivery": _LOCAL_REPLAY,
                "authority": False,
                "fallback": False,
                "productionEligible": False,
                "observationOnly": True,
                "provider": observation.provider,
                "source": observation.source,
                "market": observation.market,
                "canonicalSymbol": observation.canonical_symbol,
                "observedAt": observation.observed_at,
                "asOf": observation.as_of,
                "manifestVersion": DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_VERSION,
            },
        )

    def _ensure_loaded(self) -> bool:
        if self._foundation is not None:
            return True
        if self._load_error is not None:
            return False
        try:
            manifest = _read_json_object(self.manifest_path, "manifest_unavailable")
            entries = _validate_manifest(manifest)
            temporary_directory = TemporaryDirectory(prefix="wolfystock-development-replay-")
            foundation = HistoricalMarketDataFoundation(
                HistoricalMarketDataRepository.sqlite(Path(temporary_directory.name) / "historical-replay.sqlite")
            )
            observations: dict[tuple[str, str, str], _ReplayObservation] = {}
            for entry in entries:
                payload, observation = _read_observation_payload(self.manifest_path, entry)
                key = (observation.market, observation.canonical_symbol, observation.interval)
                if key in observations:
                    raise DevelopmentHistoricalReplayError("duplicate_observation_identity")
                ingestion = foundation.ingest_provider_payload(payload)
                if not ingestion.quality.product_readable or ingestion.persisted.conflicts:
                    raise DevelopmentHistoricalReplayError("observation_rejected")
                observations[key] = observation
        except DevelopmentHistoricalReplayError as error:
            self._load_error = error
            return False

        self._temporary_directory = temporary_directory
        self._foundation = foundation
        self._observations = observations
        return True

    @staticmethod
    def _unavailable_metadata(reason: str) -> dict[str, Any]:
        return {
            "runtimeStatus": "unavailable",
            "developmentReplayReason": reason,
            "development": True,
            "historical": True,
            "replay": True,
            "delivery": _LOCAL_REPLAY,
            "authority": False,
            "fallback": False,
            "productionEligible": False,
            "observationOnly": True,
        }


def _validate_manifest(manifest: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    _require_exact(manifest, "schemaVersion", DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_VERSION, "manifest_schema_version_invalid")
    _require_replay_metadata(manifest, "manifest")
    entries = manifest.get("observations")
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes, bytearray)) or not entries:
        raise DevelopmentHistoricalReplayError("manifest_observations_invalid")
    if not all(isinstance(entry, Mapping) for entry in entries):
        raise DevelopmentHistoricalReplayError("manifest_observations_invalid")
    return [dict(entry) for entry in entries]


def _read_observation_payload(
    manifest_path: Path,
    entry: Mapping[str, Any],
) -> tuple[dict[str, Any], _ReplayObservation]:
    _require_replay_metadata(entry, "observation")
    payload_path = _local_payload_path(manifest_path, entry.get("path"))
    raw_payload = _read_bytes(payload_path, "observation_unavailable")
    expected_digest = _sha256(entry.get("sha256"))
    actual_digest = hashlib.sha256(raw_payload).hexdigest()
    if not hmac.compare_digest(expected_digest, actual_digest):
        raise DevelopmentHistoricalReplayError("observation_sha256_mismatch")
    payload = _decode_json_object(raw_payload, "observation_json_invalid")
    observation = _validate_observation(entry, payload)
    return payload, observation


def _validate_observation(
    entry: Mapping[str, Any],
    payload: Mapping[str, Any],
) -> _ReplayObservation:
    for document, prefix in ((entry, "entry"), (payload, "payload")):
        _require_replay_metadata(document, prefix)
        for field_name in ("market", "symbol", "canonicalSymbol", "provider", "source", "observedAt", "asOf", "interval"):
            if not _nonempty_text(document.get(field_name)):
                raise DevelopmentHistoricalReplayError(f"{prefix}_{field_name}_missing")
        _parse_timestamp(document["observedAt"], f"{prefix}_observed_at_invalid")
        _parse_timestamp(document["asOf"], f"{prefix}_as_of_invalid")
        _require_replay_observation_source(document, prefix)
    fields = ("market", "symbol", "canonicalSymbol", "provider", "source", "observedAt", "asOf", "interval")
    if any(str(entry[field]).strip() != str(payload[field]).strip() for field in fields):
        raise DevelopmentHistoricalReplayError("entry_payload_metadata_mismatch")
    try:
        identity = resolve_historical_symbol_identity(symbol=str(payload["symbol"]), market=str(payload["market"]))
    except ValueError as error:
        raise DevelopmentHistoricalReplayError("observation_identity_invalid") from error
    if str(payload["canonicalSymbol"]).strip() != identity["canonical_symbol"]:
        raise DevelopmentHistoricalReplayError("observation_canonical_symbol_invalid")
    normalized_interval = _normalize_interval(str(payload["interval"]))
    if not normalized_interval:
        raise DevelopmentHistoricalReplayError("observation_interval_invalid")
    rows = payload.get("rows")
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)) or not rows:
        raise DevelopmentHistoricalReplayError("observation_rows_invalid")
    return _ReplayObservation(
        market=identity["market"],
        canonical_symbol=identity["canonical_symbol"],
        interval=normalized_interval,
        provider=str(payload["provider"]).strip(),
        source=str(payload["source"]).strip(),
        observed_at=str(payload["observedAt"]).strip(),
        as_of=str(payload["asOf"]).strip(),
    )


def _require_replay_metadata(document: Mapping[str, Any], prefix: str) -> None:
    _require_exact(document, "delivery", _LOCAL_REPLAY, f"{prefix}_delivery_invalid")
    _require_exact(document, "historical", True, f"{prefix}_historical_invalid")
    _require_exact(document, "replay", True, f"{prefix}_replay_invalid")
    _require_exact(document, "development", True, f"{prefix}_development_invalid")
    _require_exact(document, "authority", False, f"{prefix}_authority_invalid")
    _require_exact(document, "fallback", False, f"{prefix}_fallback_invalid")
    _require_exact(document, "productionEligible", False, f"{prefix}_production_eligibility_invalid")
    _require_exact(document, "observationOnly", True, f"{prefix}_observation_only_invalid")


def _require_replay_observation_source(document: Mapping[str, Any], prefix: str) -> None:
    for field_name in ("provider", "source"):
        source_type = resolve_source_type(
            str(document.get(field_name) or ""),
            source_type=str(document.get(field_name) or ""),
        )
        if source_type == "synthetic_fixture":
            raise DevelopmentHistoricalReplayError(f"{prefix}_synthetic_source_invalid")
        if source_type == "fallback_static":
            raise DevelopmentHistoricalReplayError(f"{prefix}_fallback_source_invalid")
        if source_type == "missing":
            raise DevelopmentHistoricalReplayError(f"{prefix}_missing_source_invalid")
        if source_type not in _REPLAY_OBSERVATION_SOURCE_TYPES:
            raise DevelopmentHistoricalReplayError(f"{prefix}_source_type_invalid")


def _require_exact(document: Mapping[str, Any], field_name: str, expected: Any, code: str) -> None:
    value = document.get(field_name)
    if isinstance(expected, bool):
        valid = value is expected
    else:
        valid = value == expected
    if not valid:
        raise DevelopmentHistoricalReplayError(code)


def _local_payload_path(manifest_path: Path, configured_path: Any) -> Path:
    if not isinstance(configured_path, str) or not configured_path.strip():
        raise DevelopmentHistoricalReplayError("observation_path_invalid")
    candidate = Path(configured_path)
    if candidate.is_absolute():
        raise DevelopmentHistoricalReplayError("observation_path_invalid")
    manifest_directory = manifest_path.parent.resolve()
    resolved = (manifest_directory / candidate).resolve()
    try:
        resolved.relative_to(manifest_directory)
    except ValueError as error:
        raise DevelopmentHistoricalReplayError("observation_path_invalid") from error
    return resolved


def _read_json_object(path: Path, error_code: str) -> dict[str, Any]:
    return _decode_json_object(_read_bytes(path, error_code), error_code)


def _read_bytes(path: Path, error_code: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise DevelopmentHistoricalReplayError(error_code) from error


def _decode_json_object(raw: bytes, error_code: str) -> dict[str, Any]:
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DevelopmentHistoricalReplayError(error_code) from error
    if not isinstance(decoded, Mapping):
        raise DevelopmentHistoricalReplayError(error_code)
    return dict(decoded)


def _sha256(value: Any) -> str:
    digest = str(value or "").strip().lower()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise DevelopmentHistoricalReplayError("observation_sha256_invalid")
    return digest


def _parse_timestamp(value: Any, error_code: str) -> None:
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise DevelopmentHistoricalReplayError(error_code) from error
    if parsed.tzinfo is None:
        raise DevelopmentHistoricalReplayError(error_code)


def _nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _normalize_interval(value: str) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {"daily": "1d", "day": "1d", "1day": "1d", "d": "1d", "1w": "1wk", "weekly": "1wk", "1m": "1mo", "monthly": "1mo"}
    return aliases.get(normalized, normalized)


def _as_ohlcv_row(bar: CanonicalHistoricalBar) -> dict[str, Any]:
    row = {
        "date": bar.session_date.isoformat(),
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "volume": bar.volume,
    }
    adjusted_close = bar.adjustment_metadata.get("adjustedClose")
    if adjusted_close is not None:
        row["adjustedClose"] = adjusted_close
    return row


__all__ = [
    "DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_ENV",
    "DEVELOPMENT_HISTORICAL_REPLAY_MANIFEST_VERSION",
    "DevelopmentHistoricalReplayProvider",
]
