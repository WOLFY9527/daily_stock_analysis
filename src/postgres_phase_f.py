# -*- coding: utf-8 -*-
"""Narrow Phase F persistence adapter for PostgreSQL-backed portfolio data."""

from __future__ import annotations

import json
import logging
import re
from contextlib import contextmanager
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    delete,
    func,
    select,
)
from sqlalchemy.orm import Session, sessionmaker

from src.postgres_phase_a import PhaseABase
from src.postgres_schema_bootstrap import apply_schema_slice

logger = logging.getLogger(__name__)

PhaseFBase = PhaseABase

_BIGINT_PK = BigInteger().with_variant(Integer, "sqlite")
_PHASE_F_TABLES = {
    "portfolio_accounts",
    "broker_connections",
    "portfolio_ledger",
    "portfolio_positions",
    "portfolio_sync_states",
    "portfolio_sync_positions",
    "portfolio_sync_cash_balances",
}
_PHASE_F_INDEXES = {
    "idx_portfolio_accounts_user_active",
    "idx_portfolio_ledger_account_event",
}
_TRADE_LEDGER_ID_OFFSET = 1_000_000_000_000
_CASH_LEDGER_ID_OFFSET = 2_000_000_000_000
_CORPORATE_ACTION_LEDGER_ID_OFFSET = 3_000_000_000_000
_EVENT_PRIORITY_SECONDS = {
    "cash": 0,
    "corporate_action": 1,
    "trade": 2,
    "adjustment": 3,
}


def phase_f_ledger_shadow_id(entry_type: str, legacy_row_id: int) -> int:
    """Return a deterministic ledger id for one legacy portfolio row."""
    normalized_type = str(entry_type or "").strip().lower()
    resolved_legacy_id = int(legacy_row_id)
    if resolved_legacy_id <= 0:
        raise ValueError("legacy_row_id must be positive")
    if normalized_type == "trade":
        return _TRADE_LEDGER_ID_OFFSET + resolved_legacy_id
    if normalized_type == "cash":
        return _CASH_LEDGER_ID_OFFSET + resolved_legacy_id
    if normalized_type == "corporate_action":
        return _CORPORATE_ACTION_LEDGER_ID_OFFSET + resolved_legacy_id
    raise ValueError(f"Unsupported Phase F ledger entry_type: {entry_type}")


class PhaseFPortfolioAccount(PhaseFBase):
    __tablename__ = "portfolio_accounts"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    broker_label = Column(Text)
    market = Column(Text, nullable=False)
    base_currency = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)


class PhaseFBrokerConnection(PhaseFBase):
    __tablename__ = "broker_connections"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    broker_type = Column(Text, nullable=False)
    broker_name = Column(Text)
    connection_name = Column(Text, nullable=False)
    broker_account_ref = Column(Text)
    import_mode = Column(Text, nullable=False)
    status = Column(Text, nullable=False)
    last_imported_at = Column(DateTime(timezone=True))
    last_import_source = Column(Text)
    last_import_fingerprint = Column(Text)
    sync_metadata = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "broker_type",
            "broker_account_ref",
            name="uq_phase_f_broker_connections_owner_ref",
        ),
    )


class PhaseFPortfolioLedger(PhaseFBase):
    __tablename__ = "portfolio_ledger"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=False)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    entry_type = Column(Text, nullable=False)
    event_time = Column(DateTime(timezone=True), nullable=False, index=True)
    canonical_symbol = Column(Text)
    market = Column(Text)
    currency = Column(Text)
    direction = Column(Text)
    quantity = Column(Numeric(24, 8))
    price = Column(Numeric(24, 8))
    amount = Column(Numeric(24, 8))
    fee = Column(Numeric(24, 8))
    tax = Column(Numeric(24, 8))
    corporate_action_type = Column(Text)
    external_ref = Column(Text)
    dedup_hash = Column(Text)
    note = Column(Text)
    payload_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "portfolio_account_id",
            "external_ref",
            name="uq_phase_f_portfolio_ledger_account_external_ref",
        ),
        UniqueConstraint(
            "portfolio_account_id",
            "dedup_hash",
            name="uq_phase_f_portfolio_ledger_account_dedup_hash",
        ),
        CheckConstraint(
            "entry_type in ('trade', 'cash', 'corporate_action', 'adjustment')",
            name="ck_phase_f_portfolio_ledger_entry_type",
        ),
    )


class PhaseFPortfolioPosition(PhaseFBase):
    __tablename__ = "portfolio_positions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=False)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    source_kind = Column(Text, nullable=False)
    cost_method = Column(Text, nullable=False)
    canonical_symbol = Column(Text, nullable=False)
    market = Column(Text, nullable=False)
    currency = Column(Text, nullable=False)
    quantity = Column(Numeric(24, 8), nullable=False, default=0)
    avg_cost = Column(Numeric(24, 8), nullable=False, default=0)
    total_cost = Column(Numeric(24, 8), nullable=False, default=0)
    last_price = Column(Numeric(24, 8))
    market_value_base = Column(Numeric(24, 8))
    unrealized_pnl_base = Column(Numeric(24, 8))
    valuation_currency = Column(Text)
    as_of_time = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "portfolio_account_id",
            "source_kind",
            "cost_method",
            "canonical_symbol",
            "market",
            "currency",
            name="uq_phase_f_portfolio_positions_account_source_symbol",
        ),
        CheckConstraint(
            "source_kind in ('replayed_ledger', 'broker_sync_overlay')",
            name="ck_phase_f_portfolio_positions_source_kind",
        ),
    )


