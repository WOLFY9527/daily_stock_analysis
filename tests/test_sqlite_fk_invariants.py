"""Direct evidence for the repository-wide SQLite foreign-key contract."""

from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

import pytest
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import QueuePool

import src.database_doctor as database_doctor
from scripts.db_retention_preview_report import (
    _open_sqlite_readonly as open_retention_sqlite_readonly,
)
from scripts.release_restore_rollback_drill import _sqlite_backup
from scripts.storage_migration_readiness_report import (
    _open_sqlite_readonly as open_migration_sqlite_readonly,
)
from src.postgres_store_utils import create_store_engine
from src.repositories.historical_market_data_repo import HistoricalMarketDataRepository
from src.sqlite_foreign_keys import (
    SQLiteForeignKeyEnforcementError,
    SQLiteForeignKeySchemaError,
    connect_sqlite,
    create_engine_with_sqlite_foreign_keys,
    declared_sqlite_foreign_keys,
    enforce_sqlite_foreign_keys,
    read_sqlite_foreign_keys,
)
from src.storage import AppUser, Base, DatabaseManager, PortfolioTrade


@pytest.fixture(autouse=True)
def _reset_database_manager() -> None:
    DatabaseManager.reset_instance()
    try:
        yield
    finally:
        DatabaseManager.reset_instance()


def _assert_sqlalchemy_connection_enforces_fks(connection: Any) -> None:
    assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1


def _create_backtest_summary_fixture(
    path: Path,
    *,
    variant: str = "pre_owner",
    row_owner: str | None = None,
    create_sequence_table: bool = False,
    extra_column_sql: str | None = None,
    extra_constraint_sql: str | None = None,
    owner_nullable: bool = False,
) -> None:
    if variant not in {"pre_owner", "caad_upgraded", "fresh_owner"}:
        raise ValueError(f"unsupported backtest summary fixture variant: {variant}")

    include_owner = variant != "pre_owner"
    owner_foreign_key = variant == "fresh_owner"
    sql_defaults = variant == "caad_upgraded"
    resolved_owner = row_owner
    if include_owner and resolved_owner is None:
        resolved_owner = "legacy-owner"
    owner_column = ""
    unique_columns = "scope, code, eval_window_days, engine_version"
    unique_name = "uix_backtest_summary_scope_code_window_version"
    if include_owner:
        reference = " REFERENCES app_users(id)" if owner_foreign_key else ""
        nullability = "" if owner_nullable else " NOT NULL"
        owner_column = f"owner_id VARCHAR(64){nullability}{reference},"
        unique_columns = "owner_id, scope, code, eval_window_days, engine_version"
        unique_name = "uix_backtest_summary_owner_scope_code_window_version"
    extra_column = f", {extra_column_sql}" if extra_column_sql else ""
    constraints = [f"CONSTRAINT {unique_name} UNIQUE ({unique_columns})"]
    if extra_constraint_sql:
        constraints.append(extra_constraint_sql)
    if variant != "caad_upgraded":
        constraints.insert(0, "PRIMARY KEY (id)")
    constraint_sql = ", ".join(constraints)
    id_column = (
        "id INTEGER PRIMARY KEY AUTOINCREMENT"
        if variant == "caad_upgraded"
        else "id INTEGER NOT NULL"
    )
    eval_default = " DEFAULT 10" if sql_defaults else ""
    engine_default = " DEFAULT 'v1'" if sql_defaults else ""
    count_default = " DEFAULT 0" if sql_defaults else ""

    with connect_sqlite(path) as connection:
        if create_sequence_table:
            connection.execute(
                "CREATE TABLE sequence_seed (id INTEGER PRIMARY KEY AUTOINCREMENT)"
            )
        connection.execute("CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)")
        connection.execute("INSERT INTO app_users (id) VALUES ('bootstrap-admin')")
        if include_owner and resolved_owner != "bootstrap-admin":
            connection.execute("INSERT INTO app_users (id) VALUES (?)", (resolved_owner,))
        connection.execute(
            f"""
            CREATE TABLE backtest_summaries (
                {id_column},
                {owner_column}
                scope VARCHAR(16) NOT NULL,
                code VARCHAR(16),
                eval_window_days INTEGER NOT NULL{eval_default},
                engine_version VARCHAR(16) NOT NULL{engine_default},
                computed_at DATETIME,
                total_evaluations INTEGER{count_default},
                completed_count INTEGER{count_default},
                insufficient_count INTEGER{count_default},
                long_count INTEGER{count_default},
                cash_count INTEGER{count_default},
                win_count INTEGER{count_default},
                loss_count INTEGER{count_default},
                neutral_count INTEGER{count_default},
                direction_accuracy_pct FLOAT,
                win_rate_pct FLOAT,
                neutral_rate_pct FLOAT,
                avg_stock_return_pct FLOAT,
                avg_simulated_return_pct FLOAT,
                stop_loss_trigger_rate FLOAT,
                take_profit_trigger_rate FLOAT,
                ambiguous_rate FLOAT,
                avg_days_to_first_hit FLOAT,
                advice_breakdown_json TEXT,
                diagnostics_json TEXT
                {extra_column},
                {constraint_sql}
            )
            """
        )
        columns = "id, scope, code, eval_window_days, engine_version, total_evaluations, diagnostics_json"
        values: tuple[object, ...] = (7, "stock", "AAPL", 10, "v1", 1, "legacy")
        if include_owner:
            columns = "id, owner_id, " + columns.removeprefix("id, ")
            values = (7, resolved_owner, *values[1:])
        placeholders = ", ".join("?" for _ in values)
        connection.execute(
            f"INSERT INTO backtest_summaries ({columns}) VALUES ({placeholders})",
            values,
        )
        if variant in {"pre_owner", "fresh_owner"}:
            indexed_columns = ["scope", "code", "computed_at"]
            if variant == "fresh_owner":
                indexed_columns.insert(0, "owner_id")
            for column_name in indexed_columns:
                connection.execute(
                    f"CREATE INDEX ix_backtest_summaries_{column_name} "
                    f"ON backtest_summaries ({column_name})"
                )
        if variant == "caad_upgraded":
            connection.execute(
                "UPDATE sqlite_sequence SET seq = 41 WHERE name = 'backtest_summaries'"
            )


