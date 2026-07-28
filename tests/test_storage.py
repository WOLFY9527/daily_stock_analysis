# -*- coding: utf-8 -*-
import unittest
import sys
import os
import re
import sqlite3
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
import pandas as pd
from sqlalchemy import Float, Text, inspect, text
from sqlalchemy.exc import StatementError

# Ensure src module can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.storage import (
    AppUser,
    Base,
    DatabaseManager,
    PortfolioAccount,
    PortfolioBrokerConnection,
    PortfolioBrokerSyncCashBalance,
    PortfolioBrokerSyncPosition,
    PortfolioBrokerSyncState,
    PortfolioCashLedger,
    PortfolioCorporateAction,
    PortfolioDailySnapshot,
    PortfolioFxRate,
    PortfolioPosition,
    PortfolioPositionLot,
    PortfolioTrade,
    StockDaily,
)
from src.analyzer import AnalysisResult
from src.portfolio_exact_numeric import (
    PortfolioExactNumeric,
    PortfolioExactNumericError,
    normalize_portfolio_decimal,
    serialize_legacy_portfolio_decimal,
    serialize_portfolio_decimal,
)
from src.repositories.analysis_repo import AnalysisRepository
from src.repositories.portfolio_repo import PortfolioRepository
from src.repositories.scanner_repo import ScannerRepository
from src.repositories.stock_repo import StockRepository
from src.sqlite_foreign_keys import verify_sqlite_foreign_key_schema
from src.storage import AppUserSession

