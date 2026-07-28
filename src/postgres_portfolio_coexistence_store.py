# -*- coding: utf-8 -*-
"""Narrow Phase F persistence adapter for PostgreSQL-backed portfolio data."""

from __future__ import annotations

import json
import logging
import re
from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import Decimal
from math import isfinite, ulp
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
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    inspect,
    select,
)
from sqlalchemy.orm import Session

from src.portfolio_exact_numeric import (
    PortfolioExactNumeric,
    serialize_portfolio_decimal,
)
from src.postgres_identity_store import PhaseABase
from src.postgres_store_utils import (
    apply_baseline_schema,
    baseline_sql_doc_path,
    build_schema_apply_report,
    create_session_factory,
    create_store_engine,
    describe_store_runtime,
    load_baseline_sql_statements,
    managed_session_scope,
)
from src.sqlite_foreign_keys import (
    read_sqlite_foreign_keys,
)

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
    quantity = Column(PortfolioExactNumeric())
    price = Column(PortfolioExactNumeric())
    amount = Column(PortfolioExactNumeric())
    fee = Column(PortfolioExactNumeric())
    tax = Column(PortfolioExactNumeric())
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
    quantity = Column(PortfolioExactNumeric(), nullable=False, default=0)
    avg_cost = Column(PortfolioExactNumeric(), nullable=False, default=0)
    total_cost = Column(PortfolioExactNumeric(), nullable=False, default=0)
    last_price = Column(PortfolioExactNumeric())
    market_value_base = Column(PortfolioExactNumeric())
    unrealized_pnl_base = Column(PortfolioExactNumeric())
    valuation_currency = Column(Text)
    as_of_time = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    price_cost = Column(PortfolioExactNumeric())

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
    total_cash = Column(PortfolioExactNumeric(), nullable=False, default=0)
    total_market_value = Column(PortfolioExactNumeric(), nullable=False, default=0)
    total_equity = Column(PortfolioExactNumeric(), nullable=False, default=0)
    realized_pnl = Column(PortfolioExactNumeric(), nullable=False, default=0)
    unrealized_pnl = Column(PortfolioExactNumeric(), nullable=False, default=0)
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
    quantity = Column(PortfolioExactNumeric(), nullable=False, default=0)
    avg_cost = Column(PortfolioExactNumeric(), nullable=False, default=0)
    last_price = Column(PortfolioExactNumeric(), nullable=False, default=0)
    market_value_base = Column(PortfolioExactNumeric(), nullable=False, default=0)
    unrealized_pnl_base = Column(PortfolioExactNumeric(), nullable=False, default=0)
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
    amount = Column(PortfolioExactNumeric(), nullable=False, default=0)
    amount_base = Column(PortfolioExactNumeric(), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint(
            "portfolio_sync_state_id",
            "currency",
            name="uq_phase_f_portfolio_sync_cash_balances_key",
        ),
    )


_PHASE_F_EXACT_TABLES = (
    PhaseFPortfolioLedger.__table__,
    PhaseFPortfolioPosition.__table__,
    PhaseFPortfolioSyncState.__table__,
    PhaseFPortfolioSyncPosition.__table__,
    PhaseFPortfolioSyncCashBalance.__table__,
)
_PHASE_F_EXACT_TABLES_BY_NAME = {
    str(table.name): table for table in _PHASE_F_EXACT_TABLES
}
_PHASE_F_SQLITE_REBUILD_SOURCE_TABLES = (
    PhaseFPortfolioAccount.__table__,
    PhaseFBrokerConnection.__table__,
    *_PHASE_F_EXACT_TABLES,
)
_PHASE_F_SQLITE_REBUILD_SOURCE_TABLES_BY_NAME = {
    str(table.name): table for table in _PHASE_F_SQLITE_REBUILD_SOURCE_TABLES
}
_PHASE_F_SQLITE_REBUILD_TARGET_TABLE_NAMES = frozenset(_PHASE_F_EXACT_TABLES_BY_NAME)
_PHASE_F_EXACT_NUMERIC_COLUMNS = {
    str(table.name): tuple(
        str(column.name)
        for column in table.columns
        if isinstance(column.type, PortfolioExactNumeric)
    )
    for table in _PHASE_F_EXACT_TABLES
}
_PHASE_F_SQLITE_REBUILD_CREATE_ORDER = _PHASE_F_EXACT_TABLES
_PHASE_F_SQLITE_REBUILD_DROP_ORDER = tuple(reversed(_PHASE_F_EXACT_TABLES))
_PHASE_F_SQLITE_OPTIONAL_LEGACY_COLUMNS = {
    "portfolio_positions": frozenset({"price_cost"}),
}
_PHASE_F_SQLITE_LEGACY_NUMERIC_DECLARATION = "NUMERIC(24, 8)"
_PHASE_F_SQLITE_STORAGE_QUANTUM = Decimal("0.00000001")


def _phase_f_sql_doc_path() -> Path:
    return baseline_sql_doc_path()


def load_phase_f_sql_statements() -> list[str]:
    """Extract only the Phase F DDL statements from the authoritative baseline SQL doc."""
    return load_baseline_sql_statements(
        table_names=_PHASE_F_TABLES,
        index_names=_PHASE_F_INDEXES,
        source_path=_phase_f_sql_doc_path(),
    )