def _run_backtest_summary_migration(path: Path) -> None:
    engine = create_engine_with_sqlite_foreign_keys(f"sqlite:///{path}")
    manager = object.__new__(DatabaseManager)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            manager._migrate_backtest_summaries_table(
                connection,
                bootstrap_user_id="bootstrap-admin",
            )
    finally:
        engine.dispose()


@pytest.mark.parametrize("database_kind", ("memory", "file"))
def test_database_manager_enforces_foreign_keys_before_use(
    tmp_path: Path,
    database_kind: str,
) -> None:
    db_url = (
        "sqlite:///:memory:"
        if database_kind == "memory"
        else f"sqlite:///{tmp_path / 'primary.sqlite'}"
    )
    db = DatabaseManager(db_url=db_url)

    with db._engine.connect() as connection:
        _assert_sqlalchemy_connection_enforces_fks(connection)


@pytest.mark.parametrize(
    ("relation", "statement", "parameters"),
    (
        pytest.param(
            "session",
            """
            INSERT INTO app_user_sessions (session_id, user_id, expires_at)
            VALUES (:session_id, :missing_parent, :expires_at)
            """,
            {
                "session_id": "orphan-session",
                "missing_parent": "missing-user",
                "expires_at": datetime(2030, 1, 1),
            },
            id="session-to-user",
        ),
        pytest.param(
            "portfolio-account",
            """
            INSERT INTO portfolio_accounts (
                owner_id, name, market, base_currency, is_active
            ) VALUES (
                :missing_parent, 'Orphan account', 'us', 'USD', 1
            )
            """,
            {"missing_parent": "missing-user"},
            id="portfolio-account-to-user",
        ),
        pytest.param(
            "portfolio-trade",
            """
            INSERT INTO portfolio_trades (
                account_id, symbol, market, currency, trade_date,
                side, quantity, price, is_active
            ) VALUES (
                :missing_parent, 'AAPL', 'us', 'USD', '2030-01-01',
                'buy', 1, 100, 1
            )
            """,
            {"missing_parent": 999999},
            id="portfolio-trade-to-account",
        ),
        pytest.param(
            "portfolio-cash-ledger",
            """
            INSERT INTO portfolio_cash_ledger (
                account_id, event_date, direction, amount, currency
            ) VALUES (
                :missing_parent, '2030-01-01', 'in', 100, 'USD'
            )
            """,
            {"missing_parent": 999999},
            id="portfolio-cash-ledger-to-account",
        ),
        pytest.param(
            "watchlist",
            """
            INSERT INTO user_watchlist_items (
                owner_id, symbol, market, source
            ) VALUES (
                :missing_parent, 'AAPL', 'us', 'scanner'
            )
            """,
            {"missing_parent": "missing-user"},
            id="watchlist-to-user",
        ),
        pytest.param(
            "analysis-history",
            """
            INSERT INTO analysis_history (owner_id, code, report_type, is_test)
            VALUES (:missing_parent, 'AAPL', 'simple', 0)
            """,
            {"missing_parent": "missing-user"},
            id="other-owned-relation-to-user",
        ),
    ),
)
def test_database_manager_rejects_orphans_for_owned_relations(
    tmp_path: Path,
    relation: str,
    statement: str,
    parameters: dict[str, object],
) -> None:
    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / f'{relation}.sqlite'}")

    with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
        with db._engine.begin() as connection:
            connection.execute(text(statement), parameters)

    with db._engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []


