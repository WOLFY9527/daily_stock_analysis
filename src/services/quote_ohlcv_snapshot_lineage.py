from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from src.services.historical_market_data_foundation import resolve_historical_symbol_identity
from src.services.historical_ohlcv_readiness import HistoricalOhlcvBar
from src.services.quote_snapshot_readiness import QuoteSnapshot


QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION = "quote_ohlcv_snapshot_lineage_v2"
LEGACY_QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION = "quote_ohlcv_snapshot_lineage_v1"


class SnapshotLineageError(ValueError):
    """Raised when a quote/OHLCV snapshot lacks required provenance."""


@dataclass(frozen=True, slots=True)
class QuoteOhlcvSnapshotPersistenceResult:
    snapshot_id: str
    inserted: bool


@dataclass(frozen=True, slots=True)
class QuoteOhlcvSnapshotRecord:
    snapshot_id: str
    snapshot_kind: str
    symbol: str
    market: str
    instrument_identity: Mapping[str, str]
    retrieval_time: datetime
    source_id: str
    source_type: str
    authority_state: str
    display_state: str
    freshness_state: str
    coverage_state: str
    missing_field_summary: tuple[str, ...] = ()
    lineage_ref: str = ""
    quote_as_of: datetime | None = None
    bar_trade_date_time: str | None = None
    ohlcv_basis: str | None = None
    values: Mapping[str, Any] = field(default_factory=dict)
    contract_version: str = QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION

    def as_read_model(self) -> dict[str, Any]:
        return {
            "contractVersion": self.contract_version,
            "snapshotId": self.snapshot_id,
            "snapshotKind": self.snapshot_kind,
            "symbol": self.symbol,
            "market": self.market,
            "instrumentIdentity": dict(self.instrument_identity),
            "quoteAsOf": _iso_datetime(self.quote_as_of),
            "barTradeDateTime": self.bar_trade_date_time,
            "retrievalTime": _iso_datetime(self.retrieval_time),
            "sourceId": self.source_id,
            "sourceType": self.source_type,
            "authorityState": self.authority_state,
            "displayState": self.display_state,
            "freshnessState": self.freshness_state,
            "coverageState": self.coverage_state,
            "missingFieldSummary": list(self.missing_field_summary),
            "ohlcvBasis": self.ohlcv_basis,
            "lineageRef": self.lineage_ref,
            "values": dict(self.values),
        }

    def storage_payload(self) -> dict[str, Any]:
        payload = self.as_read_model()
        payload["instrumentIdentity"] = dict(self.instrument_identity)
        payload["values"] = dict(self.values)
        return payload


class QuoteOhlcvSnapshotRepositoryProtocol(Protocol):
    def upsert_snapshot(self, snapshot: QuoteOhlcvSnapshotRecord) -> QuoteOhlcvSnapshotPersistenceResult:
        ...

    def get_snapshot(self, snapshot_id: str) -> QuoteOhlcvSnapshotRecord | None:
        ...

    def latest_for_symbol(
        self,
        *,
        symbol: str,
        market: str,
        snapshot_kind: str,
        venue: str | None = None,
        asset_type: str | None = None,
    ) -> QuoteOhlcvSnapshotRecord | None:
        ...


class QuoteOhlcvSnapshotSpine:
    """Bounded persistence facade for quote/OHLCV snapshot lineage records."""

    def __init__(self, repository: QuoteOhlcvSnapshotRepositoryProtocol) -> None:
        self.repository = repository

    def persist_snapshot(self, snapshot: QuoteOhlcvSnapshotRecord) -> QuoteOhlcvSnapshotPersistenceResult:
        validate_snapshot_lineage(snapshot)
        return self.repository.upsert_snapshot(snapshot)

    def get_snapshot(self, snapshot_id: str) -> QuoteOhlcvSnapshotRecord | None:
        return self.repository.get_snapshot(snapshot_id)

    def latest_for_symbol(
        self,
        *,
        symbol: str,
        market: str,
        snapshot_kind: str,
        venue: str | None = None,
        asset_type: str | None = None,
    ) -> QuoteOhlcvSnapshotRecord | None:
        identity = _instrument_identity(
            symbol=symbol,
            market=market,
            venue=venue,
            asset_type=asset_type,
        )
        return self.repository.latest_for_symbol(
            symbol=identity["canonicalSymbol"],
            market=identity["market"],
            snapshot_kind=_safe_code(snapshot_kind),
            venue=identity["venue"],
            asset_type=identity["assetType"],
        )