class PostgresPhaseFStore:
    """Narrow storage adapter for the PostgreSQL Phase F baseline."""
    SCHEMA_KEY = "phase_f"
    MODE = "comparison_only_shadow"
    EXPECTED_TABLES = _PHASE_F_TABLES
    EXPECTED_INDEXES = _PHASE_F_INDEXES
    EXPECTED_CONSTRAINTS: tuple[tuple[str, str], ...] = ()

    def __init__(self, db_url: str, *, auto_apply_schema: bool = True):
        if not str(db_url or "").strip():
            raise ValueError("db_url is required for PostgresPhaseFStore")

        self.db_url = str(db_url).strip()
        self._engine = create_store_engine(self.db_url)
        self._SessionLocal = create_session_factory(self._engine)
        self._last_schema_apply_report = build_schema_apply_report(
            schema_key=self.SCHEMA_KEY,
            status="skipped" if not auto_apply_schema else "pending",
            source_path=_phase_f_sql_doc_path(),
            dialect=self._engine.dialect.name,
            skip_reason="auto_apply_schema_disabled" if not auto_apply_schema else None,
        )

        if auto_apply_schema:
            self.apply_schema()

    def dispose(self) -> None:
        self._engine.dispose()

    def apply_schema(self) -> None:
        try:
            self._migrate_sqlite_exact_numeric_storage()
            self._last_schema_apply_report = apply_baseline_schema(
                self._engine,
                schema_key=self.SCHEMA_KEY,
                metadata=PhaseFBase.metadata,
                table_names=self.EXPECTED_TABLES,
                index_names=self.EXPECTED_INDEXES,
                constraint_names=self.EXPECTED_CONSTRAINTS,
                source_path=_phase_f_sql_doc_path(),
            )
            self._migrate_portfolio_position_price_cost_column()
        except Exception as exc:
            self._last_schema_apply_report = build_schema_apply_report(
                schema_key=self.SCHEMA_KEY,
                status="failed",
                source_path=_phase_f_sql_doc_path(),
                dialect=self._engine.dialect.name,
                error=f"{exc.__class__.__name__}: {exc}",
            )
            logger.exception("Phase F schema initialization failed")
            raise

    @staticmethod
    def _quote_sqlite_identifier(identifier: str) -> str:
        return '"' + str(identifier).replace('"', '""') + '"'

    @staticmethod
    def _sqlite_exact_numeric_error(message: str) -> RuntimeError:
        return RuntimeError(f"SQLite Phase F exact-numeric migration {message}")

    @staticmethod
    def _normalize_sqlite_declaration(value: Any) -> str:
        return re.sub(r"\s+", "", str(value or "")).upper()

    @classmethod
    def _is_sqlite_legacy_numeric_type(cls, declared_type: str) -> bool:
        return cls._normalize_sqlite_declaration(
            declared_type
        ) == cls._normalize_sqlite_declaration(
            _PHASE_F_SQLITE_LEGACY_NUMERIC_DECLARATION
        )

    def _expected_sqlite_rebuild_column_type(self, connection: Any, column: Any) -> str:
        if isinstance(column.type, PortfolioExactNumeric):
            return "TEXT"
        return self._normalize_sqlite_declaration(
            connection.dialect.type_compiler.process(column.type)
        )

    def _sqlite_explicit_index_inventory(
        self,
        connection: Any,
        *,
        table_name: str,
    ) -> tuple[tuple[Any, ...], ...]:
        quoted_table = self._quote_sqlite_identifier(table_name)
        inventory: list[tuple[Any, ...]] = []
        for row in connection.exec_driver_sql(
            f"PRAGMA index_list({quoted_table})"
        ).mappings():
            if str(row["origin"]) != "c":
                continue
            index_name = str(row["name"])
            quoted_index = self._quote_sqlite_identifier(index_name)
            key_rows = sorted(
                (
                    item
                    for item in connection.exec_driver_sql(
                        f"PRAGMA index_xinfo({quoted_index})"
                    ).mappings()
                    if int(item["key"]) == 1
                ),
                key=lambda item: int(item["seqno"]),
            )
            inventory.append(
                (
                    index_name,
                    int(row["unique"]),
                    int(row["partial"]),
                    tuple(
                        (
                            None if item["name"] is None else str(item["name"]),
                            int(item["desc"]),
                            str(item["coll"] or "").upper(),
                        )
                        for item in key_rows
                    ),
                )
            )
        return tuple(sorted(inventory))

    def _expected_sqlite_explicit_index_inventory(
        self,
        *,
        table: Any,
    ) -> tuple[tuple[Any, ...], ...]:
        inventory: list[tuple[Any, ...]] = []
        for index in table.indexes:
            if index.name is None or index.dialect_options["sqlite"].get("where") is not None:
                raise self._sqlite_exact_numeric_error(
                    f"requires manual index review: {table.name}"
                )
            inventory.append(
                (
                    str(index.name),
                    int(bool(index.unique)),
                    0,
                    tuple((str(column.name), 0, "BINARY") for column in index.columns),
                )
            )
        return tuple(sorted(inventory))

    def _sqlite_unique_constraint_inventory(
        self,
        connection: Any,
        *,
        table_name: str,
    ) -> tuple[tuple[Any, ...], ...]:
        quoted_table = self._quote_sqlite_identifier(table_name)
        inventory: list[tuple[Any, ...]] = []
        for row in connection.exec_driver_sql(
            f"PRAGMA index_list({quoted_table})"
        ).mappings():
            if str(row["origin"]) != "u":
                continue
            quoted_index = self._quote_sqlite_identifier(str(row["name"]))
            key_rows = sorted(
                (
                    item
                    for item in connection.exec_driver_sql(
                        f"PRAGMA index_xinfo({quoted_index})"
                    ).mappings()
                    if int(item["key"]) == 1
                ),
                key=lambda item: int(item["seqno"]),
            )
            inventory.append(
                (
                    int(row["partial"]),
                    tuple(
                        (
                            None if item["name"] is None else str(item["name"]),
                            int(item["desc"]),
                            str(item["coll"] or "").upper(),
                        )
                        for item in key_rows
                    ),
                )
            )
        return tuple(sorted(inventory))

    def _expected_sqlite_unique_constraint_inventory(
        self,
        *,
        table: Any,
    ) -> tuple[tuple[Any, ...], ...]:
        inventory = []
        for constraint in table.constraints:
            if not isinstance(constraint, UniqueConstraint):
                continue
            inventory.append(
                (
                    0,
                    tuple(
                        (str(column.name), 0, "BINARY")
                        for column in constraint.columns
                    ),
                )
            )
        return tuple(sorted(inventory))

    @staticmethod
    def _normalize_sqlite_check_sql(expression: Any) -> str:
        value = "" if expression is None else str(expression)
        return re.sub(r"\s+", " ", value).strip().casefold()

    def _expected_sqlite_check_constraint_inventory(
        self,
        *,
        table: Any,
    ) -> tuple[tuple[str, str], ...]:
        return tuple(
            sorted(
                (
                    str(constraint.name or ""),
                    self._normalize_sqlite_check_sql(constraint.sqltext),
                )
                for constraint in table.constraints
                if isinstance(constraint, CheckConstraint)
            )
        )

    def _assert_sqlite_legacy_exact_numeric_source_table(
        self,
        connection: Any,
        *,
        table: Any,
    ) -> None:
        table_name = str(table.name)
        optional_missing = _PHASE_F_SQLITE_OPTIONAL_LEGACY_COLUMNS.get(
            table_name,
            frozenset(),
        )
        actual_rows = tuple(
            connection.exec_driver_sql(
                f"PRAGMA table_xinfo({self._quote_sqlite_identifier(table_name)})"
            ).mappings()
        )
        all_expected_columns = tuple(table.columns)
        full_column_names = tuple(str(column.name) for column in all_expected_columns)
        allowed_missing_column_names = tuple(
            str(column.name)
            for column in all_expected_columns
            if str(column.name) not in optional_missing
        )
        actual_column_names = tuple(str(row["name"]) for row in actual_rows)
        if actual_column_names == full_column_names:
            expected_columns = all_expected_columns
        elif actual_column_names == allowed_missing_column_names:
            expected_columns = tuple(
                column
                for column in all_expected_columns
                if str(column.name) not in optional_missing
            )
        else:
            raise self._sqlite_exact_numeric_error(
                f"requires manual column review: {table_name}"
            )

        exact_column_names = set(_PHASE_F_EXACT_NUMERIC_COLUMNS.get(table_name, ()))
        for row, column in zip(actual_rows, expected_columns):
            if column.server_default is not None:
                raise self._sqlite_exact_numeric_error(
                    f"requires manual default review: {table_name}.{column.name}"
                )
            actual_identity = (
                int(row["notnull"]),
                None if row["dflt_value"] is None else str(row["dflt_value"]),
                int(row["pk"]),
                int(row["hidden"]),
            )
            expected_identity = (
                int(not column.nullable),
                None,
                int(column.primary_key),
                0,
            )
            if actual_identity != expected_identity:
                raise self._sqlite_exact_numeric_error(
                    f"requires manual column review: {table_name}.{column.name}"
                )

            actual_type = self._normalize_sqlite_declaration(row["type"])
            if str(column.name) in exact_column_names:
                expected_type = self._normalize_sqlite_declaration(
                    _PHASE_F_SQLITE_LEGACY_NUMERIC_DECLARATION
                )
                if actual_type != expected_type:
                    raise self._sqlite_exact_numeric_error(
                        "requires supported legacy exact declaration: "
                        f"{table_name}.{column.name}"
                    )
                continue

            expected_type = self._expected_sqlite_rebuild_column_type(connection, column)
            if actual_type != expected_type:
                raise self._sqlite_exact_numeric_error(
                    f"requires manual column review: {table_name}.{column.name}"
                )

        if self._sqlite_explicit_index_inventory(
            connection,
            table_name=table_name,
        ) != self._expected_sqlite_explicit_index_inventory(table=table):
            raise self._sqlite_exact_numeric_error(
                f"requires manual index review: {table_name}"
            )
        if self._sqlite_unique_constraint_inventory(
            connection,
            table_name=table_name,
        ) != self._expected_sqlite_unique_constraint_inventory(table=table):
            raise self._sqlite_exact_numeric_error(
                f"requires manual unique-constraint review: {table_name}"
            )

        actual_checks = tuple(
            sorted(
                (
                    str(constraint.get("name") or ""),
                    self._normalize_sqlite_check_sql(constraint.get("sqltext")),
                )
                for constraint in inspect(connection).get_check_constraints(table_name)
            )
        )
        if actual_checks != self._expected_sqlite_check_constraint_inventory(table=table):
            raise self._sqlite_exact_numeric_error(
                f"requires manual check-constraint review: {table_name}"
            )

        table_sql = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = :table_name",
            {"table_name": table_name},
        ).scalar_one_or_none()
        normalized_sql = re.sub(r"\s+", " ", str(table_sql or "").upper())
        if not normalized_sql or (
            " AUTOINCREMENT" in normalized_sql
            or any(marker in str(table_sql) for marker in ("--", "/*", "*/"))
            or re.search(
                r"\b(?:COLLATE|DEFERRABLE|INITIALLY)\b|\bON\s+CONFLICT\b|"
                r"\bWITHOUT\s+ROWID\b|\bSTRICT\b",
                normalized_sql,
            )
            is not None
        ):
            raise self._sqlite_exact_numeric_error(
                f"requires manual constraint review: {table_name}"
            )

    @classmethod
    def _sqlite_schema_sql_references_table(
        cls,
        statement: Any,
        *,
        table_name: str,
    ) -> bool:
        escaped_table_name = re.escape(table_name)
        return re.search(
            rf"(?<![A-Za-z0-9_$])(?:\"{escaped_table_name}\"|"
            rf"`{escaped_table_name}`|\[{escaped_table_name}\]|{escaped_table_name})"
            r"(?![A-Za-z0-9_$])",
            str(statement or ""),
            flags=re.IGNORECASE,
        ) is not None

    def _assert_sqlite_rebuild_has_no_unmanaged_triggers(self, connection: Any) -> None:
        for row in connection.exec_driver_sql(
            "SELECT name, tbl_name, sql FROM sqlite_schema "
            "WHERE type = 'trigger' ORDER BY tbl_name, name"
        ).mappings():
            trigger_table = str(row["tbl_name"] or "")
            if trigger_table in _PHASE_F_SQLITE_REBUILD_SOURCE_TABLES_BY_NAME or any(
                self._sqlite_schema_sql_references_table(
                    row["sql"],
                    table_name=table_name,
                )
                for table_name in _PHASE_F_SQLITE_REBUILD_TARGET_TABLE_NAMES
            ):
                raise self._sqlite_exact_numeric_error(
                    "requires manual trigger review: "
                    f"{trigger_table}.{row['name']}"
                )

    def _assert_sqlite_rebuild_has_no_referencing_views(self, connection: Any) -> None:
        for row in connection.exec_driver_sql(
            "SELECT name, sql FROM sqlite_schema WHERE type = 'view' ORDER BY name"
        ).mappings():
            if any(
                self._sqlite_schema_sql_references_table(
                    row["sql"],
                    table_name=table_name,
                )
                for table_name in _PHASE_F_SQLITE_REBUILD_TARGET_TABLE_NAMES
            ):
                raise self._sqlite_exact_numeric_error(
                    f"requires manual view review: {row['name']}"
                )

    def _assert_sqlite_legacy_exact_numeric_foreign_key_inventory(
        self,
        connection: Any,
    ) -> None:
        source_table_names = tuple(_PHASE_F_SQLITE_REBUILD_SOURCE_TABLES_BY_NAME)
        actual_foreign_keys = read_sqlite_foreign_keys(
            connection,
            source_table_names,
        )
        expected_foreign_keys = type(actual_foreign_keys)(
            (
                str(table.name),
                str(foreign_key.parent.name),
                str(foreign_key.column.table.name),
                str(foreign_key.column.name),
                str(foreign_key.onupdate or "NO ACTION").strip().upper(),
                str(foreign_key.ondelete or "NO ACTION").strip().upper(),
                str(foreign_key.match or "NONE").strip().upper(),
            )
            for table in _PHASE_F_SQLITE_REBUILD_SOURCE_TABLES
            for foreign_key in table.foreign_keys
        )
        if actual_foreign_keys != expected_foreign_keys:
            raise self._sqlite_exact_numeric_error(
                "requires manual foreign-key review for the Phase F source graph"
            )

        existing_table_names = tuple(
            str(table_name)
            for table_name in inspect(connection).get_table_names()
        )
        inbound_foreign_keys = sorted(
            identity
            for identity in read_sqlite_foreign_keys(
                connection,
                existing_table_names,
            ).elements()
            if identity[2] in _PHASE_F_SQLITE_REBUILD_TARGET_TABLE_NAMES
            and identity[0] not in _PHASE_F_SQLITE_REBUILD_TARGET_TABLE_NAMES
        )
        if inbound_foreign_keys:
            first = inbound_foreign_keys[0]
            raise self._sqlite_exact_numeric_error(
                "requires manual inbound foreign-key review: "
                f"{first[0]}.{first[1]} -> {first[2]}.{first[3]}"
            )

    def _qualify_sqlite_legacy_exact_numeric_rebuild_source(self, connection: Any) -> None:
        """Accept only the reviewed legacy graph before the destructive rebuild."""
        self._assert_sqlite_rebuild_has_no_unmanaged_triggers(connection)
        self._assert_sqlite_rebuild_has_no_referencing_views(connection)
        for table in _PHASE_F_SQLITE_REBUILD_SOURCE_TABLES:
            self._assert_sqlite_legacy_exact_numeric_source_table(
                connection,
                table=table,
            )
        self._assert_sqlite_legacy_exact_numeric_foreign_key_inventory(connection)
        if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
            raise self._sqlite_exact_numeric_error(
                "requires a foreign-key-clean source database"
            )

    def _sqlite_exact_numeric_schema_state(self, connection: Any) -> str:
        """Classify an existing SQLite Phase F schema without accepting partial state."""
        inspector = inspect(connection)
        existing_table_names = {str(name) for name in inspector.get_table_names()}
        present_phase_f_tables = _PHASE_F_TABLES & existing_table_names
        if not present_phase_f_tables:
            return "absent"

        missing_phase_f_tables = sorted(_PHASE_F_TABLES - existing_table_names)
        if missing_phase_f_tables:
            raise self._sqlite_exact_numeric_error(
                "requires a complete Phase F schema; missing tables: "
                + ", ".join(missing_phase_f_tables)
            )

        table_states: set[str] = set()
        for table_name, exact_column_names in _PHASE_F_EXACT_NUMERIC_COLUMNS.items():
            table = _PHASE_F_EXACT_TABLES_BY_NAME[table_name]
            columns_by_name = {
                str(column["name"]): column
                for column in inspector.get_columns(table_name)
            }
            expected_column_names = {str(column.name) for column in table.columns}
            optional_missing = _PHASE_F_SQLITE_OPTIONAL_LEGACY_COLUMNS.get(table_name, frozenset())
            missing_column_names = expected_column_names - set(columns_by_name)
            unexpected_column_names = set(columns_by_name) - expected_column_names
            if unexpected_column_names or (missing_column_names - optional_missing):
                details: list[str] = []
                if missing_column_names - optional_missing:
                    details.append("missing columns: " + ", ".join(sorted(missing_column_names - optional_missing)))
                if unexpected_column_names:
                    details.append("unexpected columns: " + ", ".join(sorted(unexpected_column_names)))
                raise self._sqlite_exact_numeric_error(
                    f"requires a complete compatible table {table_name}; " + "; ".join(details)
                )

            column_states: set[str] = set()
            for column_name in exact_column_names:
                column = columns_by_name.get(column_name)
                if column is None:
                    if column_name in optional_missing:
                        continue
                    raise self._sqlite_exact_numeric_error(
                        f"requires {table_name}.{column_name} before conversion"
                    )
                declared_type = str(column["type"] or "").strip().upper()
                if declared_type == "TEXT":
                    column_states.add("text")
                    continue
                if self._is_sqlite_legacy_numeric_type(declared_type):
                    column_states.add("legacy_numeric")
                    continue
                raise self._sqlite_exact_numeric_error(
                    f"cannot convert {table_name}.{column_name} declared {declared_type or '<empty>'}"
                )

            if len(column_states) != 1:
                raise self._sqlite_exact_numeric_error(
                    f"refuses mixed exact-numeric declarations in {table_name}"
                )
            table_state = column_states.pop()
            self._validate_sqlite_exact_numeric_values(
                connection,
                table_name=table_name,
                column_names=exact_column_names,
                storage_state=table_state,
                optional_missing=optional_missing,
            )
            table_states.add(table_state)

        if len(table_states) != 1:
            raise self._sqlite_exact_numeric_error(
                "refuses mixed exact-numeric declarations across Phase F tables"
            )
        storage_state = table_states.pop()
        if storage_state == "legacy_numeric":
            self._qualify_sqlite_legacy_exact_numeric_rebuild_source(connection)
        return storage_state

    def _validate_sqlite_exact_numeric_values(
        self,
        connection: Any,
        *,
        table_name: str,
        column_names: Sequence[str],
        storage_state: str,
        optional_missing: frozenset[str],
    ) -> None:
        quoted_table = self._quote_sqlite_identifier(table_name)
        for column_name in column_names:
            if column_name in optional_missing:
                inspector = inspect(connection)
                available_columns = {
                    str(column["name"])
                    for column in inspector.get_columns(table_name)
                }
                if column_name not in available_columns:
                    continue
            quoted_column = self._quote_sqlite_identifier(column_name)
            if storage_state == "text":
                non_text_count = int(
                    connection.exec_driver_sql(
                        f"SELECT COUNT(*) FROM {quoted_table} "
                        f"WHERE {quoted_column} IS NOT NULL "
                        f"AND typeof({quoted_column}) != 'text'"
                    ).scalar_one()
                )
                if non_text_count:
                    raise self._sqlite_exact_numeric_error(
                        f"refuses non-TEXT values in {table_name}.{column_name}"
                    )
                continue

            rows = connection.exec_driver_sql(
                f"SELECT {quoted_column} FROM {quoted_table} "
                f"WHERE {quoted_column} IS NOT NULL"
            )
            for (value,) in rows:
                self._serialize_sqlite_legacy_exact_value(
                    value,
                    table_name=table_name,
                    column_name=column_name,
                )

    def _serialize_sqlite_legacy_exact_value(
        self,
        value: Any,
        *,
        table_name: str,
        column_name: str,
    ) -> str:
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            try:
                binary64_value = float(value)
                binary64_ulp = Decimal(str(ulp(binary64_value)))
            except (OverflowError, ValueError) as exc:
                raise self._sqlite_exact_numeric_error(
                    f"cannot convert non-finite numeric storage in {table_name}.{column_name}"
                ) from exc
            if not isfinite(binary64_value) or binary64_ulp > _PHASE_F_SQLITE_STORAGE_QUANTUM:
                raise self._sqlite_exact_numeric_error(
                    f"refuses unrecoverable legacy numeric storage in {table_name}.{column_name}"
                )
        try:
            return serialize_portfolio_decimal(value)
        except Exception as exc:
            raise self._sqlite_exact_numeric_error(
                f"cannot convert {table_name}.{column_name} to canonical storage text"
            ) from exc

    def _migrate_sqlite_exact_numeric_storage(self) -> None:
        """Rebuild one complete legacy SQLite Phase F schema with exact TEXT columns."""
        if self._engine.dialect.name != "sqlite":
            return

        with self._engine.connect() as connection:
            if self._sqlite_exact_numeric_schema_state(connection) != "legacy_numeric":
                return

            connection.commit()
            connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
            connection.commit()
            if int(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()) != 0:
                raise self._sqlite_exact_numeric_error("could not disable foreign-key checks for rebuild")
            connection.commit()
            try:
                with connection.begin():
                    connection.exec_driver_sql("BEGIN IMMEDIATE")
                    if self._sqlite_exact_numeric_schema_state(connection) != "legacy_numeric":
                        return
                    stage_table_names = self._stage_sqlite_legacy_exact_tables(connection)
                    for table in _PHASE_F_SQLITE_REBUILD_DROP_ORDER:
                        connection.exec_driver_sql(
                            f"DROP TABLE {self._quote_sqlite_identifier(str(table.name))}"
                        )
                    for table in _PHASE_F_SQLITE_REBUILD_CREATE_ORDER:
                        table.create(connection, checkfirst=False)
                    self._restore_sqlite_legacy_exact_tables(
                        connection,
                        stage_table_names=stage_table_names,
                    )
                    foreign_key_violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                    if foreign_key_violations:
                        raise self._sqlite_exact_numeric_error(
                            "refuses legacy rows that violate foreign-key integrity"
                        )
            finally:
                if connection.in_transaction():
                    connection.rollback()
                connection.exec_driver_sql("PRAGMA foreign_keys = ON")
                connection.commit()
                if int(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()) != 1:
                    raise self._sqlite_exact_numeric_error("could not restore foreign-key checks after rebuild")

    def _stage_sqlite_legacy_exact_tables(self, connection: Any) -> dict[str, str]:
        stage_table_names: dict[str, str] = {}
        for table in _PHASE_F_SQLITE_REBUILD_CREATE_ORDER:
            table_name = str(table.name)
            stage_table_name = f"__phase_f_exact_stage_{table_name}"
            stage_table_names[table_name] = stage_table_name
            connection.exec_driver_sql(
                f"CREATE TEMP TABLE {self._quote_sqlite_identifier(stage_table_name)} AS "
                f"SELECT * FROM {self._quote_sqlite_identifier(table_name)}"
            )
        return stage_table_names

    def _restore_sqlite_legacy_exact_tables(
        self,
        connection: Any,
        *,
        stage_table_names: dict[str, str],
    ) -> None:
        for table in _PHASE_F_SQLITE_REBUILD_CREATE_ORDER:
            table_name = str(table.name)
            stage_table_name = stage_table_names[table_name]
            staged_column_names = {
                str(column[1])
                for column in connection.exec_driver_sql(
                    f"PRAGMA table_xinfo({self._quote_sqlite_identifier(stage_table_name)})"
                )
            }
            target_column_names = [str(column.name) for column in table.columns]
            exact_column_names = set(_PHASE_F_EXACT_NUMERIC_COLUMNS[table_name])
            insert_columns = ", ".join(
                self._quote_sqlite_identifier(column_name)
                for column_name in target_column_names
            )
            placeholders = ", ".join("?" for _ in target_column_names)
            insert_sql = (
                f"INSERT INTO {self._quote_sqlite_identifier(table_name)} ({insert_columns}) "
                f"VALUES ({placeholders})"
            )
            staged_rows = connection.exec_driver_sql(
                f"SELECT * FROM {self._quote_sqlite_identifier(stage_table_name)}"
            ).mappings()
            for row in staged_rows:
                values = []
                for column_name in target_column_names:
                    value = row[column_name] if column_name in staged_column_names else None
                    if value is not None and column_name in exact_column_names:
                        value = self._serialize_sqlite_legacy_exact_value(
                            value,
                            table_name=table_name,
                            column_name=column_name,
                        )
                    values.append(value)
                connection.exec_driver_sql(insert_sql, tuple(values))

    def _migrate_portfolio_position_price_cost_column(self) -> None:
        """Append the unavailable source field without synthesizing shadow values."""
        with self._engine.begin() as connection:
            table_names = set(inspect(connection).get_table_names())
            if "portfolio_positions" not in table_names:
                return
            column_names = {
                str(column["name"])
                for column in inspect(connection).get_columns("portfolio_positions")
            }
            if "price_cost" in column_names:
                return
            column_type = "TEXT" if connection.dialect.name == "sqlite" else "NUMERIC(24, 8)"
            connection.exec_driver_sql(
                f"ALTER TABLE portfolio_positions ADD COLUMN price_cost {column_type}"
            )

    def get_session(self) -> Session:
        return self._SessionLocal()

    @contextmanager
    def session_scope(self):
        with managed_session_scope(self._SessionLocal) as session:
            yield session

    def describe_runtime(self, *, include_connection_probe: bool = False) -> dict[str, Any]:
        return describe_store_runtime(
            self._engine,
            schema_key=self.SCHEMA_KEY,
            mode=self.MODE,
            source_path=_phase_f_sql_doc_path(),
            expected_tables=self.EXPECTED_TABLES,
            expected_indexes=self.EXPECTED_INDEXES,
            expected_constraints=self.EXPECTED_CONSTRAINTS,
            last_schema_apply_report=self._last_schema_apply_report,
            include_connection_probe=include_connection_probe,
        )

    @staticmethod
    def _existing_phase_f_tables(session: Session) -> set[str]:
        inspector = inspect(session.connection())
        return {
            table_name
            for table_name in _PHASE_F_TABLES
            if inspector.has_table(table_name)
        }

    def list_account_rows(
        self,
        *,
        owner_user_id: Optional[str] = None,
        include_inactive: bool = False,
    ) -> list[Any]:
        with self.get_session() as session:
            existing_tables = self._existing_phase_f_tables(session)
            if "portfolio_accounts" not in existing_tables:
                return []
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
            existing_tables = self._existing_phase_f_tables(session)
            if "broker_connections" not in existing_tables:
                return []
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
    ) -> Optional[dict[str, Any]]:
        with self.get_session() as session:
            existing_tables = self._existing_phase_f_tables(session)
            if "portfolio_ledger" not in existing_tables:
                return None
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

    def query_cash_ledger_comparison_candidate(
        self,
        *,
        account_id: Optional[int],
        date_from: Optional[date],
        date_to: Optional[date],
        direction: Optional[str],
        page: int,
        page_size: int,
        owner_user_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        with self.get_session() as session:
            existing_tables = self._existing_phase_f_tables(session)
            if "portfolio_ledger" not in existing_tables:
                return None
            conditions = [PhaseFPortfolioLedger.entry_type == "cash"]
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
            if direction:
                conditions.append(PhaseFPortfolioLedger.direction == str(direction).strip().lower())

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
                "items": [self._serialize_cash_ledger_comparison_row(row) for row in rows],
                "total": total,
                "page": int(page),
                "page_size": int(page_size),
            }

    def query_corporate_actions_comparison_candidate(
        self,
        *,
        account_id: Optional[int],
        date_from: Optional[date],
        date_to: Optional[date],
        symbol: Optional[str],
        action_type: Optional[str],
        page: int,
        page_size: int,
        owner_user_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        with self.get_session() as session:
            existing_tables = self._existing_phase_f_tables(session)
            if "portfolio_ledger" not in existing_tables:
                return None
            conditions = [PhaseFPortfolioLedger.entry_type == "corporate_action"]
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
            if action_type:
                conditions.append(PhaseFPortfolioLedger.corporate_action_type == str(action_type).strip().lower())

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
                "items": [self._serialize_corporate_actions_comparison_row(row) for row in rows],
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
        market = getattr(row, "market", None)
        currency = getattr(row, "currency", None)
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "entry_type": str(row.entry_type or ""),
            "event_time": self._serialize_time_value(getattr(row, "event_time", None)),
            "canonical_symbol": row.canonical_symbol,
            "market": market,
            "currency": currency,
            "direction": row.direction,
            "quantity": (
                serialize_portfolio_decimal(row.quantity)
                if row.quantity is not None
                else None
            ),
            "price": (
                serialize_portfolio_decimal(row.price)
                if row.price is not None
                else None
            ),
            "amount": (
                serialize_portfolio_decimal(row.amount)
                if row.amount is not None
                else None
            ),
            "fee": (
                serialize_portfolio_decimal(row.fee)
                if row.fee is not None
                else None
            ),
            "tax": (
                serialize_portfolio_decimal(row.tax)
                if row.tax is not None
                else None
            ),
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
        market = getattr(row, "market", None)
        currency = getattr(row, "currency", None)
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
            "market": market,
            "currency": currency,
            "trade_date": trade_date,
            "side": str(getattr(row, "direction", "") or ""),
            "quantity": serialize_portfolio_decimal(getattr(row, "quantity", 0) or 0),
            "price": serialize_portfolio_decimal(getattr(row, "price", 0) or 0),
            "fee": serialize_portfolio_decimal(getattr(row, "fee", 0) or 0),
            "tax": serialize_portfolio_decimal(getattr(row, "tax", 0) or 0),
            "note": getattr(row, "note", None),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
        }

    def _serialize_cash_ledger_comparison_row(self, row: Any) -> dict[str, Any]:
        payload = self._safe_json_load(getattr(row, "payload_json", None))
        legacy_row_id = int(payload.get("legacy_row_id") or 0)
        currency = str(
            payload.get("currency")
            if payload.get("currency") is not None
            else getattr(row, "currency", "")
        )
        event_time = getattr(row, "event_time", None)
        event_date = ""
        if isinstance(event_time, datetime):
            event_date = event_time.date().isoformat()
        elif isinstance(event_time, date):
            event_date = event_time.isoformat()

        return {
            "id": legacy_row_id,
            "account_id": int(getattr(row, "portfolio_account_id", 0) or 0),
            "event_date": event_date,
            "direction": payload.get("direction") if payload.get("direction") is not None else getattr(row, "direction", None),
            "amount": serialize_portfolio_decimal(
                payload.get("amount")
                if payload.get("amount") is not None
                else (getattr(row, "amount", 0) or 0),
            ),
            "currency": currency,
            "note": payload.get("note") if payload.get("note") is not None else getattr(row, "note", None),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
        }

    def _serialize_corporate_actions_comparison_row(self, row: Any) -> dict[str, Any]:
        payload = self._safe_json_load(getattr(row, "payload_json", None))
        legacy_row_id = int(payload.get("legacy_row_id") or 0)
        market = getattr(row, "market", None)
        currency = getattr(row, "currency", None)
        event_time = getattr(row, "event_time", None)
        effective_date = ""
        if isinstance(event_time, datetime):
            effective_date = event_time.date().isoformat()
        elif isinstance(event_time, date):
            effective_date = event_time.isoformat()

        cash_dividend_per_share = payload.get("cash_dividend_per_share")
        split_ratio = payload.get("split_ratio")
        return {
            "id": legacy_row_id,
            "account_id": int(getattr(row, "portfolio_account_id", 0) or 0),
            "symbol": str(getattr(row, "canonical_symbol", "") or ""),
            "market": market,
            "currency": currency,
            "effective_date": effective_date,
            "action_type": payload.get("action_type")
            if payload.get("action_type") is not None
            else getattr(row, "corporate_action_type", None),
            "cash_dividend_per_share": (
                serialize_portfolio_decimal(cash_dividend_per_share)
                if cash_dividend_per_share is not None
                else None
            ),
            "split_ratio": (
                serialize_portfolio_decimal(split_ratio)
                if split_ratio is not None
                else None
            ),
            "note": payload.get("note") if payload.get("note") is not None else getattr(row, "note", None),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
        }

    def _serialize_position_row(self, row: Any) -> dict[str, Any]:
        market = str(row.market or "")
        currency = str(row.currency or "")
        valuation_currency = row.valuation_currency
        return {
            "id": int(row.id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "source_kind": str(row.source_kind or ""),
            "cost_method": str(row.cost_method or ""),
            "canonical_symbol": str(row.canonical_symbol or ""),
            "market": market,
            "currency": currency,
            "quantity": serialize_portfolio_decimal(row.quantity if row.quantity is not None else 0),
            "avg_cost": serialize_portfolio_decimal(row.avg_cost if row.avg_cost is not None else 0),
            "total_cost": serialize_portfolio_decimal(
                row.total_cost if row.total_cost is not None else 0
            ),
            "price_cost": (
                serialize_portfolio_decimal(row.price_cost)
                if row.price_cost is not None
                else None
            ),
            "last_price": (
                serialize_portfolio_decimal(row.last_price)
                if row.last_price is not None
                else None
            ),
            "market_value_base": (
                serialize_portfolio_decimal(row.market_value_base)
                if row.market_value_base is not None
                else None
            ),
            "unrealized_pnl_base": (
                serialize_portfolio_decimal(row.unrealized_pnl_base)
                if row.unrealized_pnl_base is not None
                else None
            ),
            "valuation_currency": row.valuation_currency,
            "as_of_time": self._serialize_time_value(getattr(row, "as_of_time", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_state_row(self, row: Any) -> dict[str, Any]:
        base_currency = str(row.base_currency or "")
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
            "base_currency": base_currency,
            "total_cash": serialize_portfolio_decimal(row.total_cash if row.total_cash is not None else 0),
            "total_market_value": serialize_portfolio_decimal(
                row.total_market_value if row.total_market_value is not None else 0
            ),
            "total_equity": serialize_portfolio_decimal(row.total_equity if row.total_equity is not None else 0),
            "realized_pnl": serialize_portfolio_decimal(row.realized_pnl if row.realized_pnl is not None else 0),
            "unrealized_pnl": serialize_portfolio_decimal(
                row.unrealized_pnl if row.unrealized_pnl is not None else 0
            ),
            "fx_stale": bool(row.fx_stale),
            "payload_json": self._safe_json_load(getattr(row, "payload_json", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_position_row(self, row: Any) -> dict[str, Any]:
        market = str(row.market or "")
        currency = str(row.currency or "")
        valuation_currency = row.valuation_currency
        return {
            "id": int(row.id),
            "portfolio_sync_state_id": int(row.portfolio_sync_state_id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "broker_position_ref": row.broker_position_ref,
            "canonical_symbol": str(row.canonical_symbol or ""),
            "market": market,
            "currency": currency,
            "quantity": serialize_portfolio_decimal(row.quantity if row.quantity is not None else 0),
            "avg_cost": serialize_portfolio_decimal(row.avg_cost if row.avg_cost is not None else 0),
            "last_price": serialize_portfolio_decimal(row.last_price if row.last_price is not None else 0),
            "market_value_base": serialize_portfolio_decimal(
                row.market_value_base if row.market_value_base is not None else 0
            ),
            "unrealized_pnl_base": serialize_portfolio_decimal(
                row.unrealized_pnl_base if row.unrealized_pnl_base is not None else 0
            ),
            "valuation_currency": row.valuation_currency,
            "payload_json": self._safe_json_load(getattr(row, "payload_json", None)),
            "created_at": self._serialize_time_value(getattr(row, "created_at", None)),
            "updated_at": self._serialize_time_value(getattr(row, "updated_at", None)),
        }

    def _serialize_sync_cash_balance_row(self, row: Any, *, base_currency: str) -> dict[str, Any]:
        currency = str(row.currency or "")
        return {
            "id": int(row.id),
            "portfolio_sync_state_id": int(row.portfolio_sync_state_id),
            "owner_user_id": str(row.owner_user_id or ""),
            "portfolio_account_id": int(row.portfolio_account_id),
            "currency": currency,
            "amount": serialize_portfolio_decimal(row.amount if row.amount is not None else 0),
            "amount_base": serialize_portfolio_decimal(row.amount_base if row.amount_base is not None else 0),
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
                            "quantity": serialize_portfolio_decimal(getattr(row, "quantity", 0) or 0),
                            "price": serialize_portfolio_decimal(getattr(row, "price", 0) or 0),
                            "fee": serialize_portfolio_decimal(getattr(row, "fee", 0) or 0),
                            "tax": serialize_portfolio_decimal(getattr(row, "tax", 0) or 0),
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
                            "amount": serialize_portfolio_decimal(getattr(row, "amount", 0) or 0),
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
                            "cash_dividend_per_share": (
                                serialize_portfolio_decimal(row.cash_dividend_per_share)
                                if row.cash_dividend_per_share is not None
                                else None
                            ),
                            "split_ratio": (
                                serialize_portfolio_decimal(row.split_ratio)
                                if row.split_ratio is not None
                                else None
                            ),
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
                        price_cost=getattr(row, "price_cost", None),
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
        return self.get_account_shadow_bundles(account_ids=[account_id]).get(int(account_id))

    def get_account_shadow_bundles(self, *, account_ids: Iterable[int]) -> dict[int, dict[str, Any]]:
        resolved_account_ids = sorted(
            {int(account_id) for account_id in account_ids if account_id is not None}
        )
        if not resolved_account_ids:
            return {}

        with self.get_session() as session:
            existing_tables = self._existing_phase_f_tables(session)
            if "portfolio_accounts" not in existing_tables:
                return {}

            account_rows = session.execute(
                select(PhaseFPortfolioAccount)
                .where(PhaseFPortfolioAccount.id.in_(resolved_account_ids))
                .order_by(PhaseFPortfolioAccount.id.asc())
            ).scalars().all()
            if not account_rows:
                return {}

            present_account_ids = [int(row.id) for row in account_rows]
            broker_connections_by_account: dict[int, list[Any]] = {
                account_id: [] for account_id in present_account_ids
            }
            ledger_by_account: dict[int, list[Any]] = {
                account_id: [] for account_id in present_account_ids
            }
            positions_by_account: dict[int, list[Any]] = {
                account_id: [] for account_id in present_account_ids
            }
            latest_sync_state_by_account: dict[int, Any] = {}
            sync_positions_by_account: dict[int, list[Any]] = {
                account_id: [] for account_id in present_account_ids
            }
            sync_cash_balances_by_account: dict[int, list[Any]] = {
                account_id: [] for account_id in present_account_ids
            }

            if "broker_connections" in existing_tables:
                broker_connection_rows = session.execute(
                    select(PhaseFBrokerConnection)
                    .where(PhaseFBrokerConnection.portfolio_account_id.in_(present_account_ids))
                    .order_by(
                        PhaseFBrokerConnection.portfolio_account_id.asc(),
                        PhaseFBrokerConnection.id.asc(),
                    )
                ).scalars().all()
                for row in broker_connection_rows:
                    broker_connections_by_account.setdefault(int(row.portfolio_account_id), []).append(row)

            if "portfolio_ledger" in existing_tables:
                ledger_rows = session.execute(
                    select(PhaseFPortfolioLedger)
                    .where(PhaseFPortfolioLedger.portfolio_account_id.in_(present_account_ids))
                    .order_by(
                        PhaseFPortfolioLedger.portfolio_account_id.asc(),
                        PhaseFPortfolioLedger.event_time.asc(),
                        PhaseFPortfolioLedger.id.asc(),
                    )
                ).scalars().all()
                for row in ledger_rows:
                    ledger_by_account.setdefault(int(row.portfolio_account_id), []).append(row)

            if "portfolio_positions" in existing_tables:
                position_rows = session.execute(
                    select(PhaseFPortfolioPosition)
                    .where(PhaseFPortfolioPosition.portfolio_account_id.in_(present_account_ids))
                    .order_by(
                        PhaseFPortfolioPosition.portfolio_account_id.asc(),
                        PhaseFPortfolioPosition.source_kind.asc(),
                        PhaseFPortfolioPosition.cost_method.asc(),
                        PhaseFPortfolioPosition.canonical_symbol.asc(),
                        PhaseFPortfolioPosition.id.asc(),
                    )
                ).scalars().all()
                for row in position_rows:
                    positions_by_account.setdefault(int(row.portfolio_account_id), []).append(row)

            latest_sync_state_ids: list[int] = []
            if "portfolio_sync_states" in existing_tables:
                sync_state_rows = session.execute(
                    select(PhaseFPortfolioSyncState)
                    .where(PhaseFPortfolioSyncState.portfolio_account_id.in_(present_account_ids))
                    .order_by(
                        PhaseFPortfolioSyncState.portfolio_account_id.asc(),
                        PhaseFPortfolioSyncState.synced_at.desc(),
                        PhaseFPortfolioSyncState.id.desc(),
                    )
                ).scalars().all()
                for row in sync_state_rows:
                    account_id = int(row.portfolio_account_id)
                    if account_id not in latest_sync_state_by_account:
                        latest_sync_state_by_account[account_id] = row
                        latest_sync_state_ids.append(int(row.id))

            if latest_sync_state_ids and "portfolio_sync_positions" in existing_tables:
                sync_position_rows = session.execute(
                    select(PhaseFPortfolioSyncPosition)
                    .where(PhaseFPortfolioSyncPosition.portfolio_sync_state_id.in_(latest_sync_state_ids))
                    .order_by(
                        PhaseFPortfolioSyncPosition.portfolio_account_id.asc(),
                        PhaseFPortfolioSyncPosition.canonical_symbol.asc(),
                        PhaseFPortfolioSyncPosition.id.asc(),
                    )
                ).scalars().all()
                for row in sync_position_rows:
                    sync_positions_by_account.setdefault(int(row.portfolio_account_id), []).append(row)

            if latest_sync_state_ids and "portfolio_sync_cash_balances" in existing_tables:
                sync_cash_balance_rows = session.execute(
                    select(PhaseFPortfolioSyncCashBalance)
                    .where(PhaseFPortfolioSyncCashBalance.portfolio_sync_state_id.in_(latest_sync_state_ids))
                    .order_by(
                        PhaseFPortfolioSyncCashBalance.portfolio_account_id.asc(),
                        PhaseFPortfolioSyncCashBalance.currency.asc(),
                        PhaseFPortfolioSyncCashBalance.id.asc(),
                    )
                ).scalars().all()
                for row in sync_cash_balance_rows:
                    sync_cash_balances_by_account.setdefault(int(row.portfolio_account_id), []).append(row)

            return {
                int(account_row.id): {
                    "account": self._serialize_account_row(account_row),
                    "broker_connections": [
                        self._serialize_broker_connection_row(row)
                        for row in broker_connections_by_account.get(int(account_row.id), [])
                    ],
                    "ledger": [
                        self._serialize_ledger_row(row)
                        for row in ledger_by_account.get(int(account_row.id), [])
                    ],
                    "positions": [
                        self._serialize_position_row(row)
                        for row in positions_by_account.get(int(account_row.id), [])
                    ],
                    "sync_state": (
                        self._serialize_sync_state_row(latest_sync_state_by_account[int(account_row.id)])
                        if int(account_row.id) in latest_sync_state_by_account
                        else None
                    ),
                    "sync_positions": [
                        self._serialize_sync_position_row(row)
                        for row in sync_positions_by_account.get(int(account_row.id), [])
                    ],
                    "sync_cash_balances": [
                        self._serialize_sync_cash_balance_row(
                            row,
                            base_currency=str(
                                latest_sync_state_by_account[int(account_row.id)].base_currency or ""
                            ),
                        )
                        for row in sync_cash_balances_by_account.get(int(account_row.id), [])
                    ],
                }
                for account_row in account_rows
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
            existing_tables = self._existing_phase_f_tables(session)

            if "portfolio_sync_positions" in existing_tables:
                counts["portfolio_sync_positions"] = session.execute(
                    delete(PhaseFPortfolioSyncPosition).where(
                        PhaseFPortfolioSyncPosition.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "portfolio_sync_cash_balances" in existing_tables:
                counts["portfolio_sync_cash_balances"] = session.execute(
                    delete(PhaseFPortfolioSyncCashBalance).where(
                        PhaseFPortfolioSyncCashBalance.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "portfolio_sync_states" in existing_tables:
                counts["portfolio_sync_states"] = session.execute(
                    delete(PhaseFPortfolioSyncState).where(
                        PhaseFPortfolioSyncState.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "portfolio_ledger" in existing_tables:
                counts["portfolio_ledger"] = session.execute(
                    delete(PhaseFPortfolioLedger).where(
                        PhaseFPortfolioLedger.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "portfolio_positions" in existing_tables:
                counts["portfolio_positions"] = session.execute(
                    delete(PhaseFPortfolioPosition).where(
                        PhaseFPortfolioPosition.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "broker_connections" in existing_tables:
                counts["broker_connections"] = session.execute(
                    delete(PhaseFBrokerConnection).where(
                        PhaseFBrokerConnection.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0
            if "portfolio_accounts" in existing_tables:
                counts["portfolio_accounts"] = session.execute(
                    delete(PhaseFPortfolioAccount).where(
                        PhaseFPortfolioAccount.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0

        return {key: int(value or 0) for key, value in counts.items()}