def test_database_manager_physical_fk_inventory_matches_declared_metadata() -> None:
    db = DatabaseManager(db_url="sqlite:///:memory:")
    expected = declared_sqlite_foreign_keys(Base.metadata)

    with db._engine.connect() as connection:
        actual = read_sqlite_foreign_keys(
            connection,
            (table.name for table in Base.metadata.sorted_tables),
        )
        violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()

    assert actual == expected
    assert expected.total() == 56
    assert violations == []
    assert {
        ("app_user_sessions", "user_id", "app_users", "id"),
        ("portfolio_accounts", "owner_id", "app_users", "id"),
        ("portfolio_trades", "account_id", "portfolio_accounts", "id"),
        ("portfolio_cash_ledger", "account_id", "portfolio_accounts", "id"),
        ("user_watchlist_items", "owner_id", "app_users", "id"),
    } <= {identity[:4] for identity in actual}


def _create_fk_drift_portfolio_database(
    path: Path,
    *,
    owner_variant: str = "historical",
    trade_exact_storage: str = "canonical",
) -> None:
    if owner_variant not in {"historical", "collated", "constrained", "wrong_fk"}:
        raise ValueError(f"unsupported legacy owner variant: {owner_variant}")
    if trade_exact_storage not in {"canonical", "legacy"}:
        raise ValueError(f"unsupported trade exact storage: {trade_exact_storage}")
    engine = create_engine_with_sqlite_foreign_keys(f"sqlite:///{path}")
    metadata = MetaData()
    users = AppUser.__table__.to_metadata(metadata)
    rogue_users = None
    owner_args: tuple[object, ...] = (String(64),)
    owner_kwargs: dict[str, object] = {}
    if owner_variant == "collated":
        owner_args = (String(64, collation="NOCASE"),)
    elif owner_variant == "constrained":
        owner_kwargs = {
            "nullable": False,
            "server_default": text("'legacy-owner'"),
        }
    elif owner_variant == "wrong_fk":
        rogue_users = Table(
            "rogue_users",
            metadata,
            Column("id", String(64), primary_key=True),
        )
        owner_args = (String(64), ForeignKey("rogue_users.id"))
    accounts = Table(
        "portfolio_accounts",
        metadata,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("owner_id", *owner_args, **owner_kwargs),
        Column("name", String(64), nullable=False),
        Column("broker", String(64)),
        Column("market", String(8), nullable=False),
        Column("base_currency", String(8), nullable=False),
        Column("is_active", Boolean, nullable=False),
        Column("created_at", DateTime),
        Column("updated_at", DateTime),
    )
    Index("ix_legacy_portfolio_owner", accounts.c.owner_id)
    trades = PortfolioTrade.__table__.to_metadata(metadata)
    if trade_exact_storage == "legacy":
        for column_name in ("quantity", "price", "fee", "tax"):
            trades.c[column_name].type = Float()
    metadata.create_all(engine)
    with engine.begin() as connection:
        if rogue_users is not None:
            connection.execute(rogue_users.insert().values(id="legacy-owner"))
        connection.execute(
            users.insert().values(
                id="legacy-owner",
                username="legacy-owner",
                role="user",
                is_active=True,
            )
        )
        account_id = connection.execute(
            accounts.insert().values(
                owner_id="legacy-owner",
                name="Legacy account",
                market="us",
                base_currency="USD",
                is_active=True,
            )
        ).inserted_primary_key[0]
        connection.execute(
            trades.insert().values(
                account_id=account_id,
                symbol="AAPL",
                market="us",
                currency="USD",
                trade_date=date(2026, 1, 1),
                side="buy",
                quantity=2,
                price=100,
                is_active=True,
            )
        )
    engine.dispose()