class PhaseFPortfolioSyncState(PhaseFBase):
    __tablename__ = "portfolio_sync_states"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=False)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    broker_connection_id = Column(_BIGINT_PK, ForeignKey("broker_connections.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    broker_type = Column(Text, nullable=False)
    broker_account_ref = Column(Text)
    sync_source = Column(Text, nullable=False)
    sync_status = Column(Text, nullable=False)
    snapshot_date = Column(Date, nullable=False)
    synced_at = Column(DateTime(timezone=True), nullable=False)
    base_currency = Column(Text, nullable=False)
    total_cash = Column(Numeric(24, 8), nullable=False, default=0)
    total_market_value = Column(Numeric(24, 8), nullable=False, default=0)
    total_equity = Column(Numeric(24, 8), nullable=False, default=0)
    realized_pnl = Column(Numeric(24, 8), nullable=False, default=0)
    unrealized_pnl = Column(Numeric(24, 8), nullable=False, default=0)
    fx_stale = Column(Boolean, nullable=False, default=False)
    payload_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "broker_connection_id",
            name="uq_phase_f_portfolio_sync_states_connection",
        ),
    )


class PhaseFPortfolioSyncPosition(PhaseFBase):
    __tablename__ = "portfolio_sync_positions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=False)
    portfolio_sync_state_id = Column(
        _BIGINT_PK,
        ForeignKey("portfolio_sync_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    broker_position_ref = Column(Text)
    canonical_symbol = Column(Text, nullable=False)
    market = Column(Text, nullable=False)
    currency = Column(Text, nullable=False)
    quantity = Column(Numeric(24, 8), nullable=False, default=0)
    avg_cost = Column(Numeric(24, 8), nullable=False, default=0)
    last_price = Column(Numeric(24, 8), nullable=False, default=0)
    market_value_base = Column(Numeric(24, 8), nullable=False, default=0)
    unrealized_pnl_base = Column(Numeric(24, 8), nullable=False, default=0)
    valuation_currency = Column(Text)
    payload_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "portfolio_sync_state_id",
            "canonical_symbol",
            "market",
            "currency",
            name="uq_phase_f_portfolio_sync_positions_key",
        ),
    )