def build_quote_snapshot_from_readiness(
    snapshot: QuoteSnapshot,
    *,
    retrieval_time: datetime,
    authority_state: str,
    display_state: str | None = None,
    freshness_state: str,
    coverage_state: str,
    lineage_ref: str,
    missing_field_summary: Sequence[str] | None = None,
    source_type: str | None = None,
) -> QuoteOhlcvSnapshotRecord:
    source_id = _safe_code(snapshot.source)
    identity = _instrument_identity(symbol=snapshot.symbol, market=snapshot.market)
    record = QuoteOhlcvSnapshotRecord(
        snapshot_id="",
        snapshot_kind="quote",
        symbol=identity["canonicalSymbol"],
        market=identity["market"],
        instrument_identity=identity,
        quote_as_of=_utc_datetime(snapshot.as_of),
        bar_trade_date_time=None,
        retrieval_time=_utc_datetime(retrieval_time),
        source_id=source_id,
        source_type=source_type or _source_type_for(source_id),
        authority_state=_safe_state(authority_state),
        display_state=_safe_state(display_state) or "unknown",
        freshness_state=_safe_state(freshness_state),
        coverage_state=_safe_state(coverage_state),
        missing_field_summary=tuple(_text_list(missing_field_summary)),
        ohlcv_basis=None,
        lineage_ref=_safe_lineage(lineage_ref),
        values={
            "last": float(snapshot.last),
            **_optional_float("previousClose", snapshot.previous_close),
            **_optional_float("volume", snapshot.volume),
            **({"currency": str(snapshot.currency).strip().upper()} if snapshot.currency else {}),
        },
    )
    return _with_snapshot_id(record)


def build_ohlcv_snapshot_from_bar(
    *,
    symbol: str,
    market: str,
    bar: HistoricalOhlcvBar,
    retrieval_time: datetime,
    source_id: str,
    authority_state: str,
    display_state: str | None = None,
    freshness_state: str,
    coverage_state: str,
    lineage_ref: str,
    missing_field_summary: Sequence[str] | None = None,
    source_type: str | None = None,
) -> QuoteOhlcvSnapshotRecord:
    identity = _instrument_identity(symbol=symbol, market=market)
    record = QuoteOhlcvSnapshotRecord(
        snapshot_id="",
        snapshot_kind="ohlcv",
        symbol=identity["canonicalSymbol"],
        market=identity["market"],
        instrument_identity=identity,
        quote_as_of=None,
        bar_trade_date_time=bar.date.isoformat(),
        retrieval_time=_utc_datetime(retrieval_time),
        source_id=_safe_code(source_id),
        source_type=source_type or _source_type_for(source_id),
        authority_state=_safe_state(authority_state),
        display_state=_safe_state(display_state) or "unknown",
        freshness_state=_safe_state(freshness_state),
        coverage_state=_safe_state(coverage_state),
        missing_field_summary=tuple(_text_list(missing_field_summary)),
        ohlcv_basis="adjusted" if bar.adjusted_close is not None else "unadjusted",
        lineage_ref=_safe_lineage(lineage_ref),
        values={
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(bar.volume),
            **_optional_float("adjustedClose", bar.adjusted_close),
        },
    )
    return _with_snapshot_id(record)


def snapshot_from_storage_payload(payload: Mapping[str, Any]) -> QuoteOhlcvSnapshotRecord:
    return QuoteOhlcvSnapshotRecord(
        snapshot_id=_text(payload.get("snapshotId")),
        snapshot_kind=_text(payload.get("snapshotKind")),
        symbol=_text(payload.get("symbol")),
        market=_text(payload.get("market")),
        instrument_identity=dict(payload.get("instrumentIdentity") or {}),
        quote_as_of=_parse_datetime(payload.get("quoteAsOf")),
        bar_trade_date_time=_optional_text(payload.get("barTradeDateTime")),
        retrieval_time=_require_datetime(payload.get("retrievalTime"), "retrievalTime"),
        source_id=_text(payload.get("sourceId")),
        source_type=_text(payload.get("sourceType")),
        authority_state=_text(payload.get("authorityState")),
        display_state=_text(payload.get("displayState")) or "unknown",
        freshness_state=_text(payload.get("freshnessState")),
        coverage_state=_text(payload.get("coverageState")),
        missing_field_summary=tuple(_text_list(payload.get("missingFieldSummary"))),
        ohlcv_basis=_optional_text(payload.get("ohlcvBasis")),
        lineage_ref=_text(payload.get("lineageRef")),
        values=dict(payload.get("values") or {}),
        contract_version=_text(payload.get("contractVersion")) or QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION,
    )