def test_valid_legacy_fk_migration_repairs_schema_and_retains_parent_and_child_rows(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-portfolio.sqlite"
    _create_fk_drift_portfolio_database(database_path)

    db = DatabaseManager(db_url=f"sqlite:///{database_path}")

    with db._engine.connect() as connection:
        account = connection.exec_driver_sql(
            "SELECT id, owner_id, name FROM portfolio_accounts"
        ).one()
        trade = connection.exec_driver_sql(
            "SELECT account_id, symbol FROM portfolio_trades"
        ).one()
        inventory = read_sqlite_foreign_keys(
            connection,
            (table.name for table in Base.metadata.sorted_tables),
        )
        index_names = {
            str(row[1])
            for row in connection.exec_driver_sql(
                "PRAGMA index_list(portfolio_accounts)"
            ).fetchall()
        }
        violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()

    assert account.owner_id == "legacy-owner"
    assert account.name == "Legacy account"
    assert trade.account_id == account.id
    assert trade.symbol == "AAPL"
    assert inventory == declared_sqlite_foreign_keys(Base.metadata)
    assert "ix_legacy_portfolio_owner" in index_names
    assert violations == []

    DatabaseManager.reset_instance()
    sparse_legacy_path = tmp_path / "legacy-float-portfolio.sqlite"
    _create_fk_drift_portfolio_database(
        sparse_legacy_path,
        trade_exact_storage="legacy",
    )
    with connect_sqlite(sparse_legacy_path) as connection:
        source_rows = connection.execute(
            "SELECT account_id, symbol, quantity, price FROM portfolio_trades"
        ).fetchall()
        source_types = {
            row[1]: str(row[2]).upper()
            for row in connection.execute("PRAGMA table_xinfo(portfolio_trades)")
        }

    try:
        with pytest.raises(
            RuntimeError,
            match="SQLite exact-numeric migration refuses incomplete pre-broker-sync portfolio schema",
        ):
            DatabaseManager(db_url=f"sqlite:///{sparse_legacy_path}")
    finally:
        DatabaseManager.reset_instance()

    with connect_sqlite(sparse_legacy_path) as connection:
        assert connection.execute(
            "SELECT account_id, symbol, quantity, price FROM portfolio_trades"
        ).fetchall() == source_rows
        assert {source_types[column] for column in ("quantity", "price", "fee", "tax")} == {
            "FLOAT"
        }
        assert connection.execute(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_cash_ledger'"
        ).fetchone() is None
        assert connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' "
            "AND name LIKE '%__wolfy_precision_old'"
        ).fetchall() == []


@pytest.mark.parametrize(
    "owner_variant",
    ("collated", "constrained"),
)
def test_legacy_fk_retrofit_rejects_unqualified_source_column_without_schema_loss(
    tmp_path: Path,
    owner_variant: str,
) -> None:
    database_path = tmp_path / f"legacy-portfolio-{owner_variant}.sqlite"
    _create_fk_drift_portfolio_database(
        database_path,
        owner_variant=owner_variant,
    )
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_accounts'"
        ).fetchone()[0]

    with pytest.raises(RuntimeError, match="source-column review"):
        DatabaseManager(db_url=f"sqlite:///{database_path}")

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT owner_id, name FROM portfolio_accounts"
        ).fetchall() == [("legacy-owner", "Legacy account")]
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_accounts'"
        ).fetchone()[0] == original_schema