class PhaseFPortfolioSyncCashBalance(PhaseFBase):
    __tablename__ = "portfolio_sync_cash_balances"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=False)
    portfolio_sync_state_id = Column(
        _BIGINT_PK,
        ForeignKey("portfolio_sync_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id = Column(String(64), ForeignKey("app_users.id"), nullable=False, index=True)
    portfolio_account_id = Column(_BIGINT_PK, ForeignKey("portfolio_accounts.id"), nullable=False, index=True)
    currency = Column(Text, nullable=False)
    amount = Column(Numeric(24, 8), nullable=False, default=0)
    amount_base = Column(Numeric(24, 8), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "portfolio_sync_state_id",
            "currency",
            name="uq_phase_f_portfolio_sync_cash_balances_key",
        ),
    )


def _phase_f_sql_doc_path() -> Path:
    return Path(__file__).resolve().parent.parent / "docs" / "architecture" / "postgresql-baseline-v1.sql"


def load_phase_f_sql_statements() -> list[str]:
    """Extract only the Phase F DDL statements from the authoritative baseline SQL doc."""
    sql_path = _phase_f_sql_doc_path()
    if not sql_path.exists():
        raise RuntimeError(f"Phase F schema source not found: {sql_path}")

    raw_text = sql_path.read_text(encoding="utf-8")
    text = "\n".join(line for line in raw_text.splitlines() if not line.lstrip().startswith("--"))
    statements = [stmt.strip() for stmt in text.split(";") if stmt.strip()]

    selected: list[str] = []
    table_pattern = re.compile(r"^create table if not exists\s+([a-z_][a-z0-9_]*)", re.IGNORECASE)
    index_pattern = re.compile(r"^create index if not exists\s+([a-z_][a-z0-9_]*)", re.IGNORECASE)

    for statement in statements:
        normalized = re.sub(r"\s+", " ", statement).strip()
        table_match = table_pattern.match(normalized)
        if table_match and table_match.group(1).lower() in _PHASE_F_TABLES:
            selected.append(f"{statement};")
            continue

        index_match = index_pattern.match(normalized)
        if index_match and index_match.group(1).lower() in _PHASE_F_INDEXES:
            selected.append(f"{statement};")

    if not selected:
        raise RuntimeError(f"No Phase F schema statements found in {sql_path}")
    return selected


class PostgresPhaseFStore:
    """Narrow storage adapter for the PostgreSQL Phase F baseline."""

    def __init__(self, db_url: str, *, auto_apply_schema: bool = True):
        if not str(db_url or "").strip():
            raise ValueError("db_url is required for PostgresPhaseFStore")

        self.db_url = str(db_url).strip()
        self._engine = create_engine(
            self.db_url,
            echo=False,
            pool_pre_ping=True,
        )
        self._SessionLocal = sessionmaker(
            bind=self._engine,
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )

        if auto_apply_schema:
            self.apply_schema()

    def dispose(self) -> None:
        self._engine.dispose()

    def apply_schema(self) -> None:
        apply_schema_slice(
            self._engine,
            schema_key="phase_f",
            source_path=_phase_f_sql_doc_path(),
            statements=load_phase_f_sql_statements(),
            metadata=PhaseFBase.metadata,
        )

    def get_session(self) -> Session:
        return self._SessionLocal()

    @contextmanager
    def session_scope(self):
        session = self.get_session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def list_account_rows(
        self,
        *,
        owner_user_id: Optional[str] = None,
        include_inactive: bool = False,
    ) -> list[Any]:
        with self.get_session() as session:
            query = select(PhaseFPortfolioAccount)
            if owner_user_id is not None:
                query = query.where(PhaseFPortfolioAccount.owner_user_id == str(owner_user_id).strip())
            if not include_inactive:
                query = query.where(PhaseFPortfolioAccount.is_active.is_(True))
            return list(
                session.execute(
                    query.order_by(PhaseFPortfolioAccount.id.asc())
                ).scalars().all()
            )

    def list_broker_connection_rows(
        self,
        *,
        owner_user_id: Optional[str] = None,
        portfolio_account_id: Optional[int] = None,
        broker_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[Any]:
        with self.get_session() as session:
            query = select(PhaseFBrokerConnection)
            if owner_user_id is not None:
                query = query.where(PhaseFBrokerConnection.owner_user_id == str(owner_user_id).strip())
            if portfolio_account_id is not None:
                query = query.where(PhaseFBrokerConnection.portfolio_account_id == int(portfolio_account_id))
            if broker_type is not None:
                query = query.where(PhaseFBrokerConnection.broker_type == str(broker_type).strip().lower())
            if status is not None:
                query = query.where(PhaseFBrokerConnection.status == str(status).strip().lower())
            return list(
                session.execute(
                    query.order_by(PhaseFBrokerConnection.id.asc())
                ).scalars().all()
            )

    def query_trade_list_comparison_candidate(
        self,
        *,
        account_id: Optional[int],
        date_from: Optional[date],
        date_to: Optional[date],
        symbol: Optional[str],
        side: Optional[str],
        page: int,
        page_size: int,
        owner_user_id: Optional[str] = None,
    ) -> dict[str, Any]:
        with self.get_session() as session:
            conditions = [PhaseFPortfolioLedger.entry_type == "trade"]
            if owner_user_id is not None:
                conditions.append(PhaseFPortfolioLedger.owner_user_id == str(owner_user_id).strip())
            if account_id is not None:
                conditions.append(PhaseFPortfolioLedger.portfolio_account_id == int(account_id))
            if date_from is not None:
                conditions.append(
                    PhaseFPortfolioLedger.event_time >= datetime.combine(date_from, time.min)
                )
            if date_to is not None:
                conditions.append(
                    PhaseFPortfolioLedger.event_time <= datetime.combine(date_to, time.max)
                )
            if symbol:
                conditions.append(PhaseFPortfolioLedger.canonical_symbol == str(symbol).strip())
            if side:
                conditions.append(PhaseFPortfolioLedger.direction == str(side).strip().lower())

            query = select(PhaseFPortfolioLedger)
            count_query = select(func.count()).select_from(PhaseFPortfolioLedger)
            for condition in conditions:
                query = query.where(condition)
                count_query = count_query.where(condition)

            total = int(session.execute(count_query).scalar_one() or 0)
            rows = session.execute(
                query
                .order_by(PhaseFPortfolioLedger.event_time.desc(), PhaseFPortfolioLedger.id.desc())
                .offset((int(page) - 1) * int(page_size))
                .limit(int(page_size))
            ).scalars().all()
            return {
                "items": [self._serialize_trade_list_comparison_row(row) for row in rows],
                "total": total,
                "page": int(page),
                "page_size": int(page_size),
            }

    @staticmethod
    def _safe_json_load(value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            raw_text = value.strip()
            if not raw_text:
                return {}
            try:
                parsed = json.loads(raw_text)
            except Exception:
                return {}
            if isinstance(parsed, dict):
                return parsed
        return {}

    @staticmethod
    def _serialize_time_value(value: Any) -> Optional[str]:
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return str(value)

    def _serialize_account_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "name": str(row.name or ""),
            "broker_label": row.broker_label,
            "market": str(row.market or ""),
            "base_currency": str(row.base_currency or ""),
            "is_active": bool(row.is_active),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_broker_connection_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "broker_type": str(row.broker_type or ""),
            "broker_name": row.broker_name,
            "connection_name": str(row.connection_name or ""),
            "broker_account_ref": row.broker_account_ref,
            "import_mode": str(row.import_mode or ""),
            "status": str(row.status or ""),
            "last_imported_at": self._serialize_time_value(getattr(row, "last_imported_at", None)),
            "last_import_source": row.last_import_source,
            "last_import_fingerprint": row.last_import_fingerprint,
            "sync_metadata": self._safe_json_load(getattr(row, "sync_metadata", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_ledger_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "entry_type": str(row.entry_type or ""),
            "event_time": self._serialize_time_value(getattr(row, "event_time", None)),
            "canonical_symbol": row.canonical_symbol,
            "market": row.market,
            "currency": row.currency,
            "direction": row.direction,
            "quantity": float(row.quantity) if row.quantity is not None else None,
            "price": float(row.price) if row.price is not None else None,
            "amount": float(row.amount) if row.amount is not None else None,
            "fee": float(row.fee) if row.fee is not None else None,
            "tax": float(row.tax) if row.tax is not None else None,
            "corporate_action_type": row.corporate_action_type,
            "external_ref": row.external_ref,
            "dedup_hash": row.dedup_hash,
            "note": row.note,
            "payload_json": self._safe_json_load(getattr(row, "payload_json", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
        }

    def _serialize_trade_list_comparison_row(self, row: Any) -> dict[str, Any]:
        payload = self._safe_json_load(getattr(row, "payload_json", None))
        legacy_row_id = int(payload.get("legacy_row_id") or 0)
        event_time = getattr(row, "event_time", None)
        trade_date = ""
        if isinstance(event_time, datetime):
            trade_date = event_time.date().isoformat()
        elif isinstance(event_time, date):
            trade_date = event_time.isoformat()

        return {
            "id": legacy_row_id,
            "account_id": int(getattr(row, "portfolio_account_id", 0) or 0),
            "trade_uid": payload.get("trade_uid") if payload.get("trade_uid") is not None else getattr(row, "external_ref", None),
            "symbol": str(getattr(row, "canonical_symbol", "") or ""),
            "market": getattr(row, "market", None),
            "currency": getattr(row, "currency", None),
            "trade_date": trade_date,
            "side": str(getattr(row, "direction", "") or ""),
            "quantity": float(getattr(row, "quantity", 0.0) or 0.0),
            "price": float(getattr(row, "price", 0.0) or 0.0),
            "fee": float(getattr(row, "fee", 0.0) or 0.0),
            "tax": float(getattr(row, "tax", 0.0) or 0.0),
            "note": getattr(row, "note", None),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
        }

    def _serialize_position_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "source_kind": str(row.source_kind or ""),
            "cost_method": str(row.cost_method or ""),
            "canonical_symbol": str(row.canonical_symbol or ""),
            "market": str(row.market or ""),
            "currency": str(row.currency or ""),
            "quantity": float(row.quantity) if row.quantity is not None else 0.0,
            "avg_cost": float(row.avg_cost) if row.avg_cost is not None else 0.0,
            "total_cost": float(row.total_cost) if row.total_cost is not None else 0.0,
            "last_price": float(row.last_price) if row.last_price is not None else None,
            "market_value_base": float(row.market_value_base) if row.market_value_base is not None else None,
            "unrealized_pnl_base": float(row.unrealized_pnl_base) if row.unrealized_pnl_base is not None else None,
            "valuation_currency": row.valuation_currency,
            "as_of_time": self._serialize_time_value(getattr(row, "as_of_time", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_state_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "broker_connection_id": int(row.broker_connection_id),
            "portfolio_account_id": int(row.portfolio_account_id),
            "broker_type": str(row.broker_type or ""),
            "broker_account_ref": row.broker_account_ref,
            "sync_source": str(row.sync_source or ""),
            "sync_status": str(row.sync_status or ""),
            "snapshot_date": self._serialize_time_value(getattr(row, "snapshot_date", None)),
            "synced_at": self._serialize_time_value(getattr(row, "synced_at", None)),
            "base_currency": str(row.base_currency or ""),
            "total_cash": float(row.total_cash) if row.total_cash is not None else 0.0,
            "total_market_value": float(row.total_market_value) if row.total_market_value is not None else 0.0,
            "total_equity": float(row.total_equity) if row.total_equity is not None else 0.0,
            "realized_pnl": float(row.realized_pnl) if row.realized_pnl is not None else 0.0,
            "unrealized_pnl": float(row.unrealized_pnl) if row.unrealized_pnl is not None else 0.0,
            "fx_stale": bool(row.fx_stale),
            "payload_json": self._safe_json_load(getattr(row, "payload_json", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_position_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "portfolio_sync_state_id": int(row.portfolio_sync_state_id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "broker_position_ref": row.broker_position_ref,
            "canonical_symbol": str(row.canonical_symbol or ""),
            "market": str(row.market or ""),
            "currency": str(row.currency or ""),
            "quantity": float(row.quantity) if row.quantity is not None else 0.0,
            "avg_cost": float(row.avg_cost) if row.avg_cost is not None else 0.0,
            "last_price": float(row.last_price) if row.last_price is not None else 0.0,
            "market_value_base": float(row.market_value_base) if row.market_value_base is not None else 0.0,
            "unrealized_pnl_base": float(row.unrealized_pnl_base) if row.unrealized_pnl_base is not None else 0.0,
            "valuation_currency": row.valuation_currency,
            "payload_json": self._safe_json_load(getattr(row, "payload_json", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_cash_balance_row(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "portfolio_sync_state_id": int(row.portfolio_sync_state_id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "currency": str(row.currency or ""),
            "amount": float(row.amount) if row.amount is not None else 0.0,
            "amount_base": float(row.amount_base) if row.amount_base is not None else 0.0,
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    @staticmethod
    def _date_to_datetime(value: Any, *, entry_type: str) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            second = _EVENT_PRIORITY_SECONDS.get(entry_type, 0)
            return datetime.combine(value, time(0, 0, second))
        if value is None:
            return datetime.now()
        try:
            parsed = datetime.fromisoformat(str(value))
        except Exception:
            try:
                parsed_date = date.fromisoformat(str(value))
            except Exception:
                return datetime.now()
            return datetime.combine(parsed_date, time(0, 0, _EVENT_PRIORITY_SECONDS.get(entry_type, 0)))
        return parsed

    @staticmethod
    def _position_as_of_time(*, position_row: Any, latest_snapshot_dates: dict[str, date]) -> datetime:
        cost_method = str(getattr(position_row, "cost_method", "") or "").strip().lower() or "fifo"
        snapshot_date = latest_snapshot_dates.get(cost_method)
        if snapshot_date is not None:
            return datetime.combine(snapshot_date, time(0, 0, 0))
        updated_at = getattr(position_row, "updated_at", None)
        if isinstance(updated_at, datetime):
            return updated_at
        return datetime.now()

    def delete_account_shadow(self, *, account_id: int) -> None:
        resolved_account_id = int(account_id)
        with self.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioSyncPosition).where(
                    PhaseFPortfolioSyncPosition.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioSyncCashBalance).where(
                    PhaseFPortfolioSyncCashBalance.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioSyncState).where(
                    PhaseFPortfolioSyncState.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioPosition).where(
                    PhaseFPortfolioPosition.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFBrokerConnection).where(
                    PhaseFBrokerConnection.portfolio_account_id == resolved_account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioAccount).where(
                    PhaseFPortfolioAccount.id == resolved_account_id
                )
            )

    def replace_account_shadow(
        self,
        *,
        account_row: Any,
        broker_connection_rows: Sequence[Any],
        trade_rows: Sequence[Any],
        cash_rows: Sequence[Any],
        corporate_action_rows: Sequence[Any],
        position_rows: Sequence[Any],
        snapshot_rows: Sequence[Any],
        sync_state_rows: Sequence[Any],
        sync_position_rows: Sequence[Any],
        sync_cash_balance_rows: Sequence[Any],
    ) -> None:
        account_id = int(account_row.id)
        latest_snapshot_dates: dict[str, date] = {}
        for row in sorted(
            list(snapshot_rows),
            key=lambda item: (
                str(getattr(item, "cost_method", "") or "").strip().lower(),
                getattr(item, "snapshot_date", None) or date.min,
                int(getattr(item, "id", 0) or 0),
            ),
            reverse=True,
        ):
            cost_method = str(getattr(row, "cost_method", "") or "").strip().lower() or "fifo"
            if cost_method not in latest_snapshot_dates and getattr(row, "snapshot_date", None) is not None:
                latest_snapshot_dates[cost_method] = row.snapshot_date

        sync_state_id_by_connection_id = {
            int(row.broker_connection_id): int(row.id)
            for row in list(sync_state_rows)
        }

        with self.session_scope() as session:
            existing_account = session.execute(
                select(PhaseFPortfolioAccount).where(PhaseFPortfolioAccount.id == account_id).limit(1)
            ).scalar_one_or_none()
            if existing_account is None:
                existing_account = PhaseFPortfolioAccount(id=account_id)
                session.add(existing_account)

            existing_account.owner_user_id = str(account_row.owner_id or "")
            existing_account.name = str(account_row.name or "")
            existing_account.broker_label = getattr(account_row, "broker", None)
            existing_account.market = str(account_row.market or "")
            existing_account.base_currency = str(account_row.base_currency or "")
            existing_account.is_active = bool(account_row.is_active)
            existing_account.created_at = getattr(account_row, "created_at", None) or datetime.now()
            existing_account.updated_at = getattr(account_row, "updated_at", None) or datetime.now()

            session.execute(
                delete(PhaseFPortfolioSyncPosition).where(
                    PhaseFPortfolioSyncPosition.portfolio_account_id == account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioSyncCashBalance).where(
                    PhaseFPortfolioSyncCashBalance.portfolio_account_id == account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioSyncState).where(
                    PhaseFPortfolioSyncState.portfolio_account_id == account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account_id
                )
            )
            session.execute(
                delete(PhaseFPortfolioPosition).where(
                    PhaseFPortfolioPosition.portfolio_account_id == account_id
                )
            )
            session.execute(
                delete(PhaseFBrokerConnection).where(
                    PhaseFBrokerConnection.portfolio_account_id == account_id
                )
            )

            for row in broker_connection_rows:
                session.add(
                    PhaseFBrokerConnection(
                        id=int(row.id),
                        owner_user_id=str(row.owner_id or ""),
                        portfolio_account_id=int(row.portfolio_account_id),
                        broker_type=str(row.broker_type or ""),
                        broker_name=getattr(row, "broker_name", None),
                        connection_name=str(row.connection_name or ""),
                        broker_account_ref=getattr(row, "broker_account_ref", None),
                        import_mode=str(row.import_mode or ""),
                        status=str(row.status or ""),
                        last_imported_at=getattr(row, "last_imported_at", None),
                        last_import_source=getattr(row, "last_import_source", None),
                        last_import_fingerprint=getattr(row, "last_import_fingerprint", None),
                        sync_metadata=self._safe_json_load(getattr(row, "sync_metadata_json", None)),
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                        updated_at=getattr(row, "updated_at", None) or datetime.now(),
                    )
                )

            for row in trade_rows:
                session.add(
                    PhaseFPortfolioLedger(
                        id=phase_f_ledger_shadow_id("trade", int(row.id)),
                        owner_user_id=str(account_row.owner_id or ""),
                        portfolio_account_id=account_id,
                        entry_type="trade",
                        event_time=self._date_to_datetime(getattr(row, "trade_date", None), entry_type="trade"),
                        canonical_symbol=str(row.symbol or ""),
                        market=getattr(row, "market", None),
                        currency=getattr(row, "currency", None),
                        direction=str(row.side or ""),
                        quantity=getattr(row, "quantity", None),
                        price=getattr(row, "price", None),
                        amount=None,
                        fee=getattr(row, "fee", None),
                        tax=getattr(row, "tax", None),
                        corporate_action_type=None,
                        external_ref=getattr(row, "trade_uid", None),
                        dedup_hash=getattr(row, "dedup_hash", None),
                        note=getattr(row, "note", None),
                        payload_json={
                            "legacy_table": "portfolio_trades",
                            "legacy_row_id": int(row.id),
                            "trade_uid": getattr(row, "trade_uid", None),
                            "side": getattr(row, "side", None),
                            "quantity": float(getattr(row, "quantity", 0.0) or 0.0),
                            "price": float(getattr(row, "price", 0.0) or 0.0),
                            "fee": float(getattr(row, "fee", 0.0) or 0.0),
                            "tax": float(getattr(row, "tax", 0.0) or 0.0),
                            "note": getattr(row, "note", None),
                        },
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                    )
                )

            for row in cash_rows:
                session.add(
                    PhaseFPortfolioLedger(
                        id=phase_f_ledger_shadow_id("cash", int(row.id)),
                        owner_user_id=str(account_row.owner_id or ""),
                        portfolio_account_id=account_id,
                        entry_type="cash",
                        event_time=self._date_to_datetime(getattr(row, "event_date", None), entry_type="cash"),
                        canonical_symbol=None,
                        market=None,
                        currency=getattr(row, "currency", None),
                        direction=str(row.direction or ""),
                        quantity=None,
                        price=None,
                        amount=getattr(row, "amount", None),
                        fee=None,
                        tax=None,
                        corporate_action_type=None,
                        external_ref=None,
                        dedup_hash=None,
                        note=getattr(row, "note", None),
                        payload_json={
                            "legacy_table": "portfolio_cash_ledger",
                            "legacy_row_id": int(row.id),
                            "direction": getattr(row, "direction", None),
                            "amount": float(getattr(row, "amount", 0.0) or 0.0),
                            "currency": getattr(row, "currency", None),
                            "note": getattr(row, "note", None),
                        },
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                    )
                )

            for row in corporate_action_rows:
                session.add(
                    PhaseFPortfolioLedger(
                        id=phase_f_ledger_shadow_id("corporate_action", int(row.id)),
                        owner_user_id=str(account_row.owner_id or ""),
                        portfolio_account_id=account_id,
                        entry_type="corporate_action",
                        event_time=self._date_to_datetime(
                            getattr(row, "effective_date", None),
                            entry_type="corporate_action",
                        ),
                        canonical_symbol=str(row.symbol or ""),
                        market=getattr(row, "market", None),
                        currency=getattr(row, "currency", None),
                        direction=None,
                        quantity=None,
                        price=None,
                        amount=None,
                        fee=None,
                        tax=None,
                        corporate_action_type=getattr(row, "action_type", None),
                        external_ref=None,
                        dedup_hash=None,
                        note=getattr(row, "note", None),
                        payload_json={
                            "legacy_table": "portfolio_corporate_actions",
                            "legacy_row_id": int(row.id),
                            "action_type": getattr(row, "action_type", None),
                            "cash_dividend_per_share": getattr(row, "cash_dividend_per_share", None),
                            "split_ratio": getattr(row, "split_ratio", None),
                            "note": getattr(row, "note", None),
                        },
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                    )
                )

            for row in position_rows:
                session.add(
                    PhaseFPortfolioPosition(
                        id=int(row.id),
                        owner_user_id=str(account_row.owner_id or ""),
                        portfolio_account_id=account_id,
                        source_kind="replayed_ledger",
                        cost_method=str(row.cost_method or ""),
                        canonical_symbol=str(row.symbol or ""),
                        market=str(row.market or ""),
                        currency=str(row.currency or ""),
                        quantity=getattr(row, "quantity", None),
                        avg_cost=getattr(row, "avg_cost", None),
                        total_cost=getattr(row, "total_cost", None),
                        last_price=getattr(row, "last_price", None),
                        market_value_base=getattr(row, "market_value_base", None),
                        unrealized_pnl_base=getattr(row, "unrealized_pnl_base", None),
                        valuation_currency=getattr(row, "valuation_currency", None),
                        as_of_time=self._position_as_of_time(
                            position_row=row,
                            latest_snapshot_dates=latest_snapshot_dates,
                        ),
                        created_at=getattr(row, "updated_at", None) or datetime.now(),
                        updated_at=getattr(row, "updated_at", None) or datetime.now(),
                    )
                )

            for row in sync_state_rows:
                session.add(
                    PhaseFPortfolioSyncState(
                        id=int(row.id),
                        owner_user_id=str(row.owner_id or ""),
                        broker_connection_id=int(row.broker_connection_id),
                        portfolio_account_id=int(row.portfolio_account_id),
                        broker_type=str(row.broker_type or ""),
                        broker_account_ref=getattr(row, "broker_account_ref", None),
                        sync_source=str(row.sync_source or ""),
                        sync_status=str(row.sync_status or ""),
                        snapshot_date=row.snapshot_date,
                        synced_at=row.synced_at,
                        base_currency=str(row.base_currency or ""),
                        total_cash=getattr(row, "total_cash", None),
                        total_market_value=getattr(row, "total_market_value", None),
                        total_equity=getattr(row, "total_equity", None),
                        realized_pnl=getattr(row, "realized_pnl", None),
                        unrealized_pnl=getattr(row, "unrealized_pnl", None),
                        fx_stale=bool(getattr(row, "fx_stale", False)),
                        payload_json=self._safe_json_load(getattr(row, "payload_json", None)),
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                        updated_at=getattr(row, "updated_at", None) or datetime.now(),
                    )
                )

            # Flush parent account/connection/state rows before adding snapshot members.
            session.flush()

            for row in sync_position_rows:
                sync_state_id = sync_state_id_by_connection_id.get(int(row.broker_connection_id))
                if sync_state_id is None:
                    logger.warning(
                        "Skipping orphaned Phase F sync position shadow for broker_connection_id=%s",
                        row.broker_connection_id,
                    )
                    continue
                session.add(
                    PhaseFPortfolioSyncPosition(
                        id=int(row.id),
                        portfolio_sync_state_id=sync_state_id,
                        owner_user_id=str(row.owner_id or ""),
                        portfolio_account_id=int(row.portfolio_account_id),
                        broker_position_ref=getattr(row, "broker_position_ref", None),
                        canonical_symbol=str(row.symbol or ""),
                        market=str(row.market or ""),
                        currency=str(row.currency or ""),
                        quantity=getattr(row, "quantity", None),
                        avg_cost=getattr(row, "avg_cost", None),
                        last_price=getattr(row, "last_price", None),
                        market_value_base=getattr(row, "market_value_base", None),
                        unrealized_pnl_base=getattr(row, "unrealized_pnl_base", None),
                        valuation_currency=getattr(row, "valuation_currency", None),
                        payload_json=self._safe_json_load(getattr(row, "payload_json", None)),
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                        updated_at=getattr(row, "updated_at", None) or datetime.now(),
                    )
                )

            for row in sync_cash_balance_rows:
                sync_state_id = sync_state_id_by_connection_id.get(int(row.broker_connection_id))
                if sync_state_id is None:
                    logger.warning(
                        "Skipping orphaned Phase F cash-balance shadow for broker_connection_id=%s",
                        row.broker_connection_id,
                    )
                    continue
                session.add(
                    PhaseFPortfolioSyncCashBalance(
                        id=int(row.id),
                        portfolio_sync_state_id=sync_state_id,
                        owner_user_id=str(row.owner_id or ""),
                        portfolio_account_id=int(row.portfolio_account_id),
                        currency=str(row.currency or ""),
                        amount=getattr(row, "amount", None),
                        amount_base=getattr(row, "amount_base", None),
                        created_at=getattr(row, "created_at", None) or datetime.now(),
                        updated_at=getattr(row, "updated_at", None) or datetime.now(),
                    )
                )

    def get_account_shadow_bundle(self, *, account_id: int) -> Optional[dict[str, Any]]:
        resolved_account_id = int(account_id)
        with self.get_session() as session:
            account_row = session.execute(
                select(PhaseFPortfolioAccount)
                .where(PhaseFPortfolioAccount.id == resolved_account_id)
                .limit(1)
            ).scalar_one_or_none()
            if account_row is None:
                return None

            broker_connection_rows = session.execute(
                select(PhaseFBrokerConnection)
                .where(PhaseFBrokerConnection.portfolio_account_id == resolved_account_id)
                .order_by(PhaseFBrokerConnection.id.asc())
            ).scalars().all()
            ledger_rows = session.execute(
                select(PhaseFPortfolioLedger)
                .where(PhaseFPortfolioLedger.portfolio_account_id == resolved_account_id)
                .order_by(PhaseFPortfolioLedger.event_time.asc(), PhaseFPortfolioLedger.id.asc())
            ).scalars().all()
            position_rows = session.execute(
                select(PhaseFPortfolioPosition)
                .where(PhaseFPortfolioPosition.portfolio_account_id == resolved_account_id)
                .order_by(
                    PhaseFPortfolioPosition.source_kind.asc(),
                    PhaseFPortfolioPosition.cost_method.asc(),
                    PhaseFPortfolioPosition.canonical_symbol.asc(),
                    PhaseFPortfolioPosition.id.asc(),
                )
            ).scalars().all()
            sync_state_row = session.execute(
                select(PhaseFPortfolioSyncState)
                .where(PhaseFPortfolioSyncState.portfolio_account_id == resolved_account_id)
                .order_by(PhaseFPortfolioSyncState.synced_at.desc(), PhaseFPortfolioSyncState.id.desc())
                .limit(1)
            ).scalar_one_or_none()

            sync_position_rows: list[Any] = []
            sync_cash_balance_rows: list[Any] = []
            if sync_state_row is not None:
                sync_position_rows = session.execute(
                    select(PhaseFPortfolioSyncPosition)
                    .where(PhaseFPortfolioSyncPosition.portfolio_sync_state_id == int(sync_state_row.id))
                    .order_by(PhaseFPortfolioSyncPosition.canonical_symbol.asc(), PhaseFPortfolioSyncPosition.id.asc())
                ).scalars().all()
                sync_cash_balance_rows = session.execute(
                    select(PhaseFPortfolioSyncCashBalance)
                    .where(PhaseFPortfolioSyncCashBalance.portfolio_sync_state_id == int(sync_state_row.id))
                    .order_by(PhaseFPortfolioSyncCashBalance.currency.asc(), PhaseFPortfolioSyncCashBalance.id.asc())
                ).scalars().all()

            return {
                "account": self._serialize_account_row(account_row),
                "broker_connections": [self._serialize_broker_connection_row(row) for row in broker_connection_rows],
                "ledger": [self._serialize_ledger_row(row) for row in ledger_rows],
                "positions": [self._serialize_position_row(row) for row in position_rows],
                "sync_state": self._serialize_sync_state_row(sync_state_row) if sync_state_row is not None else None,
                "sync_positions": [self._serialize_sync_position_row(row) for row in sync_position_rows],
                "sync_cash_balances": [
                    self._serialize_sync_cash_balance_row(row)
                    for row in sync_cash_balance_rows
                ],
            }

    def clear_non_bootstrap_state(self, user_ids: Iterable[str]) -> dict[str, int]:
        normalized_user_ids = sorted({str(user_id or "").strip() for user_id in user_ids if str(user_id or "").strip()})
        counts = {
            "portfolio_sync_positions": 0,
            "portfolio_sync_cash_balances": 0,
            "portfolio_sync_states": 0,
            "portfolio_ledger": 0,
            "portfolio_positions": 0,
            "broker_connections": 0,
            "portfolio_accounts": 0,
        }
        if not normalized_user_ids:
            return counts

        with self.session_scope() as session:
            counts["portfolio_sync_positions"] = session.execute(
                delete(PhaseFPortfolioSyncPosition).where(
                    PhaseFPortfolioSyncPosition.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["portfolio_sync_cash_balances"] = session.execute(
                delete(PhaseFPortfolioSyncCashBalance).where(
                    PhaseFPortfolioSyncCashBalance.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["portfolio_sync_states"] = session.execute(
                delete(PhaseFPortfolioSyncState).where(
                    PhaseFPortfolioSyncState.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["portfolio_ledger"] = session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["portfolio_positions"] = session.execute(
                delete(PhaseFPortfolioPosition).where(
                    PhaseFPortfolioPosition.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["broker_connections"] = session.execute(
                delete(PhaseFBrokerConnection).where(
                    PhaseFBrokerConnection.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0
            counts["portfolio_accounts"] = session.execute(
                delete(PhaseFPortfolioAccount).where(
                    PhaseFPortfolioAccount.owner_user_id.in_(normalized_user_ids)
                )
            ).rowcount or 0

        return {key: int(value or 0) for key, value in counts.items()}
