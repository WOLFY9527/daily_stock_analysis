from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import desc, select

from src.services.quote_ohlcv_snapshot_lineage import (
    QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION,
    QuoteOhlcvSnapshotPersistenceResult,
    QuoteOhlcvSnapshotRecord,
    SnapshotLineageError,
    migrate_snapshot_storage_payload,
    snapshot_from_storage_payload,
    validate_snapshot_lineage,
)
from src.services.historical_market_data_foundation import resolve_historical_symbol_identity
from src.utils.symbol_normalization import canonical_symbol_storage_values
from src.storage import DatabaseManager, QuoteOhlcvSnapshotRow


SCHEMA_VERSION = "quote_ohlcv_snapshot_lineage_v2_read_migrated"


class QuoteOhlcvSnapshotRepository:
    """Canonical DatabaseManager-owned persistence boundary for snapshot lineage."""

    def __init__(self, db_manager: DatabaseManager) -> None:
        self.db = db_manager

    def upsert_snapshot(self, snapshot: QuoteOhlcvSnapshotRecord) -> QuoteOhlcvSnapshotPersistenceResult:
        validate_snapshot_lineage(snapshot)
        payload = snapshot.storage_payload()
        payload_json = _canonical_payload_json(payload)
        fingerprint = _payload_fingerprint(payload_json)

        with self.db.session_scope() as session:
            existing = session.get(QuoteOhlcvSnapshotRow, snapshot.snapshot_id)
            if existing is not None:
                if str(existing.payload_fingerprint) != fingerprint:
                    raise SnapshotLineageError(
                        f"quote/OHLCV snapshot identity conflict: {snapshot.snapshot_id}"
                    )
                return QuoteOhlcvSnapshotPersistenceResult(
                    snapshot_id=snapshot.snapshot_id,
                    inserted=False,
                )

            session.add(
                QuoteOhlcvSnapshotRow(
                    snapshot_id=snapshot.snapshot_id,
                    snapshot_kind=snapshot.snapshot_kind,
                    symbol=snapshot.symbol,
                    market=snapshot.market,
                    quote_as_of=payload.get("quoteAsOf"),
                    bar_trade_date_time=payload.get("barTradeDateTime"),
                    retrieval_time=payload["retrievalTime"],
                    source_id=snapshot.source_id,
                    source_type=snapshot.source_type,
                    authority_state=snapshot.authority_state,
                    display_state=snapshot.display_state,
                    freshness_state=snapshot.freshness_state,
                    coverage_state=snapshot.coverage_state,
                    ohlcv_basis=snapshot.ohlcv_basis,
                    lineage_ref=snapshot.lineage_ref,
                    payload_json=payload_json,
                    payload_fingerprint=fingerprint,
                )
            )

        return QuoteOhlcvSnapshotPersistenceResult(snapshot_id=snapshot.snapshot_id, inserted=True)

    def get_snapshot(self, snapshot_id: str) -> QuoteOhlcvSnapshotRecord | None:
        with self.db.get_session() as session:
            row = session.get(QuoteOhlcvSnapshotRow, str(snapshot_id or "").strip())
            return _record_from_row(row) if row is not None else None

    def latest_for_symbol(
        self,
        *,
        symbol: str,
        market: str,
        snapshot_kind: str,
        venue: str | None = None,
        asset_type: str | None = None,
    ) -> QuoteOhlcvSnapshotRecord | None:
        identity = resolve_historical_symbol_identity(
            symbol=symbol,
            market=market,
            venue=venue,
            asset_type=asset_type,
        )
        expected_symbol = identity["canonical_symbol"]
        expected_market = identity["market"]
        expected_venue = venue or identity["venue"]
        expected_asset_type = asset_type or identity["asset_type"]
        storage_symbols = tuple(
            dict.fromkeys(
                canonical_symbol_storage_values(
                    symbol,
                    market=expected_market,
                    venue=expected_venue,
                    asset_type=expected_asset_type,
                )
                + (expected_symbol,)
            )
        )
        with self.db.get_session() as session:
            rows = (
                session.execute(
                    select(QuoteOhlcvSnapshotRow)
                    .where(
                        QuoteOhlcvSnapshotRow.symbol.in_(storage_symbols),
                        QuoteOhlcvSnapshotRow.market == expected_market,
                        QuoteOhlcvSnapshotRow.snapshot_kind == snapshot_kind,
                    )
                    .order_by(
                        desc(QuoteOhlcvSnapshotRow.retrieval_time),
                        desc(QuoteOhlcvSnapshotRow.created_at),
                    )
                )
                .scalars()
                .all()
            )
            for row in rows:
                record = _record_from_row(row)
                record_identity = record.instrument_identity
                if (
                    str(record_identity.get("canonicalSymbol")) == expected_symbol
                    and str(record_identity.get("market")) == expected_market
                    and str(record_identity.get("venue")) == expected_venue
                    and str(record_identity.get("assetType")) == expected_asset_type
                ):
                    return record
            return None

    def migration_report(self) -> dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "contractVersion": QUOTE_OHLCV_SNAPSHOT_CONTRACT_VERSION,
            "legacyReadMigration": "quote_ohlcv_snapshot_lineage_v1_to_v2",
            "storageOwner": "DatabaseManager",
            "schemaLifecycle": "SQLAlchemy Base.metadata.create_all",
            "table": QuoteOhlcvSnapshotRow.__tablename__,
        }


def _record_from_row(row: QuoteOhlcvSnapshotRow) -> QuoteOhlcvSnapshotRecord:
    raw_payload = _json_mapping(row.payload_json)
    raw_fingerprint = _payload_fingerprint(_canonical_payload_json(raw_payload))
    if str(row.payload_fingerprint) != raw_fingerprint:
        raise SnapshotLineageError(f"quote/OHLCV snapshot payload fingerprint mismatch: {row.snapshot_id}")
    payload = migrate_snapshot_storage_payload(raw_payload)
    record = snapshot_from_storage_payload(payload)
    validate_snapshot_lineage(record)
    if record.snapshot_id != row.snapshot_id:
        raise SnapshotLineageError(f"quote/OHLCV snapshot identity mismatch: {row.snapshot_id}")
    return record


def _json_mapping(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, json.JSONDecodeError) as exc:
        raise SnapshotLineageError("quote/OHLCV snapshot payload is corrupt") from exc
    if not isinstance(parsed, dict):
        raise SnapshotLineageError("quote/OHLCV snapshot payload is not an object")
    return dict(parsed)


def _canonical_payload_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def _payload_fingerprint(payload_json: str) -> str:
    return hashlib.sha256(payload_json.encode("utf-8")).hexdigest()


__all__ = ["QuoteOhlcvSnapshotRepository", "SCHEMA_VERSION"]