def test_legacy_fk_retrofit_rejects_wrong_existing_fk_without_schema_loss(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-portfolio-wrong-fk.sqlite"
    _create_fk_drift_portfolio_database(database_path, owner_variant="wrong_fk")
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_accounts'"
        ).fetchone()[0]

    with pytest.raises(RuntimeError, match="existing foreign-key review"):
        DatabaseManager(db_url=f"sqlite:///{database_path}")

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT owner_id, name FROM portfolio_accounts"
        ).fetchall() == [("legacy-owner", "Legacy account")]
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_accounts'"
        ).fetchone()[0] == original_schema
        foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(portfolio_accounts)"
        ).fetchall()
        assert any(row[2:5] == ("rogue_users", "owner_id", "id") for row in foreign_keys)


@pytest.mark.parametrize("variant", ("pre_owner", "caad_upgraded"))
def test_backtest_summary_legacy_variants_migrate_without_data_loss(
    tmp_path: Path,
    variant: str,
) -> None:
    database_path = tmp_path / f"legacy-summary-{variant}.sqlite"
    _create_backtest_summary_fixture(database_path, variant=variant)
    with connect_sqlite(database_path) as connection:
        sequence_table_count = connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'"
        ).fetchone()[0]
        assert sequence_table_count == (0 if variant == "pre_owner" else 1)

    _run_backtest_summary_migration(database_path)
    _run_backtest_summary_migration(database_path)

    expected_owner = "bootstrap-admin" if variant == "pre_owner" else "legacy-owner"
    expected_high_water = 7 if variant == "pre_owner" else 41
    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, owner_id, scope, code FROM backtest_summaries"
        ).fetchone() == (7, expected_owner, "stock", "AAPL")
        assert connection.execute(
            "SELECT seq FROM sqlite_sequence WHERE name = 'backtest_summaries'"
        ).fetchone()[0] >= expected_high_water
        foreign_keys = connection.execute(
            "PRAGMA foreign_key_list(backtest_summaries)"
        ).fetchall()
        assert any(row[2:5] == ("app_users", "owner_id", "id") for row in foreign_keys)


def test_fresh_backtest_summary_schema_is_qualified_and_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "fresh-summary.sqlite"
    _create_backtest_summary_fixture(database_path, variant="fresh_owner")
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0]

    _run_backtest_summary_migration(database_path)
    _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, owner_id, code FROM backtest_summaries"
        ).fetchall() == [(7, "legacy-owner", "AAPL")]
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == original_schema


def test_backtest_summary_qualified_fk_with_nullable_owner_fails_closed(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "nullable-qualified-summary.sqlite"
    _create_backtest_summary_fixture(
        database_path,
        variant="fresh_owner",
        owner_nullable=True,
    )
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0]

    with pytest.raises(RuntimeError, match="column review"):
        _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, owner_id, code FROM backtest_summaries"
        ).fetchall() == [(7, "legacy-owner", "AAPL")]
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == original_schema


def test_backtest_summary_rebuild_rejects_inbound_foreign_keys_without_cascade_loss(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-summary-inbound.sqlite"
    _create_backtest_summary_fixture(database_path, create_sequence_table=True)
    with connect_sqlite(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE unknown_summary_children (
                id INTEGER PRIMARY KEY,
                summary_id INTEGER NOT NULL
                    REFERENCES backtest_summaries(id) ON DELETE CASCADE,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT INTO unknown_summary_children (id, summary_id, payload) VALUES (1, 7, 'retain')"
        )
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0]

    with pytest.raises(RuntimeError, match="inbound foreign key"):
        _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, code FROM backtest_summaries"
        ).fetchall() == [(7, "AAPL")]
        assert connection.execute(
            "SELECT id, summary_id, payload FROM unknown_summary_children"
        ).fetchall() == [(1, 7, "retain")]
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == original_schema
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'backtest_summaries__new'"
        ).fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_backtest_summary_rebuild_rejects_generated_columns_without_data_loss(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-summary-generated.sqlite"
    _create_backtest_summary_fixture(
        database_path,
        create_sequence_table=True,
        extra_column_sql=(
            "hidden_marker TEXT GENERATED ALWAYS AS ('stock:' || code) VIRTUAL"
        ),
    )
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0]
        assert connection.execute(
            "SELECT id, hidden_marker FROM backtest_summaries"
        ).fetchall() == [(7, "stock:AAPL")]

    with pytest.raises(RuntimeError, match="column review"):
        _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == original_schema
        assert connection.execute(
            "SELECT id, hidden_marker FROM backtest_summaries"
        ).fetchall() == [(7, "stock:AAPL")]
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'backtest_summaries__new'"
        ).fetchone()[0] == 0


