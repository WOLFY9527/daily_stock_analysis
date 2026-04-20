# -*- coding: utf-8 -*-
"""Real PostgreSQL validation for the Phase F portfolio baseline."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine, text

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
from src.storage import DatabaseManager

REAL_PG_DSN = str(os.getenv("POSTGRES_PHASE_A_REAL_DSN") or "").strip()


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


@unittest.skipUnless(REAL_PG_DSN, "POSTGRES_PHASE_A_REAL_DSN is required for real PostgreSQL validation")
class PostgresPhaseFRealPgTestCase(unittest.TestCase):
    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.env_path = self.data_dir / ".env"
        self.sqlite_db_path = self.data_dir / "legacy.sqlite"
        self.pg_engine = create_engine(REAL_PG_DSN, echo=False, pool_pre_ping=True)
        self._drop_phase_f_tables()
        self._configure_environment()

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        os.environ.pop("POSTGRES_PHASE_A_URL", None)
        os.environ.pop("POSTGRES_PHASE_A_APPLY_SCHEMA", None)
        self._drop_phase_f_tables()
        self.pg_engine.dispose()
        self.temp_dir.cleanup()

    def _configure_environment(self) -> None:
        lines = [
            "STOCK_LIST=600519",
            "GEMINI_API_KEY=test",
            "ADMIN_AUTH_ENABLED=true",
            f"DATABASE_PATH={self.sqlite_db_path}",
            f"POSTGRES_PHASE_A_URL={REAL_PG_DSN}",
            "POSTGRES_PHASE_A_APPLY_SCHEMA=true",
        ]
        self.env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.sqlite_db_path)
        os.environ["POSTGRES_PHASE_A_URL"] = REAL_PG_DSN
        os.environ["POSTGRES_PHASE_A_APPLY_SCHEMA"] = "true"
        Config.reset_instance()
        DatabaseManager.reset_instance()
        auth.refresh_auth_state()

    def _db(self) -> DatabaseManager:
        return DatabaseManager.get_instance()

    def _drop_phase_f_tables(self) -> None:
        with self.pg_engine.begin() as conn:
            conn.execute(text("drop table if exists portfolio_sync_cash_balances cascade"))
            conn.execute(text("drop table if exists portfolio_sync_positions cascade"))
            conn.execute(text("drop table if exists portfolio_sync_states cascade"))
            conn.execute(text("drop table if exists portfolio_positions cascade"))
            conn.execute(text("drop table if exists portfolio_ledger cascade"))
            conn.execute(text("drop table if exists broker_connections cascade"))
            conn.execute(text("drop table if exists portfolio_accounts cascade"))

    def _pg_scalar(self, sql: str, **params):
        with self.pg_engine.begin() as conn:
            return conn.execute(text(sql), params).scalar()

    def test_real_postgres_phase_f_portfolio_round_trip(self) -> None:
        db = self._db()
        db.create_or_update_app_user(user_id="real-pg-phase-f-user", username="real-pg-phase-f-user")
        service = PortfolioService(owner_id="real-pg-phase-f-user")

        account = service.create_account(name="Real PG", broker="IBKR", market="us", base_currency="USD")
        connection = service.create_broker_connection(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_name="Interactive Brokers",
            connection_name="Real PG IBKR",
            broker_account_ref="U8888888",
            import_mode="file",
            sync_metadata={"source": "flex"},
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
            trade_uid="real-pg-trade-1",
            dedup_hash="real-pg-trade-1",
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
        service.replace_broker_sync_state(
            broker_connection_id=connection["id"],
            portfolio_account_id=account["id"],
            broker_type="ibkr",
            broker_account_ref="U8888888",
            sync_source="api",
            sync_status="success",
            snapshot_date=date(2026, 4, 16),
            synced_at=datetime(2026, 4, 16, 8, 45, 0),
            base_currency="USD",
            total_cash=1000.0,
            total_market_value=1600.0,
            total_equity=2600.0,
            realized_pnl=0.0,
            unrealized_pnl=100.0,
            fx_stale=False,
            payload={"snapshot": "real-pg"},
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
        authority = db.get_phase_f_portfolio_shadow_authority_state(account_id=account["id"])
        ledger_authority_state = db.get_phase_f_ledger_event_payload_authority_state(account_id=account["id"])
        event_history_state = db.get_phase_f_event_history_authority_state(account_id=account["id"])
        replay_input_state = db.get_phase_f_replay_input_authority_state(account_id=account["id"])
        snapshot_cache_state = db.get_phase_f_snapshot_cache_authority_state(account_id=account["id"])
        effective_authority_summary = db.get_phase_f_effective_authority_summary(account_id=account["id"])
        event_history_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="event_history_authority",
        )
        replay_input_gate = db.get_phase_f_domain_readiness_gate(
            account_id=account["id"],
            target_domain="replay_input_authority",
        )
        prerequisite_state = db.get_phase_f_portfolio_prerequisite_state(account_id=account["id"])

        self.assertEqual(self._pg_scalar("select count(*) from portfolio_accounts"), 1)
        self.assertEqual(self._pg_scalar("select count(*) from broker_connections"), 1)
        self.assertEqual(self._pg_scalar("select count(*) from portfolio_ledger"), 2)
        self.assertEqual(self._pg_scalar("select count(*) from portfolio_positions"), 1)
        self.assertEqual(self._pg_scalar("select count(*) from portfolio_sync_states"), 1)
        self.assertEqual(self._pg_scalar("select count(*) from portfolio_sync_positions"), 1)
        self.assertEqual(self._pg_scalar("select count(*) from portfolio_sync_cash_balances"), 1)
        self.assertEqual([item["broker_account_ref"] for item in shadow["broker_connections"]], ["U8888888"])
        self.assertTrue(authority["effective_readiness"]["broker_connection_list"])
        self.assertTrue(authority["effective_readiness"]["latest_sync_overlay"])
        with patch.object(service.repo, "list_accounts", side_effect=AssertionError("legacy repo list_accounts should not be used")):
            listed_accounts = service.list_accounts(include_inactive=True)
        self.assertEqual([item["name"] for item in listed_accounts], ["Real PG"])
        with patch.object(service.repo, "get_account", side_effect=AssertionError("legacy repo get_account should not be used")), patch.object(
            service.repo,
            "list_broker_connections",
            side_effect=AssertionError("legacy repo list_broker_connections should not be used"),
        ), patch.object(
            service.repo,
            "list_accounts",
            side_effect=AssertionError("legacy repo list_accounts should not be used"),
        ):
            listed_connections = service.list_broker_connections(portfolio_account_id=account["id"], broker_type="ibkr")
        self.assertEqual([item["portfolio_account_name"] for item in listed_connections], ["Real PG"])
        self.assertEqual([item["broker_account_ref"] for item in listed_connections], ["U8888888"])
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
        self.assertEqual([item["symbol"] for item in latest_sync["positions"]], ["AAPL"])
        self.assertEqual([item["currency"] for item in latest_sync["cash_balances"]], ["USD"])
        self.assertIsNotNone(ledger_authority_state)
        self.assertEqual(ledger_authority_state["current_signal"], "payload_parity_observed")
        self.assertEqual(ledger_authority_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(ledger_authority_state["authority_ready"])
        self.assertFalse(ledger_authority_state["runtime_cutover_ready"])
        self.assertIn("event_history_domain_authority_layer_required", ledger_authority_state["downstream_blockers"])
        self.assertIsNotNone(event_history_state)
        self.assertEqual(event_history_state["current_signal"], "prerequisite_ready")
        self.assertEqual(event_history_state["authority_prerequisite_state"], "authority_ready")
        self.assertTrue(event_history_state["authority_ready"])
        self.assertFalse(event_history_state["runtime_cutover_ready"])
        self.assertIn("runtime_pg_event_history_read_cutover_not_enabled", event_history_state["downstream_blockers"])
        self.assertIsNotNone(replay_input_state)
        self.assertEqual(replay_input_state["current_signal"], "replay_specific_gaps_observed")
        self.assertEqual(replay_input_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(replay_input_state["authority_ready"])
        self.assertFalse(replay_input_state["runtime_cutover_ready"])
        self.assertIn("cost_method_specific_authority_missing", replay_input_state["blocked_reasons"])
        self.assertIn("lot_authority_missing", replay_input_state["blocked_reasons"])
        self.assertIn("as_of_replay_boundary_missing", replay_input_state["blocked_reasons"])
        self.assertIn("runtime_pg_replay_input_cutover_not_enabled", replay_input_state["downstream_blockers"])
        self.assertIsNotNone(snapshot_cache_state)
        self.assertEqual(snapshot_cache_state["current_signal"], "snapshot_specific_gaps_observed")
        self.assertEqual(snapshot_cache_state["authority_prerequisite_state"], "observed_only")
        self.assertFalse(snapshot_cache_state["authority_ready"])
        self.assertFalse(snapshot_cache_state["runtime_cutover_ready"])
        self.assertIn("snapshot_projection_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("lot_projection_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("snapshot_freshness_invalidation_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("valuation_semantic_authority_missing", snapshot_cache_state["blocked_reasons"])
        self.assertIn("runtime_pg_snapshot_cache_cutover_not_enabled", snapshot_cache_state["downstream_blockers"])
        self.assertIsNotNone(effective_authority_summary)
        self.assertEqual(effective_authority_summary["authority_model"], "phase_f_effective_authority_summary_v1")
        self.assertEqual(effective_authority_summary["highest_roi_category"], "ledger_event_payload_parity")
        self.assertEqual(effective_authority_summary["foundational_boundary"]["domain"], "ledger_event_payload_parity")
        self.assertEqual(effective_authority_summary["next_unmet_boundary"]["domain"], "replay_input_authority")
        self.assertFalse(effective_authority_summary["effective_readiness"]["runtime_cutover_ready"])
        self.assertIsNotNone(event_history_gate)
        self.assertEqual(event_history_gate["gate_model"], "phase_f_domain_readiness_gate_v1")
        self.assertEqual(event_history_gate["gate_status"], "design_prerequisite_ready")
        self.assertTrue(event_history_gate["design_prerequisite_ready"])
        self.assertEqual(event_history_gate["next_unmet_boundary"], None)
        self.assertFalse(event_history_gate["runtime_cutover_ready"])
        self.assertIsNotNone(replay_input_gate)
        self.assertEqual(replay_input_gate["gate_status"], "domain_specific_blocked")
        self.assertFalse(replay_input_gate["design_prerequisite_ready"])
        self.assertFalse(replay_input_gate["upstream_blocked"])
        self.assertTrue(replay_input_gate["has_domain_specific_blockers"])
        self.assertEqual(replay_input_gate["next_unmet_boundary"]["domain"], "replay_input_authority")
        self.assertFalse(replay_input_gate["runtime_cutover_ready"])
        self.assertIsNotNone(prerequisite_state)
        self.assertEqual(prerequisite_state["highest_roi_category"], "ledger_event_payload_parity")
        self.assertEqual(
            prerequisite_state["effective_authority_summary"]["authority_model"],
            "phase_f_effective_authority_summary_v1",
        )
        self.assertEqual(
            prerequisite_state["categories"]["ledger_event_payload_parity"]["current_signal"],
            "payload_parity_observed",
        )
        self.assertTrue(prerequisite_state["categories"]["ledger_event_payload_parity"]["authority_ready"])
        self.assertTrue(prerequisite_state["event_history_authority"]["authority_ready"])
        self.assertFalse(prerequisite_state["replay_input_authority"]["authority_ready"])
        self.assertFalse(prerequisite_state["snapshot_cache_authority"]["authority_ready"])
        self.assertFalse(prerequisite_state["categories"]["snapshot_cache_freshness_parity"]["authority_ready"])
        self.assertFalse(prerequisite_state["categories"]["replay_input_parity"]["authority_ready"])

        with db._phase_f_store.session_scope() as session:
            self.assertEqual(session.query(PhaseFPortfolioAccount).count(), 1)
            self.assertEqual(session.query(PhaseFBrokerConnection).count(), 1)
            self.assertEqual(session.query(PhaseFPortfolioLedger).count(), 2)
            self.assertEqual(session.query(PhaseFPortfolioPosition).count(), 1)
            self.assertEqual(session.query(PhaseFPortfolioSyncState).count(), 1)
            self.assertEqual(session.query(PhaseFPortfolioSyncPosition).count(), 1)
            self.assertEqual(session.query(PhaseFPortfolioSyncCashBalance).count(), 1)


if __name__ == "__main__":
    unittest.main()