def migrate_snapshot_storage_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Upgrade legacy payload spelling without changing its persisted row identity."""
    migrated = dict(payload)
    identity = dict(payload.get("instrumentIdentity") or {})
    contract_version = _text(payload.get("contractVersion"))
    if contract_version == QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION:
        return migrated
    if contract_version != LEGACY_QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION:
        raise SnapshotLineageError("unsupported quote/OHLCV snapshot contract version")

    legacy_market = _text(payload.get("market")) or _text(identity.get("market"))
    legacy_venue = _text(identity.get("venue")) or None
    # v1 US rows used the calendar representative as venue. Translate only
    # that known legacy spelling; contradictory current identities remain rejected.
    if legacy_market.upper() == "US" and legacy_venue == "XNYS":
        legacy_venue = None

    try:
        expected = resolve_historical_symbol_identity(
            symbol=_text(payload.get("symbol")) or _text(identity.get("canonicalSymbol")),
            market=legacy_market,
            venue=legacy_venue,
            asset_type=_text(identity.get("assetType")) or None,
        )
    except ValueError as exc:
        raise SnapshotLineageError("quote/OHLCV legacy snapshot identity cannot be migrated") from exc

    migrated["contractVersion"] = QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION
    migrated["symbol"] = expected["canonical_symbol"]
    migrated["market"] = expected["market"]
    migrated["instrumentIdentity"] = {
        "canonicalSymbol": expected["canonical_symbol"],
        "market": expected["market"],
        "venue": expected["venue"],
        "assetType": expected["asset_type"],
    }
    return migrated


def validate_snapshot_lineage(snapshot: QuoteOhlcvSnapshotRecord) -> None:
    missing = []
    for field_name in (
        "snapshot_id",
        "snapshot_kind",
        "symbol",
        "market",
        "source_id",
        "source_type",
        "authority_state",
        "freshness_state",
        "coverage_state",
        "lineage_ref",
    ):
        if not _text(getattr(snapshot, field_name)):
            missing.append(field_name)
    if snapshot.retrieval_time is None:
        missing.append("retrieval_time")
    if snapshot.snapshot_kind == "quote" and snapshot.quote_as_of is None:
        missing.append("quote_as_of")
    if snapshot.snapshot_kind == "ohlcv" and not snapshot.bar_trade_date_time:
        missing.append("bar_trade_date_time")
    if missing:
        raise SnapshotLineageError("quote/OHLCV snapshot missing provenance: " + ", ".join(missing))
    identity = dict(snapshot.instrument_identity or {})
    try:
        expected = resolve_historical_symbol_identity(
            symbol=snapshot.symbol,
            market=snapshot.market,
            venue=_text(identity.get("venue")) or None,
            asset_type=_text(identity.get("assetType")) or None,
        )
    except ValueError as exc:
        raise SnapshotLineageError("quote/OHLCV snapshot malformed instrument identity") from exc
    if (
        _text(identity.get("canonicalSymbol")) != expected["canonical_symbol"]
        or _text(identity.get("market")) != expected["market"]
        or _text(identity.get("venue")) != expected["venue"]
        or _text(identity.get("assetType")) != expected["asset_type"]
    ):
        raise SnapshotLineageError("quote/OHLCV snapshot malformed instrument identity")


def _with_snapshot_id(record: QuoteOhlcvSnapshotRecord) -> QuoteOhlcvSnapshotRecord:
    _validate_snapshot_fields_before_id(record)
    snapshot_id = _stable_hash(
        {
            "contractVersion": record.contract_version,
            "snapshotKind": record.snapshot_kind,
            "instrumentIdentity": dict(record.instrument_identity),
            "symbol": record.symbol,
            "market": record.market,
            "quoteAsOf": _iso_datetime(record.quote_as_of),
            "barTradeDateTime": record.bar_trade_date_time,
            "retrievalTime": _iso_datetime(record.retrieval_time),
            "sourceId": record.source_id,
            "sourceType": record.source_type,
            "authorityState": record.authority_state,
            "freshnessState": record.freshness_state,
            "coverageState": record.coverage_state,
            "ohlcvBasis": record.ohlcv_basis,
            "lineageRef": record.lineage_ref,
        }
    )
    return QuoteOhlcvSnapshotRecord(
        snapshot_id=f"qohlcv_{snapshot_id}",
        snapshot_kind=record.snapshot_kind,
        symbol=record.symbol,
        market=record.market,
        instrument_identity=dict(record.instrument_identity),
        quote_as_of=record.quote_as_of,
        bar_trade_date_time=record.bar_trade_date_time,
        retrieval_time=record.retrieval_time,
        source_id=record.source_id,
        source_type=record.source_type,
        authority_state=record.authority_state,
        display_state=record.display_state,
        freshness_state=record.freshness_state,
        coverage_state=record.coverage_state,
        missing_field_summary=tuple(record.missing_field_summary),
        ohlcv_basis=record.ohlcv_basis,
        lineage_ref=record.lineage_ref,
        values=dict(record.values),
        contract_version=record.contract_version,
    )


def _validate_snapshot_fields_before_id(record: QuoteOhlcvSnapshotRecord) -> None:
    probe = QuoteOhlcvSnapshotRecord(
        snapshot_id="pending",
        snapshot_kind=record.snapshot_kind,
        symbol=record.symbol,
        market=record.market,
        instrument_identity=dict(record.instrument_identity),
        quote_as_of=record.quote_as_of,
        bar_trade_date_time=record.bar_trade_date_time,
        retrieval_time=record.retrieval_time,
        source_id=record.source_id,
        source_type=record.source_type,
        authority_state=record.authority_state,
        display_state=record.display_state,
        freshness_state=record.freshness_state,
        coverage_state=record.coverage_state,
        missing_field_summary=tuple(record.missing_field_summary),
        ohlcv_basis=record.ohlcv_basis,
        lineage_ref=record.lineage_ref,
        values=dict(record.values),
        contract_version=record.contract_version,
    )
    validate_snapshot_lineage(probe)


def _instrument_identity(
    *,
    symbol: str,
    market: str,
    venue: str | None = None,
    asset_type: str | None = None,
) -> dict[str, str]:
    identity = resolve_historical_symbol_identity(
        symbol=symbol,
        market=market,
        venue=venue,
        asset_type=asset_type,
    )
    return {
        "canonicalSymbol": identity["canonical_symbol"],
        "market": identity["market"],
        "venue": identity["venue"],
        "assetType": identity["asset_type"],
    }


def _source_type_for(source_id: str) -> str:
    normalized = _safe_code(source_id)
    if normalized in {"local_quote_snapshot_cache", "local_ohlcv", "local_cache"}:
        return "cache_snapshot"
    if normalized.startswith("local_"):
        return "cache_snapshot"
    if normalized in {"fallback", "mock", "fixture", "synthetic"}:
        return normalized
    if normalized:
        return "provider_runtime"
    return ""


def _optional_float(key: str, value: Any) -> dict[str, float]:
    try:
        if value is None:
            return {}
        return {key: float(value)}
    except (TypeError, ValueError):
        return {}


def _stable_hash(payload: Mapping[str, Any]) -> str:
    text = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _safe_code(value: Any) -> str:
    text = _text(value).lower()
    return "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in text)[:96]


def _safe_state(value: Any) -> str:
    text = _safe_code(value)
    return text[:64]


def _safe_lineage(value: Any) -> str:
    return _text(value)[:240]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _optional_text(value: Any) -> str | None:
    text = _text(value)
    return text or None


def _text_list(value: Any) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return []
    return [text for item in value if (text := _text(item))]


def _utc_datetime(value: datetime) -> datetime:
    dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def _parse_datetime(value: Any) -> datetime | None:
    text = _text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _utc_datetime(parsed)


def _require_datetime(value: Any, field_name: str) -> datetime:
    parsed = _parse_datetime(value)
    if parsed is None:
        raise SnapshotLineageError(f"quote/OHLCV snapshot missing provenance: {field_name}")
    return parsed


def _iso_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _utc_datetime(value).isoformat()


__all__ = [
    "QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION",
    "QuoteOhlcvSnapshotPersistenceResult",
    "QuoteOhlcvSnapshotRecord",
    "QuoteOhlcvSnapshotSpine",
    "SnapshotLineageError",
    "build_ohlcv_snapshot_from_bar",
    "build_quote_snapshot_from_readiness",
    "snapshot_from_storage_payload",
    "validate_snapshot_lineage",
]