def test_backtest_summary_rebuild_rejects_unknown_constraints_without_schema_loss(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy-summary-constraints.sqlite"
    _create_backtest_summary_fixture(
        database_path,
        create_sequence_table=True,
        extra_constraint_sql=(
            "CONSTRAINT uq_backtest_summary_diagnostics UNIQUE (diagnostics_json), "
            "CONSTRAINT ck_backtest_summary_total CHECK (total_evaluations >= 0)"
        ),
    )
    with connect_sqlite(database_path) as connection:
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0]
        original_indexes = connection.execute(
            "SELECT name, sql FROM sqlite_schema "
            "WHERE type = 'index' AND tbl_name = 'backtest_summaries' ORDER BY name"
        ).fetchall()

    with pytest.raises(RuntimeError, match="constraint review"):
        _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == original_schema
        assert connection.execute(
            "SELECT name, sql FROM sqlite_schema "
            "WHERE type = 'index' AND tbl_name = 'backtest_summaries' ORDER BY name"
        ).fetchall() == original_indexes
        assert connection.execute(
            "SELECT id, total_evaluations, diagnostics_json FROM backtest_summaries"
        ).fetchall() == [(7, 1, "legacy")]


def test_backtest_summary_qualified_trigger_fails_before_owner_backfill(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "qualified-summary-trigger.sqlite"
    _create_backtest_summary_fixture(
        database_path,
        variant="fresh_owner",
        row_owner="",
    )
    with connect_sqlite(database_path) as connection:
        connection.execute(
            "CREATE TABLE migration_victim (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO migration_victim (id, payload) VALUES (1, 'retain')"
        )
        connection.execute(
            """
            CREATE TRIGGER destructive_summary_owner_update
            AFTER UPDATE OF owner_id ON backtest_summaries
            BEGIN
                DELETE FROM migration_victim;
            END
            """
        )

    with pytest.raises(RuntimeError, match="trigger review"):
        _run_backtest_summary_migration(database_path)

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, owner_id FROM backtest_summaries"
        ).fetchall() == [(7, "")]
        assert connection.execute(
            "SELECT id, payload FROM migration_victim"
        ).fetchall() == [(1, "retain")]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_backtest_summary_partial_artifact_fails_startup_without_hiding_rows(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "partial-summary-migration.sqlite"
    with connect_sqlite(database_path) as connection:
        connection.execute(
            "CREATE TABLE backtest_summaries__new (id INTEGER PRIMARY KEY, evidence TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO backtest_summaries__new (id, evidence) VALUES (41, 'must-not-be-ignored')"
        )

    with pytest.raises(RuntimeError, match="partial migration artifact"):
        DatabaseManager(db_url=f"sqlite:///{database_path}")

    with connect_sqlite(database_path) as connection:
        assert connection.execute(
            "SELECT id, evidence FROM backtest_summaries__new"
        ).fetchall() == [(41, "must-not-be-ignored")]
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'backtest_summaries'"
        ).fetchone()[0] == 0


def test_sqlalchemy_pool_checkout_reenforces_foreign_keys(tmp_path: Path) -> None:
    engine = create_engine_with_sqlite_foreign_keys(
        f"sqlite:///{tmp_path / 'poisoned-pool.sqlite'}"
    )
    try:
        with engine.connect() as connection:
            _assert_sqlalchemy_connection_enforces_fks(connection)
            connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 0

        with engine.connect() as connection:
            _assert_sqlalchemy_connection_enforces_fks(connection)
    finally:
        engine.dispose()