class TestStorage(unittest.TestCase):

    @staticmethod
    def _portfolio_exact_columns() -> dict[str, set[str]]:
        return {
            "portfolio_trades": {"quantity", "price", "fee", "tax"},
            "portfolio_cash_ledger": {"amount"},
            "portfolio_corporate_actions": {"cash_dividend_per_share", "split_ratio"},
            "portfolio_positions": {
                "quantity", "avg_cost", "total_cost", "last_price", "market_value_base", "unrealized_pnl_base", "price_cost",
            },
            "portfolio_position_lots": {"remaining_quantity", "unit_cost"},
            "portfolio_daily_snapshots": {
                "total_cash", "total_market_value", "total_equity", "unrealized_pnl", "realized_pnl", "fee_total", "tax_total",
            },
            "portfolio_fx_rates": {"rate"},
            "portfolio_broker_sync_states": {
                "total_cash", "total_market_value", "total_equity", "realized_pnl", "unrealized_pnl",
            },
            "portfolio_broker_sync_positions": {
                "quantity", "avg_cost", "last_price", "market_value_base", "unrealized_pnl_base",
            },
            "portfolio_broker_sync_cash_balances": {"amount", "amount_base"},
        }

    @staticmethod
    def _replace_portfolio_tables_with_legacy_float_schema(
        db_path: str,
        exact_columns: dict[str, set[str]],
    ) -> None:
        """Build a file-backed pre-R05 SQLite fixture without weakening runtime FKs."""
        connection = sqlite3.connect(db_path)
        try:
            table_sql: dict[str, str] = {}
            index_sql: dict[str, list[str]] = {}
            for table_name, column_names in exact_columns.items():
                create_sql = connection.execute(
                    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
                    (table_name,),
                ).fetchone()[0]
                legacy_name = f"{table_name}__legacy_precision_fixture"
                legacy_sql = create_sql.replace(
                    f"CREATE TABLE {table_name}",
                    f"CREATE TABLE {legacy_name}",
                    1,
                )
                for column_name in column_names:
                    legacy_sql, replacements = re.subn(
                        rf"(\b{re.escape(column_name)}\b\s+)TEXT\b",
                        r"\1FLOAT",
                        legacy_sql,
                        count=1,
                    )
                    if replacements == 1:
                        continue
                    if re.search(rf"\b{re.escape(column_name)}\b\s+FLOAT\b", create_sql):
                        continue
                    if replacements != 1:
                        raise AssertionError(
                            f"Could not build legacy FLOAT fixture for {table_name}.{column_name}: {create_sql}"
                        )
                table_sql[table_name] = legacy_sql
                index_sql[table_name] = [
                    row[0]
                    for row in connection.execute(
                        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
                        (table_name,),
                    )
                    if row[0]
                ]

            for table_name in exact_columns:
                connection.execute(table_sql[table_name])
                columns = [
                    row[1]
                    for row in connection.execute(f'PRAGMA table_xinfo("{table_name}")')
                ]
                quoted_columns = ", ".join(f'"{column}"' for column in columns)
                connection.execute(
                    f'INSERT INTO "{table_name}__legacy_precision_fixture" ({quoted_columns}) '
                    f'SELECT {quoted_columns} FROM "{table_name}"'
                )

            # SQLite leaves foreign-key checks disabled by default for this raw legacy
            # fixture connection. The application startup under test re-enables and
            # verifies them before it can report success.
            for table_name in (
                "portfolio_position_lots",
                "portfolio_broker_sync_positions",
                "portfolio_broker_sync_cash_balances",
                "portfolio_broker_sync_states",
                "portfolio_daily_snapshots",
                "portfolio_positions",
                "portfolio_corporate_actions",
                "portfolio_cash_ledger",
                "portfolio_trades",
                "portfolio_fx_rates",
            ):
                connection.execute(f'DROP TABLE "{table_name}"')

            for table_name in (
                "portfolio_trades",
                "portfolio_cash_ledger",
                "portfolio_corporate_actions",
                "portfolio_positions",
                "portfolio_daily_snapshots",
                "portfolio_fx_rates",
                "portfolio_broker_sync_states",
                "portfolio_broker_sync_positions",
                "portfolio_broker_sync_cash_balances",
                "portfolio_position_lots",
            ):
                connection.execute(
                    f'ALTER TABLE "{table_name}__legacy_precision_fixture" RENAME TO "{table_name}"'
                )
                for statement in index_sql[table_name]:
                    connection.execute(statement)
            for table_name, column_names in exact_columns.items():
                column_types = {
                    row[1]: str(row[2]).upper()
                    for row in connection.execute(f'PRAGMA table_xinfo("{table_name}")')
                }
                if {column_types[column_name] for column_name in column_names} != {"FLOAT"}:
                    raise AssertionError(
                        f"Legacy fixture did not retain FLOAT storage for {table_name}"
                    )
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise AssertionError("Legacy fixture must preserve valid foreign-key rows")
            connection.commit()
        finally:
            connection.close()

    def _build_analysis_result(self, *, code: str, name: str) -> AnalysisResult:
        return AnalysisResult(
            code=code,
            name=name,
            sentiment_score=70,
            trend_prediction="看多",
            operation_advice="持有",
            analysis_summary=f"{name} 分析摘要",
        )
    
    def test_parse_sniper_value(self):
        """测试解析狙击点位数值"""
        
        # 1. 正常数值
        self.assertEqual(DatabaseManager._parse_sniper_value(100), 100.0)
        self.assertEqual(DatabaseManager._parse_sniper_value(100.5), 100.5)
        self.assertEqual(DatabaseManager._parse_sniper_value("100"), 100.0)
        self.assertEqual(DatabaseManager._parse_sniper_value("100.5"), 100.5)
        
        # 2. 包含中文描述和"元"
        self.assertEqual(DatabaseManager._parse_sniper_value("建议在 100 元附近买入"), 100.0)
        self.assertEqual(DatabaseManager._parse_sniper_value("价格：100.5元"), 100.5)
        
        # 3. 包含干扰数字（修复的Bug场景）
        # 之前 "MA5" 会被错误提取为 5.0，现在应该提取 "元" 前面的 100
        text_bug = "无法给出。需等待MA5数据恢复，在股价回踩MA5且乖离率<2%时考虑100元"
        self.assertEqual(DatabaseManager._parse_sniper_value(text_bug), 100.0)
        
        # 4. 更多干扰场景
        text_complex = "MA10为20.5，建议在30元买入"
        self.assertEqual(DatabaseManager._parse_sniper_value(text_complex), 30.0)
        
        text_multiple = "支撑位10元，阻力位20元" # 应该提取最后一个"元"前面的数字，即20，或者更复杂的逻辑？
        # 当前逻辑是找最后一个冒号，然后找之后的第一个"元"，提取中间的数字。
        # 测试没有冒号的情况
        self.assertEqual(DatabaseManager._parse_sniper_value("30元"), 30.0)
        
        # 测试多个数字在"元"之前
        self.assertEqual(DatabaseManager._parse_sniper_value("MA5 10 20元"), 20.0)
        
        # 5. Fallback: no "元" character — extracts last non-MA number
        self.assertEqual(DatabaseManager._parse_sniper_value("102.10-103.00（MA5附近）"), 103.0)
        self.assertEqual(DatabaseManager._parse_sniper_value("97.62-98.50（MA10附近）"), 98.5)
        self.assertEqual(DatabaseManager._parse_sniper_value("93.40下方（MA20支撑）"), 93.4)
        self.assertEqual(DatabaseManager._parse_sniper_value("108.00-110.00（前期高点阻力）"), 110.0)

        # 6. 无效输入
        self.assertIsNone(DatabaseManager._parse_sniper_value(None))
        self.assertIsNone(DatabaseManager._parse_sniper_value(""))
        self.assertIsNone(DatabaseManager._parse_sniper_value("没有数字"))
        self.assertIsNone(DatabaseManager._parse_sniper_value("MA5但没有元"))

        # 7. 回归：括号内技术指标数字不应被提取
        self.assertNotEqual(DatabaseManager._parse_sniper_value("1.52-1.53 (回踩MA5/10附近)"), 10.0)
        self.assertNotEqual(DatabaseManager._parse_sniper_value("1.55-1.56(MA5/M20支撑)"), 20.0)
        self.assertNotEqual(DatabaseManager._parse_sniper_value("1.49-1.50(MA60附近企稳)"), 60.0)
        # 验证正确值在区间内
        self.assertIn(DatabaseManager._parse_sniper_value("1.52-1.53 (回踩MA5/10附近)"), [1.52, 1.53])
        self.assertIn(DatabaseManager._parse_sniper_value("1.55-1.56(MA5/M20支撑)"), [1.55, 1.56])
        self.assertIn(DatabaseManager._parse_sniper_value("1.49-1.50(MA60附近企稳)"), [1.49, 1.50])

    def test_get_chat_sessions_prefix_is_scoped_by_colon_boundary(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")

        db.save_conversation_message("telegram_12345:chat", "user", "first user")
        db.save_conversation_message("telegram_123456:chat", "user", "second user")

        sessions = db.get_chat_sessions(session_prefix="telegram_12345")

        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["session_id"], "telegram_12345:chat")

        DatabaseManager.reset_instance()

    def test_get_chat_sessions_can_include_legacy_exact_session_id(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")

        db.save_conversation_message("feishu_u1", "user", "legacy chat")
        db.save_conversation_message("feishu_u1:ask_600519", "user", "ask session")

        sessions = db.get_chat_sessions(
            session_prefix="feishu_u1:",
            extra_session_ids=["feishu_u1"],
        )

        self.assertEqual({item["session_id"] for item in sessions}, {"feishu_u1", "feishu_u1:ask_600519"})

        DatabaseManager.reset_instance()

    def test_list_recent_analysis_symbols_returns_shared_recent_code_name_view(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")

        db.save_analysis_history(
            result=self._build_analysis_result(code="600001", name="算力龙头"),
            query_id="query_600001",
            report_type="simple",
            news_content="",
            save_snapshot=False,
        )
        db.save_analysis_history(
            result=self._build_analysis_result(code="600002", name="机器人核心"),
            query_id="query_600002",
            report_type="simple",
            news_content="",
            save_snapshot=False,
        )

        recent_symbols = db.list_recent_analysis_symbols()
        scanner_repo = ScannerRepository(db)
        analysis_repo = AnalysisRepository(db)

        self.assertEqual(
            recent_symbols[:2],
            [("600002", "机器人核心"), ("600001", "算力龙头")],
        )
        self.assertEqual(scanner_repo.list_recent_analysis_symbols()[:2], recent_symbols[:2])
        self.assertEqual(
            analysis_repo.list_recent_named_codes()[:2],
            [
                {"code": "600002", "name": "机器人核心"},
                {"code": "600001", "name": "算力龙头"},
            ],
        )

        DatabaseManager.reset_instance()

    def test_list_recent_analysis_symbols_is_limited_deduped_and_owner_scoped(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")
        db.create_or_update_app_user(user_id="owner-a", username="owner-a")
        db.create_or_update_app_user(user_id="owner-b", username="owner-b")

        db.save_analysis_history(
            result=self._build_analysis_result(code="600001", name="旧名称"),
            query_id="query_owner_a_old",
            report_type="simple",
            news_content="",
            save_snapshot=False,
            owner_id="owner-a",
        )
        db.save_analysis_history(
            result=self._build_analysis_result(code="600003", name="其他用户"),
            query_id="query_owner_b",
            report_type="simple",
            news_content="",
            save_snapshot=False,
            owner_id="owner-b",
        )
        db.save_analysis_history(
            result=self._build_analysis_result(code="600002", name="机器人核心"),
            query_id="query_owner_a_second",
            report_type="simple",
            news_content="",
            save_snapshot=False,
            owner_id="owner-a",
        )
        db.save_analysis_history(
            result=self._build_analysis_result(code="600001", name="新名称"),
            query_id="query_owner_a_new",
            report_type="simple",
            news_content="",
            save_snapshot=False,
            owner_id="owner-a",
        )

        recent_symbols = db.list_recent_analysis_symbols(owner_id="owner-a", limit=2)
        scanner_repo = ScannerRepository(db)
        analysis_repo = AnalysisRepository(db, owner_id="owner-a")

        self.assertEqual(recent_symbols, [("600001", "新名称"), ("600002", "机器人核心")])
        self.assertEqual(
            scanner_repo.list_recent_analysis_symbols(owner_id="owner-a", limit=1),
            [("600001", "新名称")],
        )
        self.assertEqual(
            analysis_repo.list_recent_named_codes(limit=2),
            [
                {"code": "600001", "name": "新名称"},
                {"code": "600002", "name": "机器人核心"},
            ],
        )
        self.assertEqual(len(db.list_recent_analysis_symbols(limit=2)), 2)

        DatabaseManager.reset_instance()

    def test_touch_and_revoke_app_user_session_keep_session_state_consistent(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")

        user = db.ensure_bootstrap_admin_user()
        expires_at = datetime.now() + timedelta(hours=1)
        created = db.create_app_user_session(
            session_id="session-1",
            user_id=str(user.id),
            expires_at=expires_at,
        )

        self.assertEqual(created.session_id, "session-1")
        self.assertTrue(db.touch_app_user_session("session-1"))
        self.assertTrue(db.revoke_app_user_session("session-1"))

        row = db.get_app_user_session("session-1")
        self.assertIsNotNone(row)
        self.assertIsNotNone(row.last_seen_at)
        self.assertIsNotNone(row.revoked_at)

        DatabaseManager.reset_instance()

    def test_portfolio_authoritative_columns_use_exact_numeric_types(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")
        inspector = inspect(db._engine)

        expected = {
            "stock_daily": (StockDaily, {"close"}),
            "portfolio_trades": (PortfolioTrade, {"quantity", "price", "fee", "tax"}),
            "portfolio_cash_ledger": (PortfolioCashLedger, {"amount"}),
            "portfolio_positions": (PortfolioPosition, {
                "quantity",
                "avg_cost",
                "total_cost",
                "last_price",
                "market_value_base",
                "unrealized_pnl_base",
                "price_cost",
            }),
            "portfolio_daily_snapshots": (PortfolioDailySnapshot, {
                "total_cash",
                "total_market_value",
                "total_equity",
                "realized_pnl",
                "unrealized_pnl",
                "fee_total",
                "tax_total",
            }),
            "portfolio_broker_sync_states": (PortfolioBrokerSyncState, {
                "total_cash",
                "total_market_value",
                "total_equity",
                "realized_pnl",
                "unrealized_pnl",
            }),
            "portfolio_broker_sync_positions": (PortfolioBrokerSyncPosition, {
                "quantity",
                "avg_cost",
                "last_price",
                "market_value_base",
                "unrealized_pnl_base",
            }),
            "portfolio_broker_sync_cash_balances": (PortfolioBrokerSyncCashBalance, {"amount", "amount_base"}),
            "portfolio_position_lots": (PortfolioPositionLot, {"remaining_quantity", "unit_cost"}),
            "portfolio_corporate_actions": (PortfolioCorporateAction, {"cash_dividend_per_share", "split_ratio"}),
            "portfolio_fx_rates": (PortfolioFxRate, {"rate"}),
        }

        for table_name, (model_class, column_names) in expected.items():
            declared_columns = {
                column_name: model_class.__table__.c[column_name].type
                for column_name in column_names
            }
            observed_columns = {
                str(column["name"]): column["type"]
                for column in inspector.get_columns(table_name)
                if str(column["name"]) in column_names
            }
            self.assertEqual(set(declared_columns), column_names)
            self.assertEqual(set(observed_columns), column_names)
            for column_name, declared_type in declared_columns.items():
                self.assertIsInstance(
                    declared_type,
                    PortfolioExactNumeric,
                    msg=f"{table_name}.{column_name} must be declared with PortfolioExactNumeric, observed {declared_type!r}",
                )
                self.assertNotIsInstance(
                    declared_type,
                    Float,
                    msg=f"{table_name}.{column_name} declared type must not be Float, observed {declared_type!r}",
                )
            for column_name, column_type in observed_columns.items():
                self.assertIsInstance(
                    column_type,
                    Text,
                    msg=f"{table_name}.{column_name} must use SQLite TEXT storage for exact numerics, observed {column_type!s}",
                )
                self.assertNotIsInstance(
                    column_type,
                    Float,
                    msg=f"{table_name}.{column_name} must not use SQLite REAL/Float storage, observed {column_type!s}",
                )

        DatabaseManager.reset_instance()

    def test_stock_daily_close_preserves_exact_decimal_storage(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_close = Decimal("1234567890123456.12345678")
        db = DatabaseManager(db_url="sqlite:///:memory:")

        with db.get_session() as session:
            session.add(
                StockDaily(
                    code="AAPL",
                    date=date(2026, 3, 2),
                    close=exact_close,
                    data_source="exact-quote-fixture",
                )
            )
            session.commit()
            stored = session.execute(
                text("SELECT close, typeof(close) FROM stock_daily WHERE code = 'AAPL'")
            ).one()
            reloaded = session.query(StockDaily).filter(StockDaily.code == "AAPL").one()

        self.assertEqual(stored, (format(exact_close, "f"), "text"))
        self.assertEqual(reloaded.close, exact_close)

    def test_portfolio_exact_numeric_runtime_bind_rejects_binary_float(self):
        self.addCleanup(DatabaseManager.reset_instance)
        db = DatabaseManager(db_url="sqlite:///:memory:")

        with db.get_session() as session:
            session.add(
                StockDaily(
                    code="AAPL",
                    date=date(2026, 3, 2),
                    close=0.1,
                    data_source="invalid-float-fixture",
                )
            )
            with self.assertRaises(StatementError) as ctx:
                session.commit()

        self.assertIsInstance(ctx.exception.orig, PortfolioExactNumericError)

    def test_save_daily_data_requires_exact_market_price_ingress(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_close = Decimal("1234567890123456.12345678")
        db = DatabaseManager(db_url="sqlite:///:memory:")

        saved = db.save_daily_data(
            pd.DataFrame(
                [
                    {
                        "date": date(2026, 3, 2),
                        "close": format(exact_close, "f"),
                    }
                ]
            ),
            code="AAPL",
            data_source="exact-quote-fixture",
        )

        self.assertEqual(saved, 1)
        with self.assertRaises(PortfolioExactNumericError):
            db.save_daily_data(
                pd.DataFrame(
                    [
                        {
                            "date": date(2026, 3, 2),
                            "close": 1.25,
                        }
                    ]
                ),
                code="AAPL",
                data_source="binary-float-fixture",
            )

        with self.assertRaises(PortfolioExactNumericError):
            db.save_daily_data(
                pd.DataFrame(
                    [
                        {
                            "date": date(2026, 3, 2),
                            "close": "110.0",
                        }
                    ]
                ),
                code="00700",
                data_source="ambiguous-market-fixture",
            )

        repository = StockRepository(db)
        with self.assertRaises(PortfolioExactNumericError):
            repository.save_dataframe(
                pd.DataFrame(
                    [
                        {
                            "date": date(2026, 3, 3),
                            "close": 1.25,
                        }
                    ]
                ),
                code="MSFT",
                data_source="repository-binary-float-fixture",
            )

        with db.get_session() as session:
            stored = session.execute(
                text("SELECT close, data_source FROM stock_daily WHERE code = 'AAPL'")
            ).one()
            rejected_rows = session.execute(
                text("SELECT COUNT(*) FROM stock_daily WHERE code = 'MSFT'")
            ).scalar_one()
        self.assertEqual(stored, (format(exact_close, "f"), "exact-quote-fixture"))
        self.assertEqual(rejected_rows, 0)

    def test_save_daily_data_uses_date_keyed_exact_close_provenance(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_close = Decimal("1234567890123456.12345678")
        db = DatabaseManager(db_url="sqlite:///:memory:")
        frame = pd.DataFrame(
            [
                {
                    "date": date(2026, 3, 2),
                    # Analytics may need a numeric view, but this binary float is lossy.
                    "close": float(exact_close),
                }
            ]
        )
        frame.attrs["wolfystock.stock_daily.close_tokens.v1"] = {
            "2026-03-02": format(exact_close, "f"),
        }

        saved = db.save_daily_data(frame, code="AAPL", data_source="textual-source-fixture")

        self.assertEqual(saved, 1)
        with db.get_session() as session:
            stored = session.execute(
                text("SELECT close FROM stock_daily WHERE code = 'AAPL'")
            ).scalar_one()
        self.assertEqual(stored, format(exact_close, "f"))

    def test_stock_daily_legacy_float_close_migrates_to_canonical_text(self):
        self.addCleanup(DatabaseManager.reset_instance)

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-stock-daily.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                table_sql = str(
                    connection.execute(
                        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'stock_daily'"
                    ).fetchone()[0]
                )
                index_sql = [
                    str(row[0])
                    for row in connection.execute(
                        "SELECT sql FROM sqlite_schema "
                        "WHERE type = 'index' AND tbl_name = 'stock_daily' AND sql IS NOT NULL"
                    ).fetchall()
                ]
                legacy_table_sql, replacements = re.subn(
                    r"(\bclose\b\s+)TEXT\b",
                    r"\1FLOAT",
                    table_sql,
                    count=1,
                    flags=re.IGNORECASE,
                )
                self.assertEqual(replacements, 1)
                connection.execute("DROP TABLE stock_daily")
                connection.execute(legacy_table_sql)
                for statement in index_sql:
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO stock_daily (id, code, date, close) VALUES (?, ?, ?, ?)",
                    (1, "AAPL", "2026-03-02", 1234.12345678),
                )
                legacy_close = connection.execute(
                    "SELECT close FROM stock_daily WHERE id = 1"
                ).fetchone()[0]
                expected_close = serialize_legacy_portfolio_decimal(
                    legacy_close,
                    kind="price",
                    market="us",
                )
                connection.commit()
            finally:
                connection.close()

            migrated = DatabaseManager(db_url=db_url)
            with migrated._engine.connect() as connection:
                column_types = {
                    str(row[1]): str(row[2]).upper()
                    for row in connection.exec_driver_sql("PRAGMA table_xinfo(stock_daily)")
                }
                stored = connection.exec_driver_sql(
                    "SELECT close, typeof(close) FROM stock_daily WHERE id = 1"
                ).one()

            self.assertEqual(column_types["close"], "TEXT")
            self.assertEqual(stored, (expected_close, "text"))
            DatabaseManager.reset_instance()
            reopened = DatabaseManager(db_url=db_url)
            with reopened._engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql(
                        "SELECT close, typeof(close) FROM stock_daily WHERE id = 1"
                    ).one(),
                    (expected_close, "text"),
                )

    def test_stock_daily_exact_migration_refuses_unsupported_primary_dialect(self):
        connection = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        with self.assertRaisesRegex(RuntimeError, "only the SQLite primary store"):
            DatabaseManager._migrate_stock_daily_close_to_exact_numeric(
                SimpleNamespace(),
                connection,
            )

    def test_portfolio_exact_numeric_migration_rejects_external_inbound_foreign_key(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_columns = self._portfolio_exact_columns()

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-inbound.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()
            self._replace_portfolio_tables_with_legacy_float_schema(db_path, exact_columns)

            connection = sqlite3.connect(db_path)
            try:
                connection.execute(
                    "CREATE TABLE portfolio_external_trade_reference "
                    "(id INTEGER PRIMARY KEY, trade_id INTEGER NOT NULL "
                    "REFERENCES portfolio_trades(id))"
                )
                connection.commit()
            finally:
                connection.close()

            with self.assertRaisesRegex(
                RuntimeError,
                "manual inbound foreign-key review",
            ):
                DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                self.assertIsNotNone(
                    connection.execute(
                        "SELECT 1 FROM sqlite_schema WHERE type = 'table' "
                        "AND name = 'portfolio_external_trade_reference'"
                    ).fetchone()
                )
                self.assertEqual(
                    {
                        row[2].upper()
                        for row in connection.execute('PRAGMA table_xinfo("portfolio_trades")')
                        if row[1] in exact_columns["portfolio_trades"]
                    },
                    {"FLOAT"},
                )
            finally:
                connection.close()

    def test_portfolio_exact_numeric_migration_rejects_invalid_legacy_value_before_rename(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_columns = self._portfolio_exact_columns()

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-invalid.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            db = DatabaseManager(db_url=db_url)
            with db.get_session() as session:
                session.add(AppUser(id="legacy-owner", username="legacy-owner", role="user", is_active=True))
                session.flush()
                account = PortfolioAccount(
                    owner_id="legacy-owner",
                    name="Legacy invalid value",
                    market="us",
                    base_currency="USD",
                )
                session.add(account)
                session.flush()
                trade = PortfolioTrade(
                    account_id=account.id,
                    symbol="AAPL",
                    market="us",
                    currency="USD",
                    trade_date=date(2026, 2, 5),
                    side="buy",
                    quantity=Decimal("1.00000000"),
                    price=Decimal("1.00000000"),
                    fee=Decimal("0"),
                    tax=Decimal("0"),
                )
                session.add(trade)
                session.commit()
                trade_id = int(trade.id)

            DatabaseManager.reset_instance()
            self._replace_portfolio_tables_with_legacy_float_schema(db_path, exact_columns)
            connection = sqlite3.connect(db_path)
            try:
                connection.execute(
                    "UPDATE portfolio_trades SET quantity = ? WHERE id = ?",
                    ("not-a-number", trade_id),
                )
                connection.commit()
            finally:
                connection.close()

            with self.assertRaisesRegex(
                RuntimeError,
                "invalid value: portfolio_trades.quantity",
            ):
                DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    connection.execute(
                        "SELECT quantity FROM portfolio_trades WHERE id = ?",
                        (trade_id,),
                    ).fetchone()[0],
                    "not-a-number",
                )
                self.assertEqual(
                    {
                        row[2].upper()
                        for row in connection.execute('PRAGMA table_xinfo("portfolio_trades")')
                        if row[1] in exact_columns["portfolio_trades"]
                    },
                    {"FLOAT"},
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT name FROM sqlite_schema WHERE name LIKE '%__wolfy_precision_old'"
                    ).fetchall(),
                    [],
                )
            finally:
                connection.close()

    def test_portfolio_exact_numeric_migration_rejects_mixed_storage_before_rebuild(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_columns = self._portfolio_exact_columns()

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-mixed.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()
            self._replace_portfolio_tables_with_legacy_float_schema(db_path, exact_columns)

            connection = sqlite3.connect(db_path)
            try:
                create_sql = connection.execute(
                    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'portfolio_fx_rates'"
                ).fetchone()[0]
                index_sql = [
                    row[0]
                    for row in connection.execute(
                        "SELECT sql FROM sqlite_schema WHERE type = 'index' "
                        "AND tbl_name = 'portfolio_fx_rates' AND sql IS NOT NULL"
                    )
                    if row[0]
                ]
                connection.execute(
                    'ALTER TABLE "portfolio_fx_rates" RENAME TO "portfolio_fx_rates__mixed_precision_fixture"'
                )
                connection.execute(create_sql.replace("FLOAT", "TEXT", 1))
                columns = [
                    row[1]
                    for row in connection.execute(
                        'PRAGMA table_xinfo("portfolio_fx_rates__mixed_precision_fixture")'
                    )
                ]
                quoted_columns = ", ".join(f'"{column}"' for column in columns)
                connection.execute(
                    f'INSERT INTO "portfolio_fx_rates" ({quoted_columns}) '
                    f'SELECT {quoted_columns} FROM "portfolio_fx_rates__mixed_precision_fixture"'
                )
                connection.execute('DROP TABLE "portfolio_fx_rates__mixed_precision_fixture"')
                for statement in index_sql:
                    connection.execute(statement)
                connection.commit()
            finally:
                connection.close()

            with self.assertRaisesRegex(
                RuntimeError,
                "refuses mixed legacy and canonical storage",
            ):
                DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                self.assertEqual(
                    {
                        row[2].upper()
                        for row in connection.execute('PRAGMA table_xinfo("portfolio_fx_rates")')
                        if row[1] in exact_columns["portfolio_fx_rates"]
                    },
                    {"TEXT"},
                )
                self.assertEqual(
                    {
                        row[2].upper()
                        for row in connection.execute('PRAGMA table_xinfo("portfolio_trades")')
                        if row[1] in exact_columns["portfolio_trades"]
                    },
                    {"FLOAT"},
                )
            finally:
                connection.close()

    def test_portfolio_exact_numeric_migration_rejects_partial_artifact(self):
        self.addCleanup(DatabaseManager.reset_instance)

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "precision-artifact.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                connection.execute(
                    'ALTER TABLE "portfolio_fx_rates" RENAME TO "portfolio_fx_rates__wolfy_precision_old"'
                )
                connection.commit()
            finally:
                connection.close()

            with self.assertRaisesRegex(
                RuntimeError,
                "partial exact-numeric migration artifact",
            ):
                DatabaseManager(db_url=db_url)
            DatabaseManager.reset_instance()

            connection = sqlite3.connect(db_path)
            try:
                self.assertIsNotNone(
                    connection.execute(
                        "SELECT 1 FROM sqlite_schema WHERE type = 'table' "
                        "AND name = 'portfolio_fx_rates__wolfy_precision_old'"
                    ).fetchone()
                )
                self.assertIsNone(
                    connection.execute(
                        "SELECT 1 FROM sqlite_schema WHERE type = 'table' "
                        "AND name = 'portfolio_fx_rates'"
                    ).fetchone()
                )
            finally:
                connection.close()

    def test_portfolio_exact_numeric_normalization_is_finite_and_uses_half_even_rounding(self):
        self.assertEqual(
            serialize_portfolio_decimal(Decimal("1.000000005")),
            "1.00000000",
        )
        self.assertEqual(
            serialize_portfolio_decimal(Decimal("1.000000015")),
            "1.00000002",
        )
        self.assertEqual(serialize_portfolio_decimal("1e-8"), "0.00000001")
        self.assertEqual(serialize_portfolio_decimal(Decimal("-0")), "0.00000000")
        self.assertEqual(
            normalize_portfolio_decimal(Decimal("1234567890123456.12345678")),
            Decimal("1234567890123456.12345678"),
        )

        for invalid_value in ("NaN", "Infinity", "-Infinity", "not-a-number"):
            with self.assertRaises(PortfolioExactNumericError):
                normalize_portfolio_decimal(invalid_value)
        with self.assertRaises(PortfolioExactNumericError):
            normalize_portfolio_decimal(Decimal("9999999999999999.999999995"))

    def test_phase_f_shadow_sync_state_comparison_payload_preserves_storage_scale(self):
        exact_storage_value = Decimal("0.00400000")
        row = SimpleNamespace(
            id=1,
            owner_id="phase-f-storage-scale",
            broker_connection_id=2,
            portfolio_account_id=3,
            broker_type="ibkr",
            broker_account_ref=None,
            sync_source="api",
            sync_status="success",
            base_currency="USD",
            total_cash=exact_storage_value,
            total_market_value=exact_storage_value,
            total_equity=exact_storage_value,
            realized_pnl=exact_storage_value,
            unrealized_pnl=exact_storage_value,
            fx_stale=False,
            payload_json={},
        )
        payload = DatabaseManager._phase_f_shadow_sync_state_payload(row)

        self.assertEqual(
            {
                field: payload[field]
                for field in (
                    "total_cash",
                    "total_market_value",
                    "total_equity",
                    "realized_pnl",
                    "unrealized_pnl",
                )
            },
            {
                "total_cash": "0.00400000",
                "total_market_value": "0.00400000",
                "total_equity": "0.00400000",
                "realized_pnl": "0.00400000",
                "unrealized_pnl": "0.00400000",
            },
        )

        row.total_cash = 0.004
        with self.assertRaises(PortfolioExactNumericError):
            DatabaseManager._phase_f_shadow_sync_state_payload(row)

    def test_portfolio_legacy_float_schema_is_rebuilt_to_exact_text_without_losing_fk_rows(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_value = Decimal("1.10000001")
        exact_storage = format(exact_value, "f")
        money_value = Decimal("1.10")
        money_storage = serialize_portfolio_decimal(money_value)
        exact_columns = self._portfolio_exact_columns()
        invalid_money_cases = (
            ("portfolio_trades", "fee"),
            ("portfolio_cash_ledger", "amount"),
            ("portfolio_broker_sync_states", "total_cash"),
            ("portfolio_broker_sync_positions", "market_value_base"),
            ("portfolio_broker_sync_cash_balances", "amount"),
            ("portfolio_broker_sync_cash_balances", "amount_base"),
        )

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-portfolio.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            db = DatabaseManager(db_url=db_url)
            with db.get_session() as session:
                session.add(AppUser(id="legacy-owner", username="legacy-owner", role="user", is_active=True))
                session.flush()
                account = PortfolioAccount(
                    owner_id="legacy-owner",
                    name="Legacy exact",
                    broker="Demo",
                    market="us",
                    base_currency="USD",
                )
                session.add(account)
                session.flush()
                connection = PortfolioBrokerConnection(
                    owner_id="legacy-owner",
                    portfolio_account_id=account.id,
                    broker_type="demo",
                    connection_name="Legacy exact connection",
                    broker_account_ref="legacy-exact",
                    import_mode="api",
                    status="active",
                )
                session.add(connection)
                session.flush()
                trade = PortfolioTrade(
                    account_id=account.id,
                    symbol="AAPL",
                    market="us",
                    currency="USD",
                    trade_date=date(2026, 2, 5),
                    side="buy",
                    quantity=exact_value,
                    price=exact_value,
                    fee=money_value,
                    tax=money_value,
                    is_active=True,
                )
                session.add(trade)
                session.flush()
                cash_entry = PortfolioCashLedger(
                    account_id=account.id,
                    event_date=date(2026, 2, 5),
                    direction="in",
                    amount=money_value,
                    currency="USD",
                )
                session.add_all([
                    cash_entry,
                    PortfolioCorporateAction(
                        account_id=account.id,
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        effective_date=date(2026, 2, 5),
                        action_type="cash_dividend",
                        cash_dividend_per_share=exact_value,
                    ),
                    PortfolioPosition(
                        account_id=account.id,
                        cost_method="fifo",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        quantity=exact_value,
                        avg_cost=exact_value,
                        total_cost=exact_value,
                        last_price=exact_value,
                        market_value_base=exact_value,
                        unrealized_pnl_base=exact_value,
                        valuation_currency="USD",
                        price_cost=exact_value,
                    ),
                    PortfolioPositionLot(
                        account_id=account.id,
                        cost_method="fifo",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        open_date=date(2026, 2, 5),
                        remaining_quantity=exact_value,
                        unit_cost=exact_value,
                        source_trade_id=trade.id,
                    ),
                    PortfolioDailySnapshot(
                        account_id=account.id,
                        snapshot_date=date(2026, 2, 5),
                        cost_method="fifo",
                        base_currency="USD",
                        total_cash=exact_value,
                        total_market_value=exact_value,
                        total_equity=exact_value,
                        unrealized_pnl=exact_value,
                        realized_pnl=exact_value,
                        fee_total=exact_value,
                        tax_total=exact_value,
                        fx_stale=False,
                        payload="{}",
                    ),
                    PortfolioFxRate(
                        from_currency="EUR",
                        to_currency="USD",
                        rate_date=date(2026, 2, 5),
                        rate=exact_value,
                        source="fixture",
                        is_stale=False,
                    ),
                ])
                session.flush()
                sync_state = PortfolioBrokerSyncState(
                    owner_id="legacy-owner",
                    broker_connection_id=connection.id,
                    portfolio_account_id=account.id,
                    broker_type="demo",
                    snapshot_date=date(2026, 2, 5),
                    synced_at=datetime(2026, 2, 5, 12, 0, 0),
                    base_currency="USD",
                    total_cash=money_value,
                    total_market_value=money_value,
                    total_equity=money_value,
                    realized_pnl=money_value,
                    unrealized_pnl=money_value,
                    fx_stale=False,
                )
                session.add(sync_state)
                session.add_all([
                    PortfolioBrokerSyncPosition(
                        owner_id="legacy-owner",
                        broker_connection_id=connection.id,
                        portfolio_account_id=account.id,
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        quantity=exact_value,
                        avg_cost=exact_value,
                        last_price=exact_value,
                        market_value_base=money_value,
                        unrealized_pnl_base=money_value,
                        valuation_currency="USD",
                    ),
                    PortfolioBrokerSyncCashBalance(
                        owner_id="legacy-owner",
                        broker_connection_id=connection.id,
                        portfolio_account_id=account.id,
                        currency="USD",
                        amount=money_value,
                        amount_base=money_value,
                    ),
                ])
                session.commit()
                account_id = int(account.id)
                trade_id = int(trade.id)
                cash_entry_id = int(cash_entry.id)
                lot_id = int(session.query(PortfolioPositionLot.id).scalar())

            target_tables = tuple(exact_columns)
            with db._engine.connect() as connection:
                expected_rows = {
                    table_name: [
                        tuple(row)
                        for row in connection.exec_driver_sql(
                            f'SELECT * FROM "{table_name}" ORDER BY id'
                        )
                    ]
                    for table_name in target_tables
                }
                expected_explicit_indexes = {
                    table_name: DatabaseManager._sqlite_explicit_index_inventory(
                        connection,
                        table_name=table_name,
                    )
                    for table_name in target_tables
                }
                expected_unique_constraints = {
                    table_name: DatabaseManager._sqlite_unique_constraint_inventory(
                        connection,
                        table_name=table_name,
                    )
                    for table_name in target_tables
                }

            DatabaseManager.reset_instance()
            self._replace_portfolio_tables_with_legacy_float_schema(db_path, exact_columns)
            pre_broker_sync_db_path = os.path.join(directory, "pre-broker-sync-legacy.sqlite")
            partial_broker_sync_db_path = os.path.join(directory, "partial-broker-sync-legacy.sqlite")
            invalid_db_paths: dict[tuple[str, str], str] = {}
            source_connection = sqlite3.connect(db_path)
            try:
                pre_broker_sync_connection = sqlite3.connect(pre_broker_sync_db_path)
                try:
                    source_connection.backup(pre_broker_sync_connection)
                    for table_name in (
                        "portfolio_broker_sync_positions",
                        "portfolio_broker_sync_cash_balances",
                        "portfolio_broker_sync_states",
                        "portfolio_broker_connections",
                    ):
                        pre_broker_sync_connection.execute(f'DROP TABLE "{table_name}"')
                    pre_broker_sync_connection.commit()
                finally:
                    pre_broker_sync_connection.close()
                partial_broker_sync_connection = sqlite3.connect(partial_broker_sync_db_path)
                try:
                    source_connection.backup(partial_broker_sync_connection)
                    for table_name in (
                        "portfolio_broker_sync_positions",
                        "portfolio_broker_sync_cash_balances",
                        "portfolio_broker_sync_states",
                    ):
                        partial_broker_sync_connection.execute(f'DROP TABLE "{table_name}"')
                    partial_broker_sync_connection.commit()
                finally:
                    partial_broker_sync_connection.close()
                for table_name, column_name in invalid_money_cases:
                    invalid_db_path = os.path.join(
                        directory,
                        f"legacy-invalid-{table_name}-{column_name}.sqlite",
                    )
                    target_connection = sqlite3.connect(invalid_db_path)
                    try:
                        source_connection.backup(target_connection)
                        target_connection.execute(
                            f'UPDATE "{table_name}" SET "{column_name}" = ?',
                            (1.10000001,),
                        )
                        target_connection.commit()
                    finally:
                        target_connection.close()
                    invalid_db_paths[(table_name, column_name)] = invalid_db_path
            finally:
                source_connection.close()

            migrated = DatabaseManager(db_url=db_url)
            with migrated._engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall(),
                    [],
                )
                self.assertEqual(
                    connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one(),
                    1,
                )
                verify_sqlite_foreign_key_schema(connection, Base.metadata)
                for table_name, column_names in exact_columns.items():
                    column_types = {
                        row[1]: str(row[2]).upper()
                        for row in connection.exec_driver_sql(f'PRAGMA table_xinfo("{table_name}")')
                    }
                    self.assertEqual(
                        {column_types[column_name] for column_name in column_names},
                        {"TEXT"},
                        msg=f"{table_name} must be rebuilt to exact TEXT storage",
                    )
                    self.assertEqual(
                        [
                            tuple(row)
                            for row in connection.exec_driver_sql(
                                f'SELECT * FROM "{table_name}" ORDER BY id'
                            )
                        ],
                        expected_rows[table_name],
                        msg=f"{table_name} rows must survive the exact migration",
                    )
                    self.assertEqual(
                        DatabaseManager._sqlite_explicit_index_inventory(
                            connection,
                            table_name=table_name,
                        ),
                        expected_explicit_indexes[table_name],
                        msg=f"{table_name} explicit indexes must survive the exact migration",
                    )
                    self.assertEqual(
                        DatabaseManager._sqlite_unique_constraint_inventory(
                            connection,
                            table_name=table_name,
                        ),
                        expected_unique_constraints[table_name],
                        msg=f"{table_name} unique constraints must survive the exact migration",
                    )
                trade_row = connection.exec_driver_sql(
                    "SELECT quantity, price, fee, tax FROM portfolio_trades WHERE id = :id",
                    {"id": trade_id},
                ).one()
                lot_row = connection.exec_driver_sql(
                    "SELECT source_trade_id, remaining_quantity, unit_cost FROM portfolio_position_lots WHERE id = :id",
                    {"id": lot_id},
                ).one()
                fx_row = connection.exec_driver_sql(
                    "SELECT rate, typeof(rate) FROM portfolio_fx_rates WHERE from_currency = 'EUR'"
                ).one()

            self.assertEqual(
                trade_row,
                (exact_storage, exact_storage, money_storage, money_storage),
            )
            self.assertEqual(lot_row, (trade_id, exact_storage, exact_storage))
            self.assertEqual(fx_row, (exact_storage, "text"))
            from src.services.portfolio_service import PortfolioService

            with migrated.get_session() as session:
                migrated_trade = session.get(PortfolioTrade, trade_id)
                migrated_cash_entry = session.get(PortfolioCashLedger, cash_entry_id)
                self.assertEqual(
                    PortfolioService._trade_row_to_dict(migrated_trade)["fee"],
                    "1.10",
                )
                self.assertEqual(
                    PortfolioService._cash_ledger_row_to_dict(migrated_cash_entry)["amount"],
                    "1.10",
                )
            migrated_service = PortfolioService(
                repo=PortfolioRepository(migrated),
                owner_id="legacy-owner",
            )
            migrated_sync_state = migrated_service.get_latest_broker_sync_state(
                portfolio_account_id=account_id,
            )
            self.assertIsNotNone(migrated_sync_state)
            assert migrated_sync_state is not None
            self.assertEqual(migrated_sync_state["total_cash"], "1.10")
            self.assertEqual(migrated_sync_state["positions"][0]["quantity"], exact_storage)
            self.assertEqual(migrated_sync_state["positions"][0]["market_value_base"], "1.10")
            self.assertEqual(migrated_sync_state["cash_balances"][0]["amount"], "1.10")
            self.assertEqual(migrated_sync_state["cash_balances"][0]["amount_base"], "1.10")
            DatabaseManager.reset_instance()
            reopened = DatabaseManager(db_url=db_url)
            with reopened._engine.connect() as connection:
                for table_name in target_tables:
                    self.assertEqual(
                        [
                            tuple(row)
                            for row in connection.exec_driver_sql(
                                f'SELECT * FROM "{table_name}" ORDER BY id'
                            )
                        ],
                        expected_rows[table_name],
                        msg=f"{table_name} must remain unchanged on the second startup",
                    )

            DatabaseManager.reset_instance()
            for (table_name, column_name), invalid_db_path in invalid_db_paths.items():
                with self.subTest(table=table_name, column=column_name):
                    invalid_db_url = f"sqlite:///{invalid_db_path}"
                    try:
                        with self.assertRaisesRegex(
                            RuntimeError,
                            rf"{re.escape(table_name)}\.{re.escape(column_name)} id=1",
                        ):
                            DatabaseManager(db_url=invalid_db_url)
                    finally:
                        DatabaseManager.reset_instance()

                    connection = sqlite3.connect(invalid_db_path)
                    try:
                        self.assertEqual(
                            connection.execute(
                                f'SELECT "{column_name}" FROM "{table_name}" WHERE id = 1'
                            ).fetchone(),
                            (1.10000001,),
                        )
                        self.assertEqual(
                            {
                                row[2].upper()
                                for row in connection.execute(
                                    f'PRAGMA table_xinfo("{table_name}")'
                                )
                                if row[1] in exact_columns[table_name]
                            },
                            {"FLOAT"},
                        )
                        self.assertEqual(
                            connection.execute(
                                "SELECT name FROM sqlite_schema WHERE type = 'table' "
                                "AND name LIKE '%__wolfy_precision_old'"
                            ).fetchall(),
                            [],
                        )
                    finally:
                        connection.close()

            DatabaseManager.reset_instance()
            pre_broker_sync = DatabaseManager(db_url=f"sqlite:///{pre_broker_sync_db_path}")
            with pre_broker_sync._engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall(),
                    [],
                )
                verify_sqlite_foreign_key_schema(connection, Base.metadata)
                for table_name, column_names in exact_columns.items():
                    column_types = {
                        row[1]: str(row[2]).upper()
                        for row in connection.exec_driver_sql(f'PRAGMA table_xinfo("{table_name}")')
                    }
                    self.assertEqual(
                        {column_types[column_name] for column_name in column_names},
                        {"TEXT"},
                        msg=f"{table_name} must use canonical TEXT storage after pre-broker-sync upgrade",
                    )
                    if table_name.startswith("portfolio_broker_sync_"):
                        self.assertEqual(
                            connection.exec_driver_sql(
                                f'SELECT COUNT(*) FROM "{table_name}"'
                            ).scalar_one(),
                            0,
                            msg=f"{table_name} must be created empty during pre-broker-sync upgrade",
                        )
                    else:
                        self.assertEqual(
                            [
                                tuple(row)
                                for row in connection.exec_driver_sql(
                                    f'SELECT * FROM "{table_name}" ORDER BY id'
                                )
                            ],
                            expected_rows[table_name],
                            msg=f"{table_name} rows must survive the pre-broker-sync upgrade",
                        )
            DatabaseManager.reset_instance()

            with self.assertRaisesRegex(
                RuntimeError,
                "SQLite exact-numeric migration refuses partial broker-sync schema",
            ):
                DatabaseManager(db_url=f"sqlite:///{partial_broker_sync_db_path}")
            DatabaseManager.reset_instance()
            partial_broker_sync_connection = sqlite3.connect(partial_broker_sync_db_path)
            try:
                self.assertIsNotNone(
                    partial_broker_sync_connection.execute(
                        "SELECT 1 FROM sqlite_schema WHERE type = 'table' "
                        "AND name = 'portfolio_broker_connections'"
                    ).fetchone()
                )
                self.assertEqual(
                    partial_broker_sync_connection.execute(
                        "SELECT name FROM sqlite_schema WHERE type = 'table' "
                        "AND name LIKE 'portfolio_broker_sync_%'"
                    ).fetchall(),
                    [],
                )
                self.assertEqual(
                    partial_broker_sync_connection.execute(
                        "SELECT name FROM sqlite_schema WHERE type = 'table' "
                        "AND name LIKE '%__wolfy_precision_old'"
                    ).fetchall(),
                    [],
                )
            finally:
                partial_broker_sync_connection.close()

    def test_portfolio_position_price_cost_migration_keeps_legacy_rows_unavailable(self):
        self.addCleanup(DatabaseManager.reset_instance)
        exact_value = Decimal("12.34000000")
        expected_storage = format(exact_value, "f")

        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "legacy-price-cost.sqlite")
            db_url = f"sqlite:///{db_path}"
            DatabaseManager.reset_instance()
            db = DatabaseManager(db_url=db_url)
            with db.get_session() as session:
                session.add(AppUser(id="price-cost-owner", username="price-cost-owner", role="user", is_active=True))
                session.flush()
                account = PortfolioAccount(
                    owner_id="price-cost-owner",
                    name="Legacy price cost",
                    broker="Demo",
                    market="us",
                    base_currency="USD",
                )
                session.add(account)
                session.flush()
                session.add(
                    PortfolioPosition(
                        account_id=account.id,
                        cost_method="fifo",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        quantity=exact_value,
                        avg_cost=exact_value,
                        total_cost=exact_value,
                        last_price=exact_value,
                        market_value_base=exact_value,
                        unrealized_pnl_base=exact_value,
                        valuation_currency="USD",
                        price_cost=exact_value,
                    )
                )
                session.commit()
                account_id = int(account.id)

            DatabaseManager.reset_instance()
            connection = sqlite3.connect(db_path)
            try:
                connection.execute('ALTER TABLE "portfolio_positions" DROP COLUMN "price_cost"')
                connection.commit()
            finally:
                connection.close()

            migrated = DatabaseManager(db_url=db_url)
            with migrated._engine.connect() as connection:
                column_types = {
                    str(row[1]): str(row[2]).upper()
                    for row in connection.exec_driver_sql('PRAGMA table_xinfo("portfolio_positions")')
                }
                row = connection.exec_driver_sql(
                    "SELECT total_cost, price_cost, typeof(price_cost) "
                    "FROM portfolio_positions WHERE account_id = :account_id",
                    {"account_id": account_id},
                ).one()

            self.assertEqual(column_types["price_cost"], "TEXT")
            self.assertEqual(row, (expected_storage, None, "null"))

            DatabaseManager.reset_instance()
            reopened = DatabaseManager(db_url=db_url)
            with reopened._engine.connect() as connection:
                self.assertEqual(
                    connection.exec_driver_sql(
                        "SELECT total_cost, price_cost, typeof(price_cost) "
                        "FROM portfolio_positions WHERE account_id = :account_id",
                        {"account_id": account_id},
                    ).one(),
                    (expected_storage, None, "null"),
                )

    def test_portfolio_authoritative_sqlite_storage_representation(self):
        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")

        with db.get_session() as session:
            session.add(
                AppUser(
                    id="bootstrap-admin",
                    username="bootstrap-admin",
                    role="admin",
                    is_active=True,
                )
            )
            session.flush()
            account = PortfolioAccount(
                name="ExactMoney",
                broker="Demo",
                market="us",
                base_currency="USD",
            )
            session.add(account)
            session.flush()

            session.add(
                PortfolioPosition(
                    account_id=account.id,
                    cost_method="fifo",
                    symbol="AAPL",
                    market="us",
                    currency="USD",
                    quantity=Decimal("1.10000001"),
                    avg_cost=Decimal("2.20000002"),
                    total_cost=Decimal("2.42000003"),
                    last_price=Decimal("7.70000007"),
                    market_value_base=Decimal("1000.10000001"),
                    unrealized_pnl_base=Decimal("997.68000098"),
                    valuation_currency="USD",
                    price_cost=Decimal("2.42000003"),
                )
            )
            session.add(
                PortfolioDailySnapshot(
                    account_id=account.id,
                    snapshot_date=date(2026, 2, 4),
                    cost_method="fifo",
                    base_currency="USD",
                    total_cash=Decimal("1000.10000001"),
                    total_market_value=Decimal("2000.20000002"),
                    total_equity=Decimal("3000.30000003"),
                    unrealized_pnl=Decimal("4000.40000004"),
                    realized_pnl=Decimal("5000.50000005"),
                    fee_total=Decimal("6.60000006"),
                    tax_total=Decimal("7.70000007"),
                    fx_stale=False,
                    payload="{}",
                )
            )
            session.commit()

            position_row = session.execute(
                text(
                    """
                    SELECT typeof(quantity), typeof(total_cost), typeof(market_value_base), typeof(price_cost)
                    FROM portfolio_positions
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account.id},
            ).one()
            snapshot_row = session.execute(
                text(
                    """
                    SELECT typeof(total_cash), typeof(total_equity), typeof(realized_pnl)
                    FROM portfolio_daily_snapshots
                    WHERE account_id = :account_id
                      AND snapshot_date = :snapshot_date
                      AND cost_method = :cost_method
                    """
                ),
                {
                    "account_id": account.id,
                    "snapshot_date": date(2026, 2, 4),
                    "cost_method": "fifo",
                },
            ).one()

        self.assertTrue(
            all(cell_type != "real" for cell_type in position_row),
            msg=f"portfolio_positions authoritative cells must not persist as SQLite REAL: {position_row!r}",
        )
        self.assertTrue(
            all(cell_type != "real" for cell_type in snapshot_row),
            msg=f"portfolio_daily_snapshots authoritative cells must not persist as SQLite REAL: {snapshot_row!r}",
        )

        DatabaseManager.reset_instance()

    def test_portfolio_repository_preserves_exact_decimal_authority(self):
        DatabaseManager.reset_instance()
        self.addCleanup(DatabaseManager.reset_instance)
        db = DatabaseManager(db_url="sqlite:///:memory:")
        exact_value = Decimal("1234567890123456.12345678")
        exact_money = Decimal("1234567890123456.12")
        expected_storage = format(exact_value, "f")
        expected_money_storage = format(exact_money.quantize(Decimal("0.00000001")), "f")

        with db.get_session() as session:
            session.add(
                AppUser(
                    id="bootstrap-admin",
                    username="bootstrap-admin",
                    role="admin",
                    is_active=True,
                )
            )
            session.flush()
            account = PortfolioAccount(
                name="ExactRepository",
                broker="Demo",
                market="us",
                base_currency="USD",
            )
            session.add(account)
            session.flush()
            connection = PortfolioBrokerConnection(
                owner_id="bootstrap-admin",
                portfolio_account_id=int(account.id),
                broker_type="demo",
                connection_name="ExactRepositorySync",
                broker_account_ref="exact-repository-sync",
                import_mode="api",
                status="active",
            )
            session.add(connection)
            session.commit()
            account_id = int(account.id)
            connection_id = int(connection.id)

        repository = PortfolioRepository(db_manager=db)
        repository.replace_positions_lots_and_snapshot(
            account_id=account_id,
            snapshot_date=date(2026, 2, 5),
            cost_method="fifo",
            base_currency="USD",
            total_cash=exact_value,
            total_market_value=exact_value,
            total_equity=exact_value,
            unrealized_pnl=exact_value,
            realized_pnl=exact_value,
            fee_total=exact_value,
            tax_total=exact_value,
            fx_stale=False,
            payload="{}",
            positions=[
                {
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": exact_value,
                    "avg_cost": exact_value,
                    "total_cost": exact_value,
                    "price_cost": exact_value,
                    "last_price": exact_value,
                    "market_value_base": exact_value,
                    "unrealized_pnl_base": exact_value,
                }
            ],
            lots=[
                {
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "open_date": date(2026, 2, 5),
                    "remaining_quantity": exact_value,
                    "unit_cost": exact_value,
                }
            ],
            valuation_currency="USD",
        )

        with db.get_session() as session:
            position_row = session.execute(
                text(
                    """
                    SELECT quantity, avg_cost, total_cost, price_cost, last_price,
                           market_value_base, unrealized_pnl_base
                    FROM portfolio_positions
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()
            lot_row = session.execute(
                text(
                    """
                    SELECT remaining_quantity, unit_cost
                    FROM portfolio_position_lots
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()
            snapshot_row = session.execute(
                text(
                    """
                    SELECT total_cash, total_market_value, total_equity,
                           unrealized_pnl, realized_pnl, fee_total, tax_total
                    FROM portfolio_daily_snapshots
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()

        self.assertEqual(position_row, (expected_storage,) * 7)
        self.assertEqual(lot_row, (expected_storage,) * 2)
        self.assertEqual(snapshot_row, (expected_storage,) * 7)

        repository.replace_broker_sync_state(
            broker_connection_id=connection_id,
            portfolio_account_id=account_id,
            broker_type="demo",
            broker_account_ref="exact-repository-sync",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 2, 5),
            synced_at=datetime(2026, 2, 5, 12, 0, 0),
            base_currency="USD",
            total_cash=exact_money,
            total_market_value=exact_money,
            total_equity=exact_money,
            realized_pnl=exact_money,
            unrealized_pnl=exact_money,
            fx_stale=False,
            payload_json="{}",
            positions=[
                {
                    "broker_position_ref": "exact-aapl",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": exact_value,
                    "avg_cost": exact_value,
                    "last_price": exact_value,
                    "market_value_base": exact_money,
                    "unrealized_pnl_base": exact_money,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[
                {
                    "currency": "USD",
                    "amount": exact_money,
                    "amount_base": exact_money,
                }
            ],
        )

        with db.get_session() as session:
            sync_position_row = session.execute(
                text(
                    """
                    SELECT quantity, avg_cost, last_price,
                           market_value_base, unrealized_pnl_base
                    FROM portfolio_broker_sync_positions
                    WHERE broker_connection_id = :connection_id
                    """
                ),
                {"connection_id": connection_id},
            ).one()
            sync_cash_row = session.execute(
                text(
                    """
                    SELECT amount, amount_base
                    FROM portfolio_broker_sync_cash_balances
                    WHERE broker_connection_id = :connection_id
                    """
                ),
                {"connection_id": connection_id},
            ).one()

        self.assertEqual(
            sync_position_row,
            (expected_storage, expected_storage, expected_storage, expected_money_storage, expected_money_storage),
        )
        self.assertEqual(sync_cash_row, (expected_money_storage,) * 2)

        fx_rate = Decimal("0.12345678")
        repository.save_fx_rate(
            from_currency="USD",
            to_currency="EUR",
            rate_date=date(2026, 2, 5),
            rate=fx_rate,
        )
        with db.get_session() as session:
            fx_row = session.execute(
                text(
                    """
                    SELECT rate FROM portfolio_fx_rates
                    WHERE from_currency = 'USD' AND to_currency = 'EUR'
                    """
                )
            ).one()

        cache_position = {
            "symbol": "AAPL",
            "market": "us",
            "currency": "USD",
            "quantity": exact_value,
            "avg_cost": exact_value,
            "total_cost": exact_value,
            "price_cost": exact_value,
            "last_price": exact_value,
            "market_value_base": exact_value,
            "unrealized_pnl_base": exact_value,
        }
        cache_lot = {
            "symbol": "AAPL",
            "market": "us",
            "currency": "USD",
            "open_date": date(2026, 2, 5),
            "remaining_quantity": exact_value,
            "unit_cost": exact_value,
        }
        snapshot_kwargs = {
            "account_id": account_id,
            "snapshot_date": date(2026, 2, 5),
            "cost_method": "fifo",
            "base_currency": "USD",
            "total_cash": exact_value,
            "total_market_value": exact_value,
            "total_equity": exact_value,
            "unrealized_pnl": exact_value,
            "realized_pnl": exact_value,
            "fee_total": exact_value,
            "tax_total": exact_value,
            "fx_stale": False,
            "payload": "{}",
        }
        broker_sync_kwargs = {
            "broker_connection_id": connection_id,
            "portfolio_account_id": account_id,
            "broker_type": "demo",
            "broker_account_ref": "exact-repository-sync",
            "sync_source": "api",
            "sync_status": "success",
            "snapshot_date": date(2026, 2, 5),
            "synced_at": datetime(2026, 2, 5, 12, 0, 0),
            "base_currency": "USD",
            "total_cash": exact_money,
            "total_market_value": exact_money,
            "total_equity": exact_money,
            "realized_pnl": exact_money,
            "unrealized_pnl": exact_money,
            "fx_stale": False,
            "payload_json": "{}",
            "owner_id": "bootstrap-admin",
        }
        broker_position = {
            "broker_position_ref": "exact-aapl",
            "symbol": "AAPL",
            "market": "us",
            "currency": "USD",
            "quantity": exact_value,
            "avg_cost": exact_value,
            "last_price": exact_value,
            "market_value_base": exact_money,
            "unrealized_pnl_base": exact_money,
            "valuation_currency": "USD",
        }
        broker_cash = {
            "currency": "USD",
            "amount": exact_money,
            "amount_base": exact_money,
        }

        repository.replace_positions_lots_and_snapshot(
            **snapshot_kwargs,
            positions=[cache_position],
            lots=[cache_lot],
            valuation_currency="USD",
        )
        with db.get_session() as session:
            position_row = session.execute(
                text(
                    """
                    SELECT quantity, avg_cost, total_cost, price_cost, last_price,
                           market_value_base, unrealized_pnl_base
                    FROM portfolio_positions
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()
            lot_row = session.execute(
                text(
                    """
                    SELECT remaining_quantity, unit_cost
                    FROM portfolio_position_lots
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()
            snapshot_row = session.execute(
                text(
                    """
                    SELECT total_cash, total_market_value, total_equity,
                           unrealized_pnl, realized_pnl, fee_total, tax_total
                    FROM portfolio_daily_snapshots
                    WHERE account_id = :account_id
                    """
                ),
                {"account_id": account_id},
            ).one()

        def assert_no_session_for_invalid_input(call):
            with patch.object(db, "get_session", side_effect=AssertionError("session opened")):
                with self.assertRaises(PortfolioExactNumericError):
                    call()

        assert_no_session_for_invalid_input(
            lambda: repository.replace_positions_and_lots(
                account_id=account_id,
                cost_method="fifo",
                positions=iter([cache_position, {**cache_position, "quantity": 1.0}]),
                lots=iter([cache_lot]),
                valuation_currency="USD",
            )
        )
        assert_no_session_for_invalid_input(
            lambda: repository.upsert_daily_snapshot(
                **{**snapshot_kwargs, "total_cash": 1.0}
            )
        )
        assert_no_session_for_invalid_input(
            lambda: repository.replace_positions_lots_and_snapshot(
                **snapshot_kwargs,
                positions=iter([cache_position]),
                lots=iter([cache_lot, {**cache_lot, "unit_cost": 1.0}]),
                valuation_currency="USD",
            )
        )
        assert_no_session_for_invalid_input(
            lambda: repository.save_fx_rate(
                from_currency="USD",
                to_currency="EUR",
                rate_date=date(2026, 2, 5),
                rate=1.0,
            )
        )
        assert_no_session_for_invalid_input(
            lambda: repository.replace_broker_sync_state(
                **broker_sync_kwargs,
                positions=iter([broker_position, {**broker_position, "quantity": 1.0}]),
                cash_balances=iter([broker_cash]),
            )
        )
        assert_no_session_for_invalid_input(
            lambda: repository.replace_broker_sync_state(
                **broker_sync_kwargs,
                positions=iter([broker_position]),
                cash_balances=iter([broker_cash, {**broker_cash, "amount": 1.0}]),
            )
        )

        with db.get_session() as session:
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT quantity, avg_cost, total_cost, price_cost, last_price,
                               market_value_base, unrealized_pnl_base
                        FROM portfolio_positions
                        WHERE account_id = :account_id
                        """
                    ),
                    {"account_id": account_id},
                ).one(),
                position_row,
            )
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT remaining_quantity, unit_cost
                        FROM portfolio_position_lots
                        WHERE account_id = :account_id
                        """
                    ),
                    {"account_id": account_id},
                ).one(),
                lot_row,
            )
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT total_cash, total_market_value, total_equity,
                               unrealized_pnl, realized_pnl, fee_total, tax_total
                        FROM portfolio_daily_snapshots
                        WHERE account_id = :account_id
                        """
                    ),
                    {"account_id": account_id},
                ).one(),
                snapshot_row,
            )
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT quantity, avg_cost, last_price,
                               market_value_base, unrealized_pnl_base
                        FROM portfolio_broker_sync_positions
                        WHERE broker_connection_id = :connection_id
                        """
                    ),
                    {"connection_id": connection_id},
                ).one(),
                sync_position_row,
            )
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT amount, amount_base
                        FROM portfolio_broker_sync_cash_balances
                        WHERE broker_connection_id = :connection_id
                        """
                    ),
                    {"connection_id": connection_id},
                ).one(),
                sync_cash_row,
            )
            self.assertEqual(
                session.execute(
                    text(
                        """
                        SELECT rate FROM portfolio_fx_rates
                        WHERE from_currency = 'USD' AND to_currency = 'EUR'
                        """
                    )
                ).one(),
                fx_row,
            )

    def test_revoke_all_app_user_sessions_counts_distinct_phase_a_and_legacy_sessions(self):
        class _FakePhaseAStore:
            def __init__(self) -> None:
                self._user = SimpleNamespace(id="user-1")
                self.revoked_user_ids = []

            def get_app_user(self, user_id: str):
                if user_id == "user-1":
                    return self._user
                return None

            def list_active_app_user_session_ids(self, user_id: str) -> list[str]:
                if user_id == "user-1":
                    return ["phase-a-session"]
                return []

            def get_app_user_session(self, session_id: str):
                return None

            def revoke_all_app_user_sessions(self, user_id: str) -> int:
                self.revoked_user_ids.append(user_id)
                return 1

        DatabaseManager.reset_instance()
        db = DatabaseManager(db_url="sqlite:///:memory:")
        db.create_or_update_app_user(
            user_id="user-1",
            username="user-1",
            display_name="User 1",
            role="user",
            password_hash=None,
            is_active=True,
        )
        db.create_app_user_session(
            session_id="legacy-session",
            user_id="user-1",
            expires_at=datetime.now() + timedelta(hours=1),
        )

        db._phase_a_enabled = True
        db._phase_a_store = _FakePhaseAStore()

        revoked = db.revoke_all_app_user_sessions("user-1")

        self.assertEqual(revoked, 2)
        self.assertEqual(db._phase_a_store.revoked_user_ids, ["user-1"])
        with db.get_session() as session:
            legacy_row = (
                session.query(AppUserSession)
                .filter(AppUserSession.session_id == "legacy-session")
                .first()
            )
        self.assertIsNotNone(legacy_row)
        self.assertIsNotNone(legacy_row.revoked_at)

        DatabaseManager.reset_instance()

if __name__ == '__main__':
    unittest.main()
