# -*- coding: utf-8 -*-
"""Focused coverage for the PostgreSQL Phase F portfolio baseline."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlalchemy import delete, select

try:
    import litellm  # noqa: F401
except ModuleNotFoundError:
    sys.modules["litellm"] = MagicMock()

import src.auth as auth
from src.config import Config
from src.postgres_phase_f import (
    PhaseFBrokerConnection,
    PhaseFPortfolioAccount,
    PhaseFPortfolioLedger,
    PhaseFPortfolioPosition,
    PhaseFPortfolioSyncCashBalance,
    PhaseFPortfolioSyncPosition,
    PhaseFPortfolioSyncState,
)
from src.services.portfolio_service import PortfolioService
from src.storage import (
    DatabaseManager,
    PortfolioAccount,
    PortfolioBrokerConnection,
    PortfolioBrokerSyncState,
    PortfolioTrade,
)


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


class PostgresPhaseFStorageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.env_path = self.data_dir / ".env"
        self.sqlite_db_path = self.data_dir / "legacy.sqlite"
        self.phase_db_path = self.data_dir / "phase-baseline.sqlite"
        self._configure_environment(enable_phase_f=True)

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        os.environ.pop("POSTGRES_PHASE_A_URL", None)
        os.environ.pop("POSTGRES_PHASE_A_APPLY_SCHEMA", None)
        self.temp_dir.cleanup()

    def _configure_environment(self, *, enable_phase_f: bool) -> None:
        lines = [
            "STOCK_LIST=600519",
            "GEMINI_API_KEY=test",
            "ADMIN_AUTH_ENABLED=true",
            f"DATABASE_PATH={self.sqlite_db_path}",
        ]
        if enable_phase_f:
            lines.extend(
                [
                    f"POSTGRES_PHASE_A_URL=sqlite:///{self.phase_db_path}",
                    "POSTGRES_PHASE_A_APPLY_SCHEMA=true",
                ]
            )

        self.env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.sqlite_db_path)
        if enable_phase_f:
            os.environ["POSTGRES_PHASE_A_URL"] = f"sqlite:///{self.phase_db_path}"
            os.environ["POSTGRES_PHASE_A_APPLY_SCHEMA"] = "true"
        else:
            os.environ.pop("POSTGRES_PHASE_A_URL", None)
            os.environ.pop("POSTGRES_PHASE_A_APPLY_SCHEMA", None)

        Config.reset_instance()
        DatabaseManager.reset_instance()
        auth.refresh_auth_state()

    def _db(self) -> DatabaseManager:
        return DatabaseManager.get_instance()

    def test_phase_f_dual_writes_accounts_connections_and_sync_overlay_without_changing_current_reads(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="phase-f-user", username="phase-f-user")
        service = PortfolioService(owner_id="phase-f-user")

        account = service.create_account(
            name="Global",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Primary IBKR",
            broker_account_ref="U1234567",
            import_mode="file",
            sync_metadata={"source": "flex"},
        )

        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="U1234567",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 16),
            synced_at=datetime(2026, 4, 16, 8, 30, 0),
            base_currency="USD",
            total_cash=1000.0,
            total_market_value=2500.0,
            total_equity=3500.0,
            realized_pnl=25.0,
            unrealized_pnl=75.0,
            fx_stale=False,
            payload={"snapshot": "initial"},
            positions=[
                {
                    "broker_position_ref": "AAPL-1",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 10.0,
                    "avg_cost": 150.0,
                    "last_price": 160.0,
                    "market_value_base": 1600.0,
                    "unrealized_pnl_base": 100.0,
                    "valuation_currency": "USD",
                    "payload_json": '{"source":"ibkr"}',
                },
                {
                    "broker_position_ref": "MSFT-1",
                    "symbol": "MSFT",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 5.0,
                    "avg_cost": 180.0,
                    "last_price": 190.0,
                    "market_value_base": 950.0,
                    "unrealized_pnl_base": 50.0,
                    "valuation_currency": "USD",
                    "payload_json": '{"source":"ibkr"}',
                },
            ],
            cash_balances=[
                {"currency": "USD", "amount": 800.0, "amount_base": 800.0},
                {"currency": "HKD", "amount": 1560.0, "amount_base": 200.0},
            ],
        )

        current_accounts = service.list_accounts()
        current_connections = service.list_broker_connections(portfolio_account_id=account["id"])
        current_sync_state = service.get_latest_broker_sync_state(portfolio_account_id=account["id"])

        self.assertEqual([item["name"] for item in current_accounts], ["Global"])
        self.assertEqual([item["broker_account_ref"] for item in current_connections], ["U1234567"])
        self.assertEqual([item["symbol"] for item in current_sync_state["positions"]], ["AAPL", "MSFT"])
        self.assertEqual([item["currency"] for item in current_sync_state["cash_balances"]], ["HKD", "USD"])

        with db._phase_f_store.session_scope() as session:
            pg_account = session.query(PhaseFPortfolioAccount).filter(PhaseFPortfolioAccount.id == account["id"]).one()
            pg_connection = session.query(PhaseFBrokerConnection).filter(PhaseFBrokerConnection.id == connection["id"]).one()
            pg_sync_state = (
                session.query(PhaseFPortfolioSyncState)
                .filter(PhaseFPortfolioSyncState.broker_connection_id == connection["id"])
                .one()
            )
            pg_sync_positions = (
                session.query(PhaseFPortfolioSyncPosition)
                .filter(PhaseFPortfolioSyncPosition.portfolio_sync_state_id == pg_sync_state.id)
                .order_by(PhaseFPortfolioSyncPosition.canonical_symbol.asc())
                .all()
            )
            pg_cash_balances = (
                session.query(PhaseFPortfolioSyncCashBalance)
                .filter(PhaseFPortfolioSyncCashBalance.portfolio_sync_state_id == pg_sync_state.id)
                .order_by(PhaseFPortfolioSyncCashBalance.currency.asc())
                .all()
            )

        self.assertEqual(pg_account.owner_user_id, "phase-f-user")
        self.assertEqual(pg_account.broker_label, "IBKR")
        self.assertEqual(pg_connection.owner_user_id, "phase-f-user")
        self.assertEqual(pg_connection.portfolio_account_id, account["id"])
        self.assertEqual(pg_connection.sync_metadata["source"], "flex")
        self.assertEqual(pg_sync_state.owner_user_id, "phase-f-user")
        self.assertEqual(pg_sync_state.payload_json["snapshot"], "initial")
        self.assertEqual([row.canonical_symbol for row in pg_sync_positions], ["AAPL", "MSFT"])
        self.assertEqual([row.currency for row in pg_cash_balances], ["HKD", "USD"])
        self.assertEqual(float(pg_cash_balances[0].amount_base), 200.0)

    def test_phase_f_dual_writes_ledger_and_replayed_positions_while_preserving_owner_isolation(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="portfolio-user-a", username="portfolio-user-a")
        db.create_or_update_app_user(user_id="portfolio-user-b", username="portfolio-user-b")
        service_a = PortfolioService(owner_id="portfolio-user-a")
        service_b = PortfolioService(owner_id="portfolio-user-b")

        account_a = service_a.create_account(name="Alice", broker="Demo", market="us", base_currency="USD")
        account_b = service_b.create_account(name="Bob", broker="Demo", market="us", base_currency="USD")

        service_a.record_cash_ledger(
            account_id=account_a["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service_a.record_trade(
            account_id=account_a["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="alice-buy-1",
            dedup_hash="alice-dedup-1",
        )
        service_a.record_corporate_action(
            account_id=account_a["id"],
            symbol="AAPL",
            effective_date=date(2026, 4, 12),
            action_type="cash_dividend",
            market="us",
            currency="USD",
            cash_dividend_per_share=0.2,
        )

        service_b.record_cash_ledger(
            account_id=account_b["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=3000.0,
            currency="USD",
        )

        db.save_daily_data(
            __import__("pandas").DataFrame(
                [
                    {
                        "date": date(2026, 4, 12),
                        "open": 160.0,
                        "high": 160.0,
                        "low": 160.0,
                        "close": 160.0,
                        "volume": 1.0,
                        "amount": 160.0,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code="AAPL",
            data_source="unit-test",
        )
        snapshot = service_a.get_portfolio_snapshot(
            account_id=account_a["id"],
            as_of=date(2026, 4, 12),
            cost_method="fifo",
        )

        self.assertEqual(snapshot["accounts"][0]["positions"][0]["symbol"], "AAPL")

        with db._phase_f_store.session_scope() as session:
            pg_ledger_rows = (
                session.query(PhaseFPortfolioLedger)
                .filter(PhaseFPortfolioLedger.portfolio_account_id == account_a["id"])
                .order_by(PhaseFPortfolioLedger.event_time.asc(), PhaseFPortfolioLedger.id.asc())
                .all()
            )
            pg_positions = (
                session.query(PhaseFPortfolioPosition)
                .filter(PhaseFPortfolioPosition.portfolio_account_id == account_a["id"])
                .order_by(PhaseFPortfolioPosition.canonical_symbol.asc())
                .all()
            )
            pg_other_owner_ledger = (
                session.query(PhaseFPortfolioLedger)
                .filter(PhaseFPortfolioLedger.portfolio_account_id == account_b["id"])
                .all()
            )

        self.assertEqual([row.entry_type for row in pg_ledger_rows], ["cash", "trade", "corporate_action"])
        self.assertEqual(pg_ledger_rows[1].owner_user_id, "portfolio-user-a")
        self.assertEqual(pg_ledger_rows[1].external_ref, "alice-buy-1")
        self.assertEqual(pg_ledger_rows[1].dedup_hash, "alice-dedup-1")
        self.assertEqual(pg_ledger_rows[1].payload_json["side"], "buy")
        self.assertEqual(len(pg_positions), 1)
        self.assertEqual(pg_positions[0].owner_user_id, "portfolio-user-a")
        self.assertEqual(pg_positions[0].source_kind, "replayed_ledger")
        self.assertEqual(pg_positions[0].canonical_symbol, "AAPL")
        self.assertAlmostEqual(float(pg_positions[0].quantity), 10.0, places=6)
        self.assertEqual(len(pg_other_owner_ledger), 1)
        self.assertEqual(pg_other_owner_ledger[0].owner_user_id, "portfolio-user-b")

    def test_phase_f_shadow_resync_tracks_delete_paths_and_overlay_replacement(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="cleanup-user", username="cleanup-user")
        service = PortfolioService(owner_id="cleanup-user")

        account = service.create_account(name="Cleanup", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Cleanup IBKR",
            broker_account_ref="U7654321",
            import_mode="file",
        )
        trade = service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 10),
            side="buy",
            quantity=10.0,
            price=150.0,
            market="us",
            currency="USD",
            trade_uid="cleanup-trade-1",
            dedup_hash="cleanup-trade-1",
        )

        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="U7654321",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 16),
            synced_at=datetime(2026, 4, 16, 9, 0, 0),
            base_currency="USD",
            total_cash=500.0,
            total_market_value=1600.0,
            total_equity=2100.0,
            realized_pnl=0.0,
            unrealized_pnl=100.0,
            fx_stale=False,
            payload={"revision": 1},
            positions=[
                {
                    "broker_position_ref": "AAPL-1",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 10.0,
                    "avg_cost": 150.0,
                    "last_price": 160.0,
                    "market_value_base": 1600.0,
                    "unrealized_pnl_base": 100.0,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[{"currency": "USD", "amount": 500.0, "amount_base": 500.0}],
        )

        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="U7654321",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 17),
            synced_at=datetime(2026, 4, 17, 9, 0, 0),
            base_currency="USD",
            total_cash=650.0,
            total_market_value=0.0,
            total_equity=650.0,
            realized_pnl=50.0,
            unrealized_pnl=0.0,
            fx_stale=False,
            payload={"revision": 2},
            positions=[],
            cash_balances=[{"currency": "USD", "amount": 650.0, "amount_base": 650.0}],
        )
        deleted = service.delete_trade_event(trade["id"])

        self.assertTrue(deleted)
        self.assertEqual(service.list_trade_events(account_id=account["id"], page=1, page_size=20)["items"], [])

        with db._phase_f_store.session_scope() as session:
            pg_ledger_rows = (
                session.query(PhaseFPortfolioLedger)
                .filter(PhaseFPortfolioLedger.portfolio_account_id == account["id"])
                .all()
            )
            pg_sync_state = (
                session.query(PhaseFPortfolioSyncState)
                .filter(PhaseFPortfolioSyncState.broker_connection_id == connection["id"])
                .one()
            )
            pg_sync_positions = (
                session.query(PhaseFPortfolioSyncPosition)
                .filter(PhaseFPortfolioSyncPosition.portfolio_sync_state_id == pg_sync_state.id)
                .all()
            )
            pg_cash_balances = (
                session.query(PhaseFPortfolioSyncCashBalance)
                .filter(PhaseFPortfolioSyncCashBalance.portfolio_sync_state_id == pg_sync_state.id)
                .all()
            )

        self.assertEqual(len(pg_ledger_rows), 0)
        self.assertEqual(pg_sync_state.snapshot_date.isoformat(), "2026-04-17")
        self.assertEqual(pg_sync_state.payload_json["revision"], 2)
        self.assertEqual(pg_sync_positions, [])
        self.assertEqual(len(pg_cash_balances), 1)
        self.assertAlmostEqual(float(pg_cash_balances[0].amount), 650.0, places=6)

    def test_phase_f_shadow_bundle_preserves_replayed_positions_after_broker_sync_cache_invalidation(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="shadow-user", username="shadow-user")
        service = PortfolioService(owner_id="shadow-user")

        account = service.create_account(name="Shadow", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Shadow IBKR",
            broker_account_ref="U0001111",
            import_mode="file",
        )

        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="shadow-buy-1",
            dedup_hash="shadow-buy-1",
        )
        db.save_daily_data(
            __import__("pandas").DataFrame(
                [
                    {
                        "date": date(2026, 4, 12),
                        "open": 160.0,
                        "high": 160.0,
                        "low": 160.0,
                        "close": 160.0,
                        "volume": 1.0,
                        "amount": 160.0,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code="AAPL",
            data_source="unit-test",
        )

        service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date(2026, 4, 12),
            cost_method="fifo",
        )
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="U0001111",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 16),
            synced_at=datetime(2026, 4, 16, 9, 30, 0),
            base_currency="USD",
            total_cash=1000.0,
            total_market_value=1600.0,
            total_equity=2600.0,
            realized_pnl=0.0,
            unrealized_pnl=100.0,
            fx_stale=False,
            payload={"snapshot": "shadow"},
            positions=[
                {
                    "broker_position_ref": "AAPL-1",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 10.0,
                    "avg_cost": 150.0,
                    "last_price": 160.0,
                    "market_value_base": 1600.0,
                    "unrealized_pnl_base": 100.0,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[{"currency": "USD", "amount": 1000.0, "amount_base": 1000.0}],
        )

        shadow = db.get_phase_f_portfolio_shadow_bundle(account_id=account["id"])

        self.assertIsNotNone(shadow)
        self.assertEqual(shadow["account"]["id"], account["id"])
        self.assertEqual([item["entry_type"] for item in shadow["ledger"]], ["cash", "trade"])
        self.assertEqual([item["canonical_symbol"] for item in shadow["positions"]], ["AAPL"])
        self.assertEqual(shadow["positions"][0]["source_kind"], "replayed_ledger")
        self.assertAlmostEqual(float(shadow["positions"][0]["quantity"]), 10.0, places=6)
        self.assertEqual(shadow["sync_state"]["snapshot_date"], "2026-04-16")
        self.assertEqual([item["canonical_symbol"] for item in shadow["sync_positions"]], ["AAPL"])
        self.assertEqual([item["currency"] for item in shadow["sync_cash_balances"]], ["USD"])

    def test_phase_f_authority_state_exposes_broker_connection_and_sync_overlay_readiness(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="authority-user", username="authority-user")
        service = PortfolioService(owner_id="authority-user")

        account = service.create_account(name="Authority", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Authority IBKR",
            broker_account_ref="UAUTH0001",
            import_mode="api",
            sync_metadata={"source": "authority-test"},
        )
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="UAUTH0001",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 18),
            synced_at=datetime(2026, 4, 18, 10, 15, 0),
            base_currency="USD",
            total_cash=1200.0,
            total_market_value=800.0,
            total_equity=2000.0,
            realized_pnl=10.0,
            unrealized_pnl=20.0,
            fx_stale=False,
            payload={"slice": "authority"},
            positions=[
                {
                    "broker_position_ref": "AAPL-1",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 5.0,
                    "avg_cost": 150.0,
                    "last_price": 160.0,
                    "market_value_base": 800.0,
                    "unrealized_pnl_base": 50.0,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[{"currency": "USD", "amount": 1200.0, "amount_base": 1200.0}],
        )

        shadow = db.get_phase_f_portfolio_shadow_bundle(account_id=account["id"])
        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])

        self.assertIsNotNone(shadow)
        self.assertEqual([item["broker_account_ref"] for item in shadow["broker_connections"]], ["UAUTH0001"])
        self.assertIsNotNone(authority)
        self.assertEqual(authority["shadow_account_id"], account["id"])
        self.assertEqual(authority["legacy_row_counts"]["broker_connections"], 1)
        self.assertEqual(authority["shadow_row_counts"]["broker_connections"], 1)
        self.assertTrue(authority["observed_readiness"]["account_row"])
        self.assertTrue(authority["observed_readiness"]["broker_connections"])
        self.assertTrue(authority["observed_readiness"]["sync_state"])
        self.assertTrue(authority["effective_readiness"]["account_metadata"])
        self.assertTrue(authority["effective_readiness"]["broker_connection_list"])
        self.assertTrue(authority["effective_readiness"]["latest_sync_overlay"])
        self.assertEqual(authority["surface_trust"]["broker_connection_list"], "shadow_matches_legacy")
        self.assertEqual(authority["drift_reasons"], [])

    def test_phase_f_authority_state_flags_broker_connection_drift(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="authority-drift-user", username="authority-drift-user")
        service = PortfolioService(owner_id="authority-drift-user")

        account = service.create_account(name="Authority Drift", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Authority Drift IBKR",
            broker_account_ref="UDRIFT0001",
            import_mode="api",
        )
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="UDRIFT0001",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 18),
            synced_at=datetime(2026, 4, 18, 10, 45, 0),
            base_currency="USD",
            total_cash=1000.0,
            total_market_value=0.0,
            total_equity=1000.0,
            realized_pnl=0.0,
            unrealized_pnl=0.0,
            fx_stale=False,
            payload={"slice": "authority-drift"},
            positions=[],
            cash_balances=[{"currency": "USD", "amount": 1000.0, "amount_base": 1000.0}],
        )

        with db.get_session() as session:
            session.execute(
                delete(PortfolioBrokerConnection).where(
                    PortfolioBrokerConnection.id == connection["id"]
                )
            )
            session.commit()

        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority)
        self.assertEqual(authority["legacy_row_counts"]["broker_connections"], 0)
        self.assertEqual(authority["shadow_row_counts"]["broker_connections"], 1)
        self.assertFalse(authority["effective_readiness"]["broker_connection_list"])
        self.assertFalse(authority["effective_readiness"]["latest_sync_overlay"])
        self.assertEqual(authority["surface_trust"]["broker_connection_list"], "shadow_drift")
        self.assertIn("broker_connections_count_mismatch", authority["drift_reasons"])

    def test_phase_f_prerequisite_state_identifies_ledger_payload_as_highest_roi_gap(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-user", username="prereq-user")
        service = PortfolioService(owner_id="prereq-user")

        account = service.create_account(name="Prereq", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-trade-1",
            dedup_hash="phase-f-prereq-trade-1",
        )
        db.save_daily_data(
            __import__("pandas").DataFrame(
                [
                    {
                        "date": date(2026, 4, 12),
                        "open": 160.0,
                        "high": 160.0,
                        "low": 160.0,
                        "close": 160.0,
                        "volume": 1.0,
                        "amount": 160.0,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code="AAPL",
            data_source="unit-test",
        )
        service.get_portfolio_snapshot(account_id=account["id"], as_of=date(2026, 4, 12), cost_method="fifo")

        state = db.get_phase_f_portfolio_prerequisite_state(account_id=account["id"])
        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])
        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])
        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])
        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(state)
        self.assertIsNotNone(authority_state)
        self.assertIsNotNone(event_history_state)
        self.assertIsNotNone(replay_input_state)
        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(state["highest_roi_category"], "ledger_event_payload_parity")

        self.assertEqual(authority_state["current_signal"], "payload_parity_observed")
        self.assertTrue(authority_state["payload_parity_observed"])
        self.assertEqual(authority_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(authority_state["authority_ready"])
        self.assertFalse(authority_state["runtime_cutover_ready"])
        self.assertEqual(
            authority_state["future_authority_scope"],
            "event_history_and_replay_input_design",
        )
        self.assertEqual(authority_state["blocked_reasons"], [])
        self.assertIn("event_history_domain_authority_layer_required", authority_state["downstream_blockers"])
        self.assertIn("replay_as_of_subset_authority_missing", authority_state["downstream_blockers"])

        self.assertEqual(event_history_state["prerequisite_helper"], "get_phase_f_ledger_event_payload_authority_state")
        self.assertEqual(event_history_state["current_signal"], "prerequisite_ready")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(event_history_state["authority_ready"])
        self.assertFalse(event_history_state["runtime_cutover_ready"])
        self.assertEqual(event_history_state["blocked_reasons"], [])
        self.assertIn("replay_input_cost_method_specific_authority_missing", event_history_state["downstream_blockers"])
        self.assertIn("replay_input_lot_authority_missing", event_history_state["downstream_blockers"])
        self.assertIn("replay_input_as_of_boundary_missing", event_history_state["downstream_blockers"])
        self.assertIn("snapshot_cache_freshness_authority_missing", event_history_state["downstream_blockers"])
        self.assertIn("runtime_pg_event_history_read_cutover_not_enabled", event_history_state["downstream_blockers"])

        self.assertEqual(replay_input_state["prerequisite_helper"], "get_phase_f_event_history_authority_state")
        self.assertEqual(replay_input_state["current_signal"], "replay_specific_gaps_observed")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertFalse(replay_input_state["runtime_cutover_ready"])
        self.assertFalse(replay_input_state["replay_specific_readiness"]["cost_method_specific_authority"])
        self.assertFalse(replay_input_state["replay_specific_readiness"]["lot_authority"])
        self.assertFalse(replay_input_state["replay_specific_readiness"]["as_of_replay_boundary"])
        self.assertIn("cost_method_specific_authority_missing", replay_input_state["blocked_reasons"])
        self.assertIn("lot_authority_missing", replay_input_state["blocked_reasons"])
        self.assertIn("as_of_replay_boundary_missing", replay_input_state["blocked_reasons"])
        self.assertIn("snapshot_cache_freshness_authority_missing", replay_input_state["downstream_blockers"])
        self.assertIn("runtime_pg_replay_input_cutover_not_enabled", replay_input_state["downstream_blockers"])

        self.assertEqual(snapshot_cache_state["prerequisite_helper"], "get_phase_f_event_history_authority_state")
        self.assertEqual(snapshot_cache_state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertFalse(snapshot_cache_state["runtime_cutover_ready"])
        self.assertFalse(snapshot_cache_state["snapshot_specific_readiness"]["snapshot_projection_authority"])
        self.assertFalse(snapshot_cache_state["snapshot_specific_readiness"]["lot_projection_authority"])
        self.assertFalse(snapshot_cache_state["snapshot_specific_readiness"]["freshness_invalidation_authority"])
        self.assertFalse(snapshot_cache_state["snapshot_specific_readiness"]["valuation_semantic_authority"])
        self.assertIn("snapshot_projection_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("lot_projection_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("snapshot_freshness_invalidation_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("valuation_semantic_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("runtime_pg_snapshot_cache_cutover_not_enabled", snapshot_cache_state["downstream_blockers"])

        ledger_state = dict(state["categories"]["ledger_event_payload_parity"])
        self.assertEqual(ledger_state["current_signal"], "payload_parity_observed")
        self.assertTrue(ledger_state["payload_parity_observed"])
        self.assertEqual(ledger_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(ledger_state["authority_ready"])
        self.assertFalse(ledger_state["runtime_cutover_ready"])
        self.assertEqual(ledger_state["missing_signals"], [])
        self.assertIn("event_history_domain_authority_layer_required", ledger_state["downstream_blockers"])

        self.assertEqual(state["event_history_authority"]["current_signal"], "prerequisite_ready")
        self.assertEqual(state["event_history_authority"]["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(state["event_history_authority"]["authority_ready"])
        self.assertFalse(state["event_history_authority"]["runtime_cutover_ready"])
        self.assertEqual(state["replay_input_authority"]["current_signal"], "replay_specific_gaps_observed")
        self.assertEqual(state["replay_input_authority"]["authority_prerequisite_state"], "observed_only")
        self.assertFalse(state["replay_input_authority"]["authority_ready"])
        self.assertFalse(state["replay_input_authority"]["runtime_cutover_ready"])
        self.assertEqual(state["snapshot_cache_authority"]["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(state["snapshot_cache_authority"]["authority_prerequisite_state"], "observed_only")
        self.assertFalse(state["snapshot_cache_authority"]["authority_ready"])
        self.assertFalse(state["snapshot_cache_authority"]["runtime_cutover_ready"])

        snapshot_state = dict(state["categories"]["snapshot_cache_freshness_parity"])
        self.assertEqual(snapshot_state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(snapshot_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(snapshot_state["authority_ready"])
        self.assertIn("snapshot_projection_authority_missing", snapshot_state["missing_signals"])
        self.assertIn("lot_projection_authority_missing", snapshot_state["missing_signals"])
        self.assertIn("snapshot_freshness_invalidation_authority_missing", snapshot_state["missing_signals"])
        self.assertIn("valuation_semantic_authority_missing", snapshot_state["missing_signals"])

        replay_state = dict(state["categories"]["replay_input_parity"])
        self.assertEqual(replay_state["current_signal"], "replay_specific_gaps_observed")
        self.assertEqual(replay_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(replay_state["authority_ready"])
        self.assertIn("cost_method_specific_authority_missing", replay_state["missing_signals"])
        self.assertIn("snapshot_cache_freshness_authority_missing", replay_state["downstream_blockers"])

    def test_phase_f_effective_authority_summary_preserves_layered_readiness(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="summary-user", username="summary-user")
        service = PortfolioService(owner_id="summary-user")

        account = service.create_account(name="Summary", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-summary-trade-1",
            dedup_hash="phase-f-summary-trade-1",
        )
        db.save_daily_data(
            __import__("pandas").DataFrame(
                [
                    {
                        "date": date(2026, 4, 12),
                        "open": 160.0,
                        "high": 160.0,
                        "low": 160.0,
                        "close": 160.0,
                        "volume": 1.0,
                        "amount": 160.0,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code="AAPL",
            data_source="unit-test",
        )
        service.get_portfolio_snapshot(account_id=account["id"], as_of=date(2026, 4, 12), cost_method="fifo")

        summary = db.get_phase_f_effective_authority_summary(account_id=account["id"])
        prerequisite_state = db.get_phase_f_portfolio_prerequisite_state(account_id=account["id"])

        self.assertIsNotNone(summary)
        self.assertIsNotNone(prerequisite_state)
        self.assertEqual(summary["authority_model"], "phase_f_effective_authority_summary_v1")
        self.assertEqual(summary["highest_roi_category"], "ledger_event_payload_parity")
        self.assertEqual(summary["foundational_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(summary["foundational_boundary"]["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(summary["foundational_boundary"]["authority_ready"])
        self.assertEqual(summary["next_unmet_boundary"]["domain"], "replay_input_authority")
        self.assertEqual(summary["next_unmet_boundary"]["reason"], "domain_specific_blockers_remaining")

        readiness = dict(summary["effective_readiness"])
        self.assertEqual(
            readiness["authority_ready_domains"],
            ["event_history_authority", "ledger_event_payload_parity"],
        )
        self.assertEqual(
            readiness["observed_only_domains"],
            ["replay_input_authority", "snapshot_cache_authority"],
        )
        self.assertEqual(readiness["blocked_domains"], [])
        self.assertEqual(readiness["domains_blocked_only_by_upstream"], [])
        self.assertEqual(
            readiness["domains_with_domain_specific_blockers"],
            ["replay_input_authority", "snapshot_cache_authority"],
        )
        self.assertFalse(readiness["runtime_cutover_ready"])
        self.assertEqual(
            readiness["domains_with_runtime_cutover_disabled"],
            [
                "event_history_authority",
                "ledger_event_payload_parity",
                "replay_input_authority",
                "snapshot_cache_authority",
            ],
        )

        replay_domain = dict(summary["domains"]["replay_input_authority"])
        self.assertFalse(replay_domain["blocked_only_by_upstream"])
        self.assertEqual(replay_domain["inherited_upstream_blockers"], [])
        self.assertIn("cost_method_specific_authority_missing", replay_domain["domain_specific_blockers"])
        self.assertIn("lot_authority_missing", replay_domain["domain_specific_blockers"])
        self.assertIn("as_of_replay_boundary_missing", replay_domain["domain_specific_blockers"])

        snapshot_domain = dict(summary["domains"]["snapshot_cache_authority"])
        self.assertFalse(snapshot_domain["blocked_only_by_upstream"])
        self.assertEqual(snapshot_domain["inherited_upstream_blockers"], [])
        self.assertIn("snapshot_projection_authority_missing", snapshot_domain["domain_specific_blockers"])
        self.assertIn("lot_projection_authority_missing", snapshot_domain["domain_specific_blockers"])
        self.assertIn(
            "snapshot_freshness_invalidation_authority_missing",
            snapshot_domain["domain_specific_blockers"],
        )
        self.assertIn("valuation_semantic_authority_missing", snapshot_domain["domain_specific_blockers"])

        embedded_summary = dict(prerequisite_state["effective_authority_summary"])
        self.assertEqual(embedded_summary["authority_model"], "phase_f_effective_authority_summary_v1")
        self.assertEqual(embedded_summary["highest_roi_category"], "ledger_event_payload_parity")

    def test_phase_f_effective_authority_summary_keeps_observed_upstream_blockers_visible(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="summary-observed-user", username="summary-observed-user")
        service = PortfolioService(owner_id="summary-observed-user")

        account = service.create_account(
            name="Summary Observed",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-summary-observed-trade-1",
            dedup_hash="phase-f-summary-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Summary Observed Drifted"
            session.commit()

        summary = db.get_phase_f_effective_authority_summary(account_id=account["id"])

        self.assertIsNotNone(summary)
        self.assertEqual(summary["foundational_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(summary["foundational_boundary"]["authority_prerequisite_state"], "observed_only")
        self.assertFalse(summary["foundational_boundary"]["authority_ready"])
        self.assertEqual(summary["next_unmet_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(summary["next_unmet_boundary"]["reason"], "foundational_boundary_not_ready")

        readiness = dict(summary["effective_readiness"])
        self.assertEqual(readiness["authority_ready_domains"], [])
        self.assertEqual(
            readiness["observed_only_domains"],
            [
                "event_history_authority",
                "ledger_event_payload_parity",
                "replay_input_authority",
                "snapshot_cache_authority",
            ],
        )
        self.assertEqual(readiness["blocked_domains"], [])
        self.assertEqual(
            readiness["domains_blocked_only_by_upstream"],
            ["event_history_authority", "replay_input_authority", "snapshot_cache_authority"],
        )
        self.assertEqual(
            readiness["domains_with_domain_specific_blockers"],
            ["ledger_event_payload_parity"],
        )

        self.assertFalse(summary["domains"]["event_history_authority"]["has_domain_specific_blockers"])
        self.assertTrue(summary["domains"]["event_history_authority"]["blocked_only_by_upstream"])
        self.assertIn(
            "account_metadata_authority_missing",
            summary["domains"]["event_history_authority"]["inherited_upstream_blockers"],
        )
        self.assertTrue(summary["domains"]["replay_input_authority"]["blocked_only_by_upstream"])
        self.assertEqual(summary["domains"]["replay_input_authority"]["domain_specific_blockers"], [])
        self.assertTrue(summary["domains"]["snapshot_cache_authority"]["blocked_only_by_upstream"])
        self.assertEqual(summary["domains"]["snapshot_cache_authority"]["domain_specific_blockers"], [])

    def test_phase_f_effective_authority_summary_keeps_blocked_upstream_boundary_foundational(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="summary-blocked-user", username="summary-blocked-user")
        service = PortfolioService(owner_id="summary-blocked-user")

        account = service.create_account(
            name="Summary Blocked",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        trade = service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-summary-blocked-trade-1",
            dedup_hash="phase-f-summary-blocked-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioTrade).where(PortfolioTrade.id == trade["id"]).limit(1)
            ).scalar_one()
            row.price = 151.0
            session.commit()

        summary = db.get_phase_f_effective_authority_summary(account_id=account["id"])

        self.assertIsNotNone(summary)
        self.assertEqual(summary["highest_roi_category"], "ledger_event_payload_parity")
        self.assertEqual(summary["foundational_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(summary["foundational_boundary"]["authority_prerequisite_state"], "blocked")
        self.assertFalse(summary["foundational_boundary"]["authority_ready"])
        self.assertEqual(summary["next_unmet_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(summary["next_unmet_boundary"]["reason"], "foundational_boundary_not_ready")

        readiness = dict(summary["effective_readiness"])
        self.assertEqual(readiness["authority_ready_domains"], [])
        self.assertEqual(readiness["observed_only_domains"], [])
        self.assertEqual(
            readiness["blocked_domains"],
            [
                "event_history_authority",
                "ledger_event_payload_parity",
                "replay_input_authority",
                "snapshot_cache_authority",
            ],
        )
        self.assertEqual(
            readiness["domains_blocked_only_by_upstream"],
            ["event_history_authority", "replay_input_authority", "snapshot_cache_authority"],
        )
        self.assertEqual(
            readiness["domains_with_domain_specific_blockers"],
            ["ledger_event_payload_parity"],
        )
        self.assertIn(
            "event_payload_parity_not_observed",
            summary["domains"]["ledger_event_payload_parity"]["domain_specific_blockers"],
        )
        self.assertTrue(summary["domains"]["event_history_authority"]["blocked_only_by_upstream"])
        self.assertTrue(summary["domains"]["replay_input_authority"]["blocked_only_by_upstream"])
        self.assertTrue(summary["domains"]["snapshot_cache_authority"]["blocked_only_by_upstream"])
        self.assertFalse(readiness["runtime_cutover_ready"])

    def test_phase_f_domain_readiness_gate_evaluates_modeled_targets(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="gate-user", username="gate-user")
        service = PortfolioService(owner_id="gate-user")

        account = service.create_account(name="Gate", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-gate-trade-1",
            dedup_hash="phase-f-gate-trade-1",
        )
        db.save_daily_data(
            __import__("pandas").DataFrame(
                [
                    {
                        "date": date(2026, 4, 12),
                        "open": 160.0,
                        "high": 160.0,
                        "low": 160.0,
                        "close": 160.0,
                        "volume": 1.0,
                        "amount": 160.0,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code="AAPL",
            data_source="unit-test",
        )
        service.get_portfolio_snapshot(account_id=account["id"], as_of=date(2026, 4, 12), cost_method="fifo")

        summary = db.get_phase_f_effective_authority_summary(account_id=account["id"])
        ledger_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="ledger_event_payload_parity",
        )
        event_history_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="event_history_authority",
        )
        replay_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="replay_input_authority",
        )
        snapshot_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="snapshot_cache_authority",
        )

        self.assertIsNotNone(summary)
        self.assertIsNotNone(ledger_gate)
        self.assertIsNotNone(event_history_gate)
        self.assertIsNotNone(replay_gate)
        self.assertIsNotNone(snapshot_gate)

        self.assertEqual(ledger_gate["gate_model"], "phase_f_domain_readiness_gate_v1")
        self.assertEqual(ledger_gate["target_domain"], "ledger_event_payload_parity")
        self.assertEqual(ledger_gate["gate_status"], "design_prerequisite_ready")
        self.assertTrue(ledger_gate["design_prerequisite_ready"])
        self.assertFalse(ledger_gate["upstream_blocked"])
        self.assertFalse(ledger_gate["has_domain_specific_blockers"])
        self.assertEqual(ledger_gate["next_unmet_boundary"], None)
        self.assertFalse(ledger_gate["runtime_cutover_ready"])
        self.assertEqual(ledger_gate["highest_roi_category"], "ledger_event_payload_parity")
        self.assertEqual(
            ledger_gate["target_domain_state"]["authority_prerequisite_state"],
            summary["domains"]["ledger_event_payload_parity"]["authority_prerequisite_state"],
        )

        self.assertEqual(event_history_gate["target_domain"], "event_history_authority")
        self.assertEqual(event_history_gate["gate_status"], "design_prerequisite_ready")
        self.assertTrue(event_history_gate["design_prerequisite_ready"])
        self.assertFalse(event_history_gate["upstream_blocked"])
        self.assertFalse(event_history_gate["has_domain_specific_blockers"])
        self.assertEqual(event_history_gate["next_unmet_boundary"], None)
        self.assertFalse(event_history_gate["runtime_cutover_ready"])

        self.assertEqual(replay_gate["target_domain"], "replay_input_authority")
        self.assertEqual(replay_gate["gate_status"], "domain_specific_blocked")
        self.assertFalse(replay_gate["design_prerequisite_ready"])
        self.assertFalse(replay_gate["upstream_blocked"])
        self.assertTrue(replay_gate["has_domain_specific_blockers"])
        self.assertEqual(replay_gate["inherited_upstream_blockers"], [])
        self.assertIn("cost_method_specific_authority_missing", replay_gate["domain_specific_blockers"])
        self.assertIn("lot_authority_missing", replay_gate["domain_specific_blockers"])
        self.assertIn("as_of_replay_boundary_missing", replay_gate["domain_specific_blockers"])
        self.assertIsNotNone(replay_gate["next_unmet_boundary"])
        self.assertEqual(replay_gate["next_unmet_boundary"]["domain"], "replay_input_authority")
        self.assertEqual(replay_gate["next_unmet_boundary"]["reason"], "domain_specific_blockers_remaining")
        self.assertFalse(replay_gate["runtime_cutover_ready"])

        self.assertEqual(snapshot_gate["target_domain"], "snapshot_cache_authority")
        self.assertEqual(snapshot_gate["gate_status"], "domain_specific_blocked")
        self.assertFalse(snapshot_gate["design_prerequisite_ready"])
        self.assertFalse(snapshot_gate["upstream_blocked"])
        self.assertTrue(snapshot_gate["has_domain_specific_blockers"])
        self.assertEqual(snapshot_gate["inherited_upstream_blockers"], [])
        self.assertIn("snapshot_projection_authority_missing", snapshot_gate["domain_specific_blockers"])
        self.assertIn("lot_projection_authority_missing", snapshot_gate["domain_specific_blockers"])
        self.assertIn(
            "snapshot_freshness_invalidation_authority_missing",
            snapshot_gate["domain_specific_blockers"],
        )
        self.assertIn("valuation_semantic_authority_missing", snapshot_gate["domain_specific_blockers"])
        self.assertIsNotNone(snapshot_gate["next_unmet_boundary"])
        self.assertEqual(snapshot_gate["next_unmet_boundary"]["domain"], "snapshot_cache_authority")
        self.assertEqual(snapshot_gate["next_unmet_boundary"]["reason"], "domain_specific_blockers_remaining")
        self.assertFalse(snapshot_gate["runtime_cutover_ready"])

    def test_phase_f_domain_readiness_gate_preserves_upstream_blockers_for_downstream_targets(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="gate-observed-user", username="gate-observed-user")
        service = PortfolioService(owner_id="gate-observed-user")

        account = service.create_account(
            name="Gate Observed",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-gate-observed-trade-1",
            dedup_hash="phase-f-gate-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Gate Observed Drifted"
            session.commit()

        event_history_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="event_history_authority",
        )
        replay_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="replay_input_authority",
        )
        snapshot_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="snapshot_cache_authority",
        )

        for gate in [event_history_gate, replay_gate, snapshot_gate]:
            self.assertIsNotNone(gate)
            self.assertEqual(gate["gate_status"], "upstream_blocked")
            self.assertFalse(gate["design_prerequisite_ready"])
            self.assertTrue(gate["upstream_blocked"])
            self.assertFalse(gate["has_domain_specific_blockers"])
            self.assertIn("account_metadata_authority_missing", gate["inherited_upstream_blockers"])
            self.assertEqual(gate["domain_specific_blockers"], [])
            self.assertIsNotNone(gate["next_unmet_boundary"])
            self.assertEqual(gate["next_unmet_boundary"]["domain"], "ledger_event_payload_parity")
            self.assertEqual(gate["next_unmet_boundary"]["reason"], "foundational_boundary_not_ready")
            self.assertFalse(gate["runtime_cutover_ready"])

    def test_phase_f_domain_readiness_gate_keeps_foundational_boundary_for_blocked_targets(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="gate-blocked-user", username="gate-blocked-user")
        service = PortfolioService(owner_id="gate-blocked-user")

        account = service.create_account(
            name="Gate Blocked",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        trade = service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-gate-blocked-trade-1",
            dedup_hash="phase-f-gate-blocked-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioTrade).where(PortfolioTrade.id == trade["id"]).limit(1)
            ).scalar_one()
            row.price = 151.0
            session.commit()

        ledger_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="ledger_event_payload_parity",
        )
        snapshot_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="snapshot_cache_authority",
        )

        self.assertIsNotNone(ledger_gate)
        self.assertEqual(ledger_gate["gate_status"], "domain_specific_blocked")
        self.assertFalse(ledger_gate["design_prerequisite_ready"])
        self.assertFalse(ledger_gate["upstream_blocked"])
        self.assertTrue(ledger_gate["has_domain_specific_blockers"])
        self.assertIn("event_payload_parity_not_observed", ledger_gate["domain_specific_blockers"])
        self.assertIsNotNone(ledger_gate["next_unmet_boundary"])
        self.assertEqual(ledger_gate["next_unmet_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(ledger_gate["next_unmet_boundary"]["reason"], "foundational_boundary_not_ready")
        self.assertFalse(ledger_gate["runtime_cutover_ready"])

        self.assertIsNotNone(snapshot_gate)
        self.assertEqual(snapshot_gate["gate_status"], "upstream_blocked")
        self.assertFalse(snapshot_gate["design_prerequisite_ready"])
        self.assertTrue(snapshot_gate["upstream_blocked"])
        self.assertFalse(snapshot_gate["has_domain_specific_blockers"])
        self.assertIn("event_payload_parity_not_observed", snapshot_gate["inherited_upstream_blockers"])
        self.assertEqual(snapshot_gate["domain_specific_blockers"], [])
        self.assertIsNotNone(snapshot_gate["next_unmet_boundary"])
        self.assertEqual(snapshot_gate["next_unmet_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(snapshot_gate["next_unmet_boundary"]["reason"], "foundational_boundary_not_ready")
        self.assertFalse(snapshot_gate["runtime_cutover_ready"])

    def test_phase_f_prerequisite_state_flags_ledger_payload_drift(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-drift-user", username="prereq-drift-user")
        service = PortfolioService(owner_id="prereq-drift-user")

        account = service.create_account(name="Prereq Drift", broker="IBKR", market="us", base_currency="USD")
        trade = service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-drift-trade-1",
            dedup_hash="phase-f-prereq-drift-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioTrade).where(PortfolioTrade.id == trade["id"]).limit(1)
            ).scalar_one()
            row.price = 151.0
            session.commit()

        state = db.get_phase_f_portfolio_prerequisite_state(account_id=account["id"])
        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])
        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])
        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])
        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(state)
        self.assertIsNotNone(authority_state)
        self.assertIsNotNone(event_history_state)
        self.assertIsNotNone(replay_input_state)
        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(authority_state["current_signal"], "payload_drift")
        self.assertEqual(authority_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(authority_state["authority_ready"])
        self.assertIn("event_payload_parity_not_observed", authority_state["blocked_reasons"])

        self.assertEqual(event_history_state["current_signal"], "ledger_payload_blocked")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(event_history_state["authority_ready"])
        self.assertIn("event_payload_parity_not_observed", event_history_state["blocked_reasons"])

        self.assertEqual(replay_input_state["current_signal"], "event_history_blocked")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertIn("event_payload_parity_not_observed", replay_input_state["blocked_reasons"])

        self.assertEqual(snapshot_cache_state["current_signal"], "event_history_blocked")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertIn("event_payload_parity_not_observed", snapshot_cache_state["blocked_reasons"])

        ledger_state = dict(state["categories"]["ledger_event_payload_parity"])
        self.assertEqual(ledger_state["current_signal"], "payload_drift")
        self.assertFalse(ledger_state["payload_parity_observed"])
        self.assertIn("event_payload_parity_not_observed", ledger_state["missing_signals"])
        self.assertEqual(ledger_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(ledger_state["authority_ready"])

        self.assertEqual(state["event_history_authority"]["current_signal"], "ledger_payload_blocked")
        self.assertEqual(state["event_history_authority"]["authority_prerequisite_state"], "blocked")
        self.assertFalse(state["event_history_authority"]["authority_ready"])
        self.assertEqual(state["replay_input_authority"]["current_signal"], "event_history_blocked")
        self.assertEqual(state["replay_input_authority"]["authority_prerequisite_state"], "blocked")
        self.assertFalse(state["replay_input_authority"]["authority_ready"])
        self.assertEqual(state["snapshot_cache_authority"]["current_signal"], "event_history_blocked")
        self.assertEqual(state["snapshot_cache_authority"]["authority_prerequisite_state"], "blocked")
        self.assertFalse(state["snapshot_cache_authority"]["authority_ready"])

    def test_phase_f_ledger_event_payload_authority_state_requires_root_account_authority(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-observed-user", username="prereq-observed-user")
        service = PortfolioService(owner_id="prereq-observed-user")

        account = service.create_account(name="Prereq Observed", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-observed-trade-1",
            dedup_hash="phase-f-prereq-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Prereq Observed Drifted"
            session.commit()

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "payload_parity_observed")
        self.assertTrue(authority_state["payload_parity_observed"])
        self.assertEqual(authority_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(authority_state["authority_ready"])
        self.assertIn("account_metadata_authority_missing", authority_state["blocked_reasons"])

    def test_phase_f_ledger_event_payload_authority_state_surfaces_operational_parity_evidence(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-evidence-user", username="prereq-evidence-user")
        service = PortfolioService(owner_id="prereq-evidence-user")

        account = service.create_account(name="Prereq Evidence", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-evidence-trade-1",
            dedup_hash="phase-f-prereq-evidence-trade-1",
        )
        service.record_corporate_action(
            account_id=account["id"],
            symbol="AAPL",
            effective_date=date(2026, 4, 12),
            action_type="cash_dividend",
            cash_dividend_per_share=0.5,
            split_ratio=None,
            market="us",
            currency="USD",
            note="phase-f-ledger-evidence",
        )

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        evidence = dict(authority_state["parity_evidence"])
        self.assertEqual(
            evidence["legacy_event_type_counts"],
            {"cash": 1, "corporate_action": 1, "trade": 1},
        )
        self.assertEqual(
            evidence["shadow_event_type_counts"],
            {"cash": 1, "corporate_action": 1, "trade": 1},
        )
        self.assertEqual(
            evidence["legacy_event_types_present"],
            ["cash", "corporate_action", "trade"],
        )
        self.assertEqual(
            evidence["shadow_event_types_present"],
            ["cash", "corporate_action", "trade"],
        )
        self.assertEqual(
            evidence["representative_event_shapes_observed"],
            ["cash", "corporate_action", "trade"],
        )
        self.assertTrue(evidence["event_type_count_parity_observed"])
        operational_audit = dict(authority_state["operational_audit"])
        self.assertEqual(operational_audit["audit_signal"], "representative_parity_observed")
        self.assertEqual(operational_audit["evidence_coverage_state"], "representative")
        self.assertEqual(operational_audit["representative_event_shape_count"], 3)
        self.assertEqual(operational_audit["representative_event_shape_target"], 3)
        self.assertEqual(operational_audit["missing_representative_event_shapes"], [])
        self.assertEqual(operational_audit["operational_confidence_state"], "representative")
        self.assertEqual(operational_audit["design_prerequisite_support"], "stronger_operational_evidence")

        drift_details = dict(authority_state["drift_details"])
        self.assertEqual(drift_details["legacy_total_event_rows"], 3)
        self.assertEqual(drift_details["shadow_total_event_rows"], 3)
        self.assertEqual(drift_details["legacy_event_types_missing_in_shadow"], [])
        self.assertEqual(drift_details["shadow_event_types_missing_in_legacy"], [])
        self.assertIsNone(drift_details["first_mismatch_index"])

    def test_phase_f_ledger_event_payload_authority_state_marks_narrow_parity_as_limited_confidence(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-narrow-audit-user", username="prereq-narrow-audit-user")
        service = PortfolioService(owner_id="prereq-narrow-audit-user")

        account = service.create_account(name="Prereq Narrow Audit", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-narrow-audit-trade-1",
            dedup_hash="phase-f-prereq-narrow-audit-trade-1",
        )

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "payload_parity_observed")
        self.assertEqual(authority_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(authority_state["authority_ready"])

        operational_audit = dict(authority_state["operational_audit"])
        self.assertEqual(operational_audit["audit_signal"], "narrow_parity_observed")
        self.assertEqual(operational_audit["evidence_coverage_state"], "narrow")
        self.assertEqual(operational_audit["representative_event_shape_count"], 1)
        self.assertEqual(operational_audit["representative_event_shape_target"], 3)
        self.assertEqual(
            operational_audit["missing_representative_event_shapes"],
            ["cash", "corporate_action"],
        )
        self.assertEqual(operational_audit["operational_confidence_state"], "narrow")
        self.assertEqual(operational_audit["design_prerequisite_support"], "limited_observation_only")

    def test_phase_f_ledger_event_payload_authority_state_surfaces_payload_drift_details(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-drift-detail-user", username="prereq-drift-detail-user")
        service = PortfolioService(owner_id="prereq-drift-detail-user")

        account = service.create_account(
            name="Prereq Drift Detail",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        trade = service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-drift-detail-trade-1",
            dedup_hash="phase-f-prereq-drift-detail-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioTrade).where(PortfolioTrade.id == trade["id"]).limit(1)
            ).scalar_one()
            row.price = 151.0
            session.commit()

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "payload_drift")
        drift_details = dict(authority_state["drift_details"])
        self.assertEqual(drift_details["legacy_total_event_rows"], 1)
        self.assertEqual(drift_details["shadow_total_event_rows"], 1)
        self.assertEqual(drift_details["first_mismatch_index"], 0)
        self.assertEqual(drift_details["legacy_entry_type_at_mismatch"], "trade")
        self.assertEqual(drift_details["shadow_entry_type_at_mismatch"], "trade")
        self.assertEqual(drift_details["legacy_event_types_missing_in_shadow"], [])
        self.assertEqual(drift_details["shadow_event_types_missing_in_legacy"], [])
        operational_audit = dict(authority_state["operational_audit"])
        self.assertEqual(operational_audit["audit_signal"], "payload_drift_visible")
        self.assertEqual(operational_audit["evidence_coverage_state"], "narrow")
        self.assertEqual(operational_audit["operational_confidence_state"], "blocked")
        self.assertEqual(operational_audit["design_prerequisite_support"], "blocked")

    def test_phase_f_ledger_event_payload_authority_state_surfaces_count_mismatch_details(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-mismatch-detail-user", username="prereq-mismatch-detail-user")
        service = PortfolioService(owner_id="prereq-mismatch-detail-user")

        account = service.create_account(
            name="Prereq Mismatch Detail",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-mismatch-detail-trade-1",
            dedup_hash="phase-f-prereq-mismatch-detail-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"],
                    PhaseFPortfolioLedger.entry_type == "trade",
                )
            )
            session.commit()

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "count_mismatch")
        evidence = dict(authority_state["parity_evidence"])
        self.assertFalse(evidence["event_type_count_parity_observed"])
        self.assertEqual(
            evidence["legacy_event_type_counts"],
            {"cash": 1, "corporate_action": 0, "trade": 1},
        )
        self.assertEqual(
            evidence["shadow_event_type_counts"],
            {"cash": 1, "corporate_action": 0, "trade": 0},
        )

        drift_details = dict(authority_state["drift_details"])
        self.assertEqual(drift_details["legacy_total_event_rows"], 2)
        self.assertEqual(drift_details["shadow_total_event_rows"], 1)
        self.assertEqual(drift_details["legacy_event_types_missing_in_shadow"], ["trade"])
        self.assertEqual(drift_details["shadow_event_types_missing_in_legacy"], [])
        self.assertIsNone(drift_details["first_mismatch_index"])
        operational_audit = dict(authority_state["operational_audit"])
        self.assertEqual(operational_audit["audit_signal"], "count_mismatch_visible")
        self.assertEqual(operational_audit["evidence_coverage_state"], "narrow")
        self.assertEqual(operational_audit["operational_confidence_state"], "blocked")
        self.assertEqual(operational_audit["design_prerequisite_support"], "blocked")

    def test_phase_f_event_history_authority_state_requires_root_account_authority(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="event-history-observed-user", username="event-history-observed-user")
        service = PortfolioService(owner_id="event-history-observed-user")

        account = service.create_account(name="Event History Observed", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-event-history-observed-trade-1",
            dedup_hash="phase-f-event-history-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Event History Observed Drifted"
            session.commit()

        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])

        self.assertIsNotNone(event_history_state)
        self.assertEqual(event_history_state["current_signal"], "ledger_payload_observed_only")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(event_history_state["authority_ready"])
        self.assertIn("account_metadata_authority_missing", event_history_state["blocked_reasons"])

    def test_phase_f_replay_input_authority_state_requires_event_history_authority(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="replay-observed-user", username="replay-observed-user")
        service = PortfolioService(owner_id="replay-observed-user")

        account = service.create_account(name="Replay Observed", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-replay-observed-trade-1",
            dedup_hash="phase-f-replay-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Replay Observed Drifted"
            session.commit()

        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])

        self.assertIsNotNone(replay_input_state)
        self.assertEqual(replay_input_state["current_signal"], "event_history_observed_only")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertIn("account_metadata_authority_missing", replay_input_state["blocked_reasons"])

    def test_phase_f_replay_input_authority_state_ready_when_prerequisites_and_replay_gaps_clear(self) -> None:
        db = self._db()
        ready_state = db._build_phase_f_replay_input_authority_state(
            account_id=1,
            ledger_authority_state={
                "owner_user_id": "ready-user",
                "account_name": "Ready",
                "authority_model": "phase_f_ledger_event_payload_authority_v1",
                "phase_f_authority_model": "phase_f_projection_compare",
                "legacy_row_counts": {"total_event_rows": 2},
                "shadow_row_counts": {"ledger_rows": 2},
                "payload_parity_observed": True,
                "account_metadata_authority_ready": True,
            },
            event_history_authority_state={
                "owner_user_id": "ready-user",
                "account_name": "Ready",
                "authority_model": "phase_f_event_history_authority_v1",
                "phase_f_authority_model": "phase_f_projection_compare",
                "legacy_row_counts": {"total_event_rows": 2},
                "shadow_row_counts": {"ledger_rows": 2},
                "authority_prerequisite_state": "authority_ready",
                "blocked_reasons": [],
            },
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=0,
            legacy_lot_row_count=0,
            shadow_position_row_count=0,
            replay_capabilities={
                "cost_method_specific_authority": True,
                "lot_authority": True,
                "as_of_replay_boundary": True,
            },
        )

        self.assertEqual(ready_state["current_signal"], "prerequisite_ready")
        self.assertEqual(ready_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(ready_state["authority_ready"])
        self.assertFalse(ready_state["runtime_cutover_ready"])
        self.assertEqual(ready_state["blocked_reasons"], [])

    def test_phase_f_snapshot_cache_authority_state_requires_event_history_authority(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="snapshot-observed-user", username="snapshot-observed-user")
        service = PortfolioService(owner_id="snapshot-observed-user")

        account = service.create_account(name="Snapshot Observed", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-snapshot-observed-trade-1",
            dedup_hash="phase-f-snapshot-observed-trade-1",
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "Snapshot Observed Drifted"
            session.commit()

        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(snapshot_cache_state["current_signal"], "event_history_observed_only")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertIn("account_metadata_authority_missing", snapshot_cache_state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_ready_when_prerequisites_and_snapshot_gaps_clear(self) -> None:
        db = self._db()
        ready_state = db._build_phase_f_snapshot_cache_authority_state(
            account_id=1,
            ledger_authority_state={
                "owner_user_id": "ready-user",
                "account_name": "Ready",
                "authority_model": "phase_f_ledger_event_payload_authority_v1",
                "phase_f_authority_model": "phase_f_projection_compare",
                "legacy_row_counts": {"total_event_rows": 2},
                "shadow_row_counts": {"ledger_rows": 2},
                "payload_parity_observed": True,
                "account_metadata_authority_ready": True,
            },
            event_history_authority_state={
                "owner_user_id": "ready-user",
                "account_name": "Ready",
                "authority_model": "phase_f_event_history_authority_v1",
                "phase_f_authority_model": "phase_f_projection_compare",
                "legacy_row_counts": {"total_event_rows": 2},
                "shadow_row_counts": {"ledger_rows": 2},
                "authority_prerequisite_state": "authority_ready",
                "blocked_reasons": [],
            },
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=1,
            legacy_position_row_count=1,
            legacy_lot_row_count=1,
            shadow_position_row_count=1,
            snapshot_capabilities={
                "snapshot_projection_authority": True,
                "lot_projection_authority": True,
                "freshness_invalidation_authority": True,
                "valuation_semantic_authority": True,
            },
        )

        self.assertEqual(ready_state["current_signal"], "prerequisite_ready")
        self.assertEqual(ready_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(ready_state["authority_ready"])
        self.assertFalse(ready_state["runtime_cutover_ready"])
        self.assertEqual(ready_state["blocked_reasons"], [])

    def test_phase_f_snapshot_cache_authority_state_blocks_snapshot_projection_gap(self) -> None:
        db = self._db()
        state = db._build_phase_f_snapshot_cache_authority_state(
            account_id=1,
            ledger_authority_state={"owner_user_id": "u", "account_name": "A"},
            event_history_authority_state={"authority_prerequisite_state": "authority_ready", "blocked_reasons": []},
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=1,
            legacy_position_row_count=1,
            legacy_lot_row_count=1,
            shadow_position_row_count=1,
            snapshot_capabilities={
                "snapshot_projection_authority": False,
                "lot_projection_authority": True,
                "freshness_invalidation_authority": True,
                "valuation_semantic_authority": True,
            },
        )

        self.assertEqual(state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(state["authority_prerequisite_state"], "observed_only")
        self.assertIn("snapshot_projection_authority_missing", state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_blocks_lot_projection_gap(self) -> None:
        db = self._db()
        state = db._build_phase_f_snapshot_cache_authority_state(
            account_id=1,
            ledger_authority_state={"owner_user_id": "u", "account_name": "A"},
            event_history_authority_state={"authority_prerequisite_state": "authority_ready", "blocked_reasons": []},
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=1,
            legacy_position_row_count=1,
            legacy_lot_row_count=1,
            shadow_position_row_count=1,
            snapshot_capabilities={
                "snapshot_projection_authority": True,
                "lot_projection_authority": False,
                "freshness_invalidation_authority": True,
                "valuation_semantic_authority": True,
            },
        )

        self.assertEqual(state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(state["authority_prerequisite_state"], "observed_only")
        self.assertIn("lot_projection_authority_missing", state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_blocks_freshness_gap(self) -> None:
        db = self._db()
        state = db._build_phase_f_snapshot_cache_authority_state(
            account_id=1,
            ledger_authority_state={"owner_user_id": "u", "account_name": "A"},
            event_history_authority_state={"authority_prerequisite_state": "authority_ready", "blocked_reasons": []},
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=1,
            legacy_position_row_count=1,
            legacy_lot_row_count=1,
            shadow_position_row_count=1,
            snapshot_capabilities={
                "snapshot_projection_authority": True,
                "lot_projection_authority": True,
                "freshness_invalidation_authority": False,
                "valuation_semantic_authority": True,
            },
        )

        self.assertEqual(state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(state["authority_prerequisite_state"], "observed_only")
        self.assertIn("snapshot_freshness_invalidation_authority_missing", state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_blocks_valuation_semantic_gap(self) -> None:
        db = self._db()
        state = db._build_phase_f_snapshot_cache_authority_state(
            account_id=1,
            ledger_authority_state={"owner_user_id": "u", "account_name": "A"},
            event_history_authority_state={"authority_prerequisite_state": "authority_ready", "blocked_reasons": []},
            snapshot_cost_methods=["fifo"],
            legacy_snapshot_row_count=1,
            legacy_position_row_count=1,
            legacy_lot_row_count=1,
            shadow_position_row_count=1,
            snapshot_capabilities={
                "snapshot_projection_authority": True,
                "lot_projection_authority": True,
                "freshness_invalidation_authority": True,
                "valuation_semantic_authority": False,
            },
        )

        self.assertEqual(state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(state["authority_prerequisite_state"], "observed_only")
        self.assertIn("valuation_semantic_authority_missing", state["blocked_reasons"])


    def test_phase_f_ledger_event_payload_authority_state_blocks_count_mismatch(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-count-user", username="prereq-count-user")
        service = PortfolioService(owner_id="prereq-count-user")

        account = service.create_account(name="Prereq Count", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-count-trade-1",
            dedup_hash="phase-f-prereq-count-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"],
                    PhaseFPortfolioLedger.entry_type == "trade",
                )
            )
            session.commit()

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "count_mismatch")
        self.assertEqual(authority_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(authority_state["authority_ready"])
        self.assertIn("ledger_event_count_mismatch", authority_state["blocked_reasons"])

    def test_phase_f_event_history_authority_state_blocks_count_mismatch(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="event-history-count-user", username="event-history-count-user")
        service = PortfolioService(owner_id="event-history-count-user")

        account = service.create_account(name="Event History Count", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-event-history-count-trade-1",
            dedup_hash="phase-f-event-history-count-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"],
                    PhaseFPortfolioLedger.entry_type == "trade",
                )
            )
            session.commit()

        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])

        self.assertIsNotNone(event_history_state)
        self.assertEqual(event_history_state["current_signal"], "ledger_payload_blocked")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(event_history_state["authority_ready"])
        self.assertIn("ledger_event_count_mismatch", event_history_state["blocked_reasons"])

    def test_phase_f_replay_input_authority_state_blocks_count_mismatch(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="replay-count-user", username="replay-count-user")
        service = PortfolioService(owner_id="replay-count-user")

        account = service.create_account(name="Replay Count", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-replay-count-trade-1",
            dedup_hash="phase-f-replay-count-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"],
                    PhaseFPortfolioLedger.entry_type == "trade",
                )
            )
            session.commit()

        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])

        self.assertIsNotNone(replay_input_state)
        self.assertEqual(replay_input_state["current_signal"], "event_history_blocked")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertIn("ledger_event_count_mismatch", replay_input_state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_blocks_count_mismatch(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="snapshot-count-user", username="snapshot-count-user")
        service = PortfolioService(owner_id="snapshot-count-user")

        account = service.create_account(name="Snapshot Count", broker="IBKR", market="us", base_currency="USD")
        service.record_cash_ledger(
            account_id=account["id"],
            event_date=date(2026, 4, 10),
            direction="in",
            amount=5000.0,
            currency="USD",
        )
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-snapshot-count-trade-1",
            dedup_hash="phase-f-snapshot-count-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"],
                    PhaseFPortfolioLedger.entry_type == "trade",
                )
            )
            session.commit()

        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(snapshot_cache_state["current_signal"], "event_history_blocked")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertIn("ledger_event_count_mismatch", snapshot_cache_state["blocked_reasons"])

    def test_phase_f_ledger_event_payload_authority_state_blocks_shadow_missing(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-shadow-user", username="prereq-shadow-user")
        service = PortfolioService(owner_id="prereq-shadow-user")

        account = service.create_account(name="Prereq Shadow", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-prereq-shadow-trade-1",
            dedup_hash="phase-f-prereq-shadow-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"]
                )
            )
            session.commit()

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "shadow_missing")
        self.assertEqual(authority_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(authority_state["authority_ready"])
        self.assertIn("shadow_ledger_missing", authority_state["blocked_reasons"])

    def test_phase_f_event_history_authority_state_blocks_shadow_missing(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="event-history-shadow-user", username="event-history-shadow-user")
        service = PortfolioService(owner_id="event-history-shadow-user")

        account = service.create_account(name="Event History Shadow", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-event-history-shadow-trade-1",
            dedup_hash="phase-f-event-history-shadow-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"]
                )
            )
            session.commit()

        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])

        self.assertIsNotNone(event_history_state)
        self.assertEqual(event_history_state["current_signal"], "ledger_payload_blocked")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(event_history_state["authority_ready"])
        self.assertIn("shadow_ledger_missing", event_history_state["blocked_reasons"])

    def test_phase_f_replay_input_authority_state_blocks_shadow_missing(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="replay-shadow-user", username="replay-shadow-user")
        service = PortfolioService(owner_id="replay-shadow-user")

        account = service.create_account(name="Replay Shadow", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-replay-shadow-trade-1",
            dedup_hash="phase-f-replay-shadow-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"]
                )
            )
            session.commit()

        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])

        self.assertIsNotNone(replay_input_state)
        self.assertEqual(replay_input_state["current_signal"], "event_history_blocked")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertIn("shadow_ledger_missing", replay_input_state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_blocks_shadow_missing(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="snapshot-shadow-user", username="snapshot-shadow-user")
        service = PortfolioService(owner_id="snapshot-shadow-user")

        account = service.create_account(name="Snapshot Shadow", broker="IBKR", market="us", base_currency="USD")
        service.record_trade(
            account_id=account["id"],
            symbol="AAPL",
            trade_date=date(2026, 4, 11),
            side="buy",
            quantity=10.0,
            price=150.0,
            fee=1.0,
            tax=0.0,
            market="us",
            currency="USD",
            trade_uid="phase-f-snapshot-shadow-trade-1",
            dedup_hash="phase-f-snapshot-shadow-trade-1",
        )

        with db._phase_f_store.session_scope() as session:
            session.execute(
                delete(PhaseFPortfolioLedger).where(
                    PhaseFPortfolioLedger.portfolio_account_id == account["id"]
                )
            )
            session.commit()

        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(snapshot_cache_state["current_signal"], "event_history_blocked")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertIn("shadow_ledger_missing", snapshot_cache_state["blocked_reasons"])

    def test_phase_f_ledger_event_payload_authority_state_handles_no_events_present(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="prereq-empty-user", username="prereq-empty-user")
        service = PortfolioService(owner_id="prereq-empty-user")

        account = service.create_account(name="Prereq Empty", broker="IBKR", market="us", base_currency="USD")

        authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])
        prerequisite_state = db.get_phase_f_portfolio_prerequisite_state(account_id=account["id"])

        self.assertIsNotNone(authority_state)
        self.assertEqual(authority_state["current_signal"], "no_events_present")
        self.assertFalse(authority_state["payload_parity_observed"])
        self.assertEqual(authority_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(authority_state["authority_ready"])
        self.assertIn("legacy_event_history_missing", authority_state["blocked_reasons"])

        self.assertIsNotNone(prerequisite_state)
        ledger_state = dict(prerequisite_state["categories"]["ledger_event_payload_parity"])
        self.assertEqual(ledger_state["current_signal"], "no_events_present")
        self.assertFalse(ledger_state["payload_parity_observed"])
        self.assertEqual(ledger_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(ledger_state["authority_ready"])
        self.assertIn("legacy_event_history_missing", ledger_state["missing_signals"])

    def test_phase_f_event_history_authority_state_handles_no_events_present(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="event-history-empty-user", username="event-history-empty-user")
        service = PortfolioService(owner_id="event-history-empty-user")

        account = service.create_account(name="Event History Empty", broker="IBKR", market="us", base_currency="USD")

        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])

        self.assertIsNotNone(event_history_state)
        self.assertEqual(event_history_state["current_signal"], "ledger_payload_blocked")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(event_history_state["authority_ready"])
        self.assertIn("legacy_event_history_missing", event_history_state["blocked_reasons"])

    def test_phase_f_replay_input_authority_state_handles_no_events_present(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="replay-empty-user", username="replay-empty-user")
        service = PortfolioService(owner_id="replay-empty-user")

        account = service.create_account(name="Replay Empty", broker="IBKR", market="us", base_currency="USD")

        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])

        self.assertIsNotNone(replay_input_state)
        self.assertEqual(replay_input_state["current_signal"], "event_history_blocked")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertIn("legacy_event_history_missing", replay_input_state["blocked_reasons"])

    def test_phase_f_snapshot_cache_authority_state_handles_no_events_present(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="snapshot-empty-user", username="snapshot-empty-user")
        service = PortfolioService(owner_id="snapshot-empty-user")

        account = service.create_account(name="Snapshot Empty", broker="IBKR", market="us", base_currency="USD")

        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])

        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(snapshot_cache_state["current_signal"], "event_history_blocked")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "blocked")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertIn("legacy_event_history_missing", snapshot_cache_state["blocked_reasons"])

    def test_phase_f_list_accounts_prefers_trusted_pg_metadata_without_legacy_repo_read(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="list-accounts-user", username="list-accounts-user")
        service = PortfolioService(owner_id="list-accounts-user")

        active = service.create_account(name="Active", broker="IBKR", market="us", base_currency="USD")
        service.create_account(name="Inactive", broker="Demo", market="cn", base_currency="CNY")
        service.deactivate_account(active["id"] + 1)

        with patch.object(service.repo, "list_accounts", side_effect=AssertionError("legacy repo list_accounts should not be used")):
            listed = service.list_accounts(include_inactive=True)

        self.assertEqual([item["name"] for item in listed], ["Active", "Inactive"])
        self.assertEqual([item["broker"] for item in listed], ["IBKR", "Demo"])
        self.assertEqual([item["is_active"] for item in listed], [True, False])

    def test_phase_f_list_accounts_falls_back_when_account_metadata_authority_drifts(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="list-accounts-drift-user", username="list-accounts-drift-user")
        service = PortfolioService(owner_id="list-accounts-drift-user")

        account = service.create_account(name="Before Drift", broker="IBKR", market="us", base_currency="USD")

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioAccount).where(PortfolioAccount.id == account["id"]).limit(1)
            ).scalar_one()
            row.name = "After Drift"
            session.commit()

        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])
        self.assertIsNotNone(authority)
        self.assertFalse(authority["effective_readiness"]["account_metadata"])
        self.assertIn("account_row_payload_mismatch", authority["drift_reasons"])

        with patch.object(service.repo, "list_accounts", wraps=service.repo.list_accounts) as repo_list_accounts:
            listed = service.list_accounts(include_inactive=False)

        self.assertEqual(repo_list_accounts.call_count, 1)
        self.assertEqual([item["name"] for item in listed], ["After Drift"])

    def test_phase_f_list_broker_connections_prefers_trusted_pg_metadata_without_legacy_repo_reads(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="bridge-broker-user", username="bridge-broker-user")
        service = PortfolioService(owner_id="bridge-broker-user")

        account_a = service.create_account(name="Primary", broker="IBKR", market="us", base_currency="USD")
        account_b = service.create_account(name="Secondary", broker="Demo", market="cn", base_currency="CNY")
        service.create_broker_connection(
            portfolio_account_id=account_a["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Primary IBKR",
            broker_account_ref="UBRIDGE1",
            import_mode="api",
            sync_metadata={"source": "api"},
        )
        service.create_broker_connection(
            portfolio_account_id=account_b["id"],
            broker_type="citic",
            broker_name="CITIC",
            connection_name="Secondary CITIC",
            broker_account_ref="CBRIDGE2",
            import_mode="file",
            sync_metadata={"source": "csv"},
        )

        with patch.object(service.repo, "get_account", side_effect=AssertionError("legacy repo get_account should not be used")), patch.object(
            service.repo,
            "list_broker_connections",
            side_effect=AssertionError("legacy repo list_broker_connections should not be used"),
        ), patch.object(
            service.repo,
            "list_accounts",
            side_effect=AssertionError("legacy repo list_accounts should not be used"),
        ):
            listed = service.list_broker_connections(portfolio_account_id=account_a["id"], broker_type="ibkr")

        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["portfolio_account_name"], "Primary")
        self.assertEqual(listed[0]["broker_account_ref"], "UBRIDGE1")
        self.assertEqual(listed[0]["sync_metadata"]["source"], "api")

    def test_phase_f_list_broker_connections_falls_back_when_broker_connection_authority_drifts(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="bridge-broker-drift-user", username="bridge-broker-drift-user")
        service = PortfolioService(owner_id="bridge-broker-drift-user")

        account = service.create_account(name="Primary", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Before Drift",
            broker_account_ref="UDRIFT-BRIDGE",
            import_mode="api",
            sync_metadata={"source": "api"},
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioBrokerConnection).where(PortfolioBrokerConnection.id == connection["id"]).limit(1)
            ).scalar_one()
            row.connection_name = "After Drift"
            session.commit()

        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])
        self.assertIsNotNone(authority)
        self.assertFalse(authority["effective_readiness"]["broker_connection_list"])
        self.assertIn("broker_connections_payload_mismatch", authority["drift_reasons"])

        with patch.object(service.repo, "get_account", wraps=service.repo.get_account) as repo_get_account, patch.object(
            service.repo,
            "list_broker_connections",
            wraps=service.repo.list_broker_connections,
        ) as repo_list_connections:
            listed = service.list_broker_connections(portfolio_account_id=account["id"], broker_type="ibkr")

        self.assertGreaterEqual(repo_get_account.call_count, 1)
        self.assertEqual(repo_list_connections.call_count, 1)
        self.assertEqual([item["connection_name"] for item in listed], ["After Drift"])

    def test_phase_f_get_latest_broker_sync_state_prefers_trusted_pg_overlay_without_legacy_repo_reads(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="bridge-sync-user", username="bridge-sync-user")
        service = PortfolioService(owner_id="bridge-sync-user")

        account = service.create_account(name="Sync Overlay", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Sync Overlay IBKR",
            broker_account_ref="USYNC0001",
            import_mode="api",
            sync_metadata={"source": "overlay"},
        )
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="USYNC0001",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 19),
            synced_at=datetime(2026, 4, 19, 9, 30, 0),
            base_currency="USD",
            total_cash=1250.0,
            total_market_value=2750.0,
            total_equity=4000.0,
            realized_pnl=50.0,
            unrealized_pnl=125.0,
            fx_stale=False,
            payload={"slice": "latest-sync"},
            positions=[
                {
                    "broker_position_ref": "AAPL-OVERLAY",
                    "symbol": "AAPL",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 10.0,
                    "avg_cost": 150.0,
                    "last_price": 165.0,
                    "market_value_base": 1650.0,
                    "unrealized_pnl_base": 150.0,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[
                {"currency": "USD", "amount": 1250.0, "amount_base": 1250.0},
                {"currency": "HKD", "amount": 3900.0, "amount_base": 500.0},
            ],
        )

        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])
        self.assertIsNotNone(authority)
        self.assertTrue(authority["effective_readiness"]["latest_sync_overlay"])

        with patch.object(
            service.repo,
            "get_latest_broker_sync_state_for_account",
            side_effect=AssertionError("legacy repo latest sync state should not be used"),
        ), patch.object(
            service.repo,
            "list_broker_sync_positions",
            side_effect=AssertionError("legacy repo sync positions should not be used"),
        ), patch.object(
            service.repo,
            "list_broker_sync_cash_balances",
            side_effect=AssertionError("legacy repo sync cash balances should not be used"),
        ):
            latest_sync = service.get_latest_broker_sync_state(portfolio_account_id=account["id"])

        self.assertIsNotNone(latest_sync)
        self.assertEqual(latest_sync["broker_connection_id"], connection["id"])
        self.assertEqual(latest_sync["snapshot_date"], "2026-04-19")
        self.assertEqual(latest_sync["payload"]["slice"], "latest-sync")
        self.assertEqual([item["symbol"] for item in latest_sync["positions"]], ["AAPL"])
        self.assertEqual([item["currency"] for item in latest_sync["cash_balances"]], ["HKD", "USD"])

    def test_phase_f_get_latest_broker_sync_state_falls_back_when_latest_sync_overlay_authority_drifts(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="bridge-sync-drift-user", username="bridge-sync-drift-user")
        service = PortfolioService(owner_id="bridge-sync-drift-user")

        account = service.create_account(name="Sync Drift", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Sync Drift IBKR",
            broker_account_ref="UDRIFT-SYNC",
            import_mode="api",
        )
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="UDRIFT-SYNC",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 19),
            synced_at=datetime(2026, 4, 19, 11, 0, 0),
            base_currency="USD",
            total_cash=800.0,
            total_market_value=1200.0,
            total_equity=2000.0,
            realized_pnl=0.0,
            unrealized_pnl=40.0,
            fx_stale=False,
            payload={"slice": "before-drift"},
            positions=[
                {
                    "broker_position_ref": "MSFT-OVERLAY",
                    "symbol": "MSFT",
                    "market": "us",
                    "currency": "USD",
                    "quantity": 4.0,
                    "avg_cost": 250.0,
                    "last_price": 260.0,
                    "market_value_base": 1040.0,
                    "unrealized_pnl_base": 40.0,
                    "valuation_currency": "USD",
                }
            ],
            cash_balances=[{"currency": "USD", "amount": 800.0, "amount_base": 800.0}],
        )

        with db.get_session() as session:
            row = session.execute(
                select(PortfolioBrokerSyncState).where(
                    PortfolioBrokerSyncState.portfolio_account_id == account["id"]
                ).limit(1)
            ).scalar_one()
            row.total_equity = 2100.0
            session.commit()

        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])
        self.assertIsNotNone(authority)
        self.assertFalse(authority["effective_readiness"]["latest_sync_overlay"])
        self.assertIn("sync_state_payload_mismatch", authority["drift_reasons"])

        with patch.object(
            service.repo,
            "get_latest_broker_sync_state_for_account",
            wraps=service.repo.get_latest_broker_sync_state_for_account,
        ) as repo_get_latest_sync_state, patch.object(
            service.repo,
            "list_broker_sync_positions",
            wraps=service.repo.list_broker_sync_positions,
        ) as repo_list_positions, patch.object(
            service.repo,
            "list_broker_sync_cash_balances",
            wraps=service.repo.list_broker_sync_cash_balances,
        ) as repo_list_cash_balances:
            latest_sync = service.get_latest_broker_sync_state(portfolio_account_id=account["id"])

        self.assertEqual(repo_get_latest_sync_state.call_count, 1)
        self.assertEqual(repo_list_positions.call_count, 1)
        self.assertEqual(repo_list_cash_balances.call_count, 1)
        self.assertIsNotNone(latest_sync)
        self.assertAlmostEqual(float(latest_sync["total_equity"]), 2100.0, places=6)
        self.assertEqual([item["symbol"] for item in latest_sync["positions"]], ["MSFT"])


if __name__ == "__main__":
    unittest.main()