def test_sqlalchemy_prepopulated_pool_checkout_enforces_foreign_keys(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "prepopulated-pool.sqlite"
    pool = QueuePool(lambda: sqlite3.connect(database_path))
    pooled_connection = pool.connect()
    try:
        assert pooled_connection.driver_connection.execute(
            "PRAGMA foreign_keys"
        ).fetchone()[0] == 0
    finally:
        pooled_connection.close()

    engine = create_engine_with_sqlite_foreign_keys(
        f"sqlite:///{database_path}",
        pool=pool,
    )
    try:
        with engine.connect() as connection:
            _assert_sqlalchemy_connection_enforces_fks(connection)
    finally:
        engine.dispose()


def _create_unknown_fk_drift_database(path: Path) -> None:
    engine = create_engine_with_sqlite_foreign_keys(f"sqlite:///{path}")
    metadata = MetaData()
    users = AppUser.__table__.to_metadata(metadata)
    sessions = Table(
        "app_user_sessions",
        metadata,
        Column("session_id", String(64), primary_key=True),
        Column("user_id", String(64), nullable=False),
        Column("created_at", DateTime),
        Column("last_seen_at", DateTime),
        Column("expires_at", DateTime, nullable=False),
        Column("revoked_at", DateTime),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            users.insert().values(
                id="known-user",
                username="known-user",
                role="user",
                is_active=True,
            )
        )
        connection.execute(
            sessions.insert().values(
                session_id="known-session",
                user_id="known-user",
                expires_at=datetime(2030, 1, 1),
            )
        )
    engine.dispose()


def test_unknown_legacy_fk_drift_fails_closed_and_rolls_back_schema_changes(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "unknown-fk-drift.sqlite"
    _create_unknown_fk_drift_database(database_path)

    with pytest.raises(SQLiteForeignKeySchemaError, match="inventory"):
        DatabaseManager(db_url=f"sqlite:///{database_path}")

    with connect_sqlite(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM app_user_sessions").fetchone()[0] == 1
        table_names = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    assert "portfolio_accounts" not in table_names


def test_historical_repository_accepts_and_verifies_injected_connection(
    tmp_path: Path,
) -> None:
    connection = connect_sqlite(tmp_path / "historical-injected.sqlite")
    repository = HistoricalMarketDataRepository(connection)
    try:
        assert repository.conn is connection
        assert repository.conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        repository.conn.close()


class _DisabledForeignKeyCursor:
    def __init__(self) -> None:
        self.closed = False

    def execute(self, _statement: str) -> None:
        return None

    def fetchone(self) -> tuple[int]:
        return (0,)

    def close(self) -> None:
        self.closed = True


class _DisabledForeignKeyConnection:
    def __init__(self) -> None:
        self.closed = False
        self.cursor_instance = _DisabledForeignKeyCursor()

    def cursor(self) -> _DisabledForeignKeyCursor:
        return self.cursor_instance

    def close(self) -> None:
        self.closed = True


def test_shared_authority_closes_and_raises_when_readback_stays_disabled() -> None:
    connection = _DisabledForeignKeyConnection()

    with pytest.raises(SQLiteForeignKeyEnforcementError, match="could not be verified"):
        enforce_sqlite_foreign_keys(connection)  # type: ignore[arg-type]

    assert connection.closed is True
    assert connection.cursor_instance.closed is True


def test_historical_repository_rejects_disabled_injected_connection() -> None:
    connection = _DisabledForeignKeyConnection()

    with pytest.raises(SQLiteForeignKeyEnforcementError, match="could not be verified"):
        HistoricalMarketDataRepository(connection)  # type: ignore[arg-type]

    assert connection.closed is True


@pytest.mark.parametrize(
    "opener",
    (open_migration_sqlite_readonly, open_retention_sqlite_readonly),
    ids=("migration-readiness", "retention-preview"),
)
def test_operational_readonly_owners_enforce_foreign_keys(
    tmp_path: Path,
    opener: Callable[[Path], Any],
) -> None:
    database_path = tmp_path / "readonly-owner.sqlite"
    DatabaseManager(db_url=f"sqlite:///{database_path}")
    DatabaseManager.reset_instance()

    with opener(database_path) as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("SELECT 1").fetchone()[0] == 1


def test_database_doctor_readonly_probe_enforces_foreign_keys(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "doctor.sqlite"
    DatabaseManager(db_url=f"sqlite:///{database_path}")
    DatabaseManager.reset_instance()
    observed: list[int] = []

    def observing_connect(*args: object, **kwargs: object) -> Any:
        connection = connect_sqlite(*args, **kwargs)  # type: ignore[arg-type]
        observed.append(int(connection.execute("PRAGMA foreign_keys").fetchone()[0]))
        return connection

    monkeypatch.setattr(database_doctor, "connect_sqlite", observing_connect)

    assert database_doctor._probe_sqlite_path(database_path) == {"ok": True, "error": None}
    assert observed == [1]


def test_release_backup_restore_starts_with_fk_integrity_and_retained_state(
    tmp_path: Path,
) -> None:
    source_path = tmp_path / "source.sqlite"
    backup_path = tmp_path / "backup.sqlite"
    restored_path = tmp_path / "restored.sqlite"
    source = DatabaseManager(db_url=f"sqlite:///{source_path}")
    source.create_or_update_app_user(
        user_id="restore-user",
        username="restore-user",
        role="user",
        is_active=True,
    )
    source.create_app_user_session(
        session_id="restore-session",
        user_id="restore-user",
        expires_at=datetime(2030, 1, 1),
    )
    DatabaseManager.reset_instance()

    _sqlite_backup(source_path, backup_path)
    _sqlite_backup(backup_path, restored_path)
    restored = DatabaseManager(db_url=f"sqlite:///{restored_path}")

    assert restored.get_app_user("restore-user") is not None
    assert restored.get_app_user_session("restore-session") is not None
    with restored._engine.connect() as connection:
        _assert_sqlalchemy_connection_enforces_fks(connection)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
        with restored._engine.begin() as connection:
            connection.exec_driver_sql(
                """
                INSERT INTO app_user_sessions (session_id, user_id, expires_at)
                VALUES ('restored-orphan', 'missing-user', '2030-01-01')
                """
            )


def test_file_database_simultaneous_independent_checkouts_enforce_fks(
    tmp_path: Path,
) -> None:
    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / 'concurrent.sqlite'}")

    with db._engine.connect() as first, db._engine.connect() as second:
        assert first.connection.driver_connection is not second.connection.driver_connection
        _assert_sqlalchemy_connection_enforces_fks(first)
        _assert_sqlalchemy_connection_enforces_fks(second)


def test_memory_static_pool_worker_thread_enforces_fks_and_rejects_orphan() -> None:
    db = DatabaseManager(db_url="sqlite:///:memory:")

    def worker() -> tuple[int, bool]:
        with db._engine.connect() as connection:
            enabled = int(connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one())
        try:
            with db._engine.begin() as connection:
                connection.exec_driver_sql(
                    """
                    INSERT INTO app_user_sessions (session_id, user_id, expires_at)
                    VALUES ('worker-orphan', 'missing-user', '2030-01-01')
                    """
                )
        except IntegrityError:
            return enabled, True
        return enabled, False

    with ThreadPoolExecutor(max_workers=1) as executor:
        enabled, rejected = executor.submit(worker).result(timeout=10)

    assert enabled == 1
    assert rejected is True


@pytest.mark.parametrize("database_kind", ("memory", "file"))
def test_phase_store_engine_enforces_fks_for_memory_and_file(
    tmp_path: Path,
    database_kind: str,
) -> None:
    db_url = (
        "sqlite:///:memory:"
        if database_kind == "memory"
        else f"sqlite:///{tmp_path / 'phase-store.sqlite'}"
    )
    engine = create_store_engine(db_url)
    try:
        with engine.connect() as connection:
            _assert_sqlalchemy_connection_enforces_fks(connection)
    finally:
        engine.dispose()


def test_phase_store_engine_enforces_fks_on_multiple_file_checkouts(
    tmp_path: Path,
) -> None:
    engine = create_store_engine(f"sqlite:///{tmp_path / 'phase-multiple.sqlite'}")
    try:
        with engine.connect() as first, engine.connect() as second:
            assert first.connection.driver_connection is not second.connection.driver_connection
            _assert_sqlalchemy_connection_enforces_fks(first)
            _assert_sqlalchemy_connection_enforces_fks(second)
    finally:
        engine.dispose()
