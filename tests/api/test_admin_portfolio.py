# -*- coding: utf-8 -*-
"""Admin portfolio visibility API contract tests."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select

import src.auth as auth
from api.deps import CurrentUser, get_current_user
from src.admin_rbac import OPS_ADMIN_ROLE
from src.multi_user import BOOTSTRAP_ADMIN_USER_ID
from src.storage import (
    AdminUserRole,
    AppUser,
    DatabaseManager,
    ExecutionLogSession,
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
)
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.portfolio_service import PortfolioService


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._password_hash_value = None
    auth._rate_limit = {}
    auth._admin_reauth_markers = {}


def _admin_user(
    user_id: str = BOOTSTRAP_ADMIN_USER_ID,
    *,
    admin_capabilities: tuple[str, ...] | None = None,
) -> CurrentUser:
    effective_capabilities = admin_capabilities
    if effective_capabilities is None and user_id == BOOTSTRAP_ADMIN_USER_ID:
        effective_capabilities = ("users:portfolio:read",)
    return CurrentUser(
        user_id=user_id,
        username="admin" if user_id == BOOTSTRAP_ADMIN_USER_ID else user_id,
        display_name="Admin",
        role="admin",
        is_admin=True,
        is_authenticated=True,
        transitional=False,
        auth_enabled=True,
        session_id="admin-session-raw",
        admin_capabilities=tuple(effective_capabilities or ()),
    )


def _regular_user() -> CurrentUser:
    return CurrentUser(
        user_id="user-1",
        username="alice",
        display_name="Alice",
        role="user",
        is_admin=False,
        is_authenticated=True,
        transitional=False,
        auth_enabled=True,
        session_id="user-session-raw",
    )


class AdminPortfolioApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        _reset_auth_globals()
        DatabaseManager.reset_instance()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "admin_portfolio.db"
        self.db = DatabaseManager(db_url=f"sqlite:///{self.db_path}")

        from api.v1.endpoints import admin_portfolio
        from api.v1.endpoints import portfolio

        self.env_patch = patch.dict(
            os.environ,
            {
                "DATABASE_PATH": str(self.db_path),
                "ADMIN_AUTH_ENABLED": "true",
            },
            clear=False,
        )
        self.auth_enabled_patch = patch.object(auth, "_is_auth_enabled_from_env", return_value=True)
        self.env_patch.start()
        self.auth_enabled_patch.start()
        auth._auth_enabled = True

        self.app = FastAPI()
        self.app.include_router(portfolio.router, prefix="/api/v1/portfolio")
        self.app.include_router(admin_portfolio.router, prefix="/api/v1/admin")
        self.client = TestClient(self.app)
        self.now = datetime.now()
        self._seed_data()

    def tearDown(self) -> None:
        self.client.close()
        self.app.dependency_overrides.clear()
        self.auth_enabled_patch.stop()
        self.env_patch.stop()
        DatabaseManager.reset_instance()
        _reset_auth_globals()
        self.temp_dir.cleanup()

    def _seed_data(self) -> None:
        self.db.create_or_update_app_user(
            user_id=BOOTSTRAP_ADMIN_USER_ID,
            username="admin",
            display_name="Admin",
            role="admin",
            password_hash="pbkdf2:admin-secret-hash",
            is_active=True,
        )
        self.db.create_or_update_app_user(
            user_id="user-1",
            username="alice",
            display_name="Alice Analyst",
            role="user",
            password_hash="pbkdf2:user-secret-hash",
            is_active=True,
        )
        self.db.create_or_update_app_user(
            user_id="ops-admin-1",
            username="ops-admin",
            display_name="Ops Admin",
            role="admin",
            password_hash="pbkdf2:ops-secret-hash",
            is_active=True,
        )
        self.db.create_or_update_app_user(
            user_id="user-2",
            username="bob",
            display_name="Bob Other",
            role="user",
            password_hash="pbkdf2:other-secret-hash",
            is_active=True,
        )
        with self.db.get_session() as session:
            session.add(AdminUserRole(user_id="ops-admin-1", role_key=OPS_ADMIN_ROLE))
            account_a = PortfolioAccount(
                owner_id="user-1",
                name="Alice Main",
                broker="IBKR",
                market="us",
                base_currency="USD",
                is_active=True,
                created_at=self.now - timedelta(days=5),
                updated_at=self.now - timedelta(days=1),
            )
            account_b = PortfolioAccount(
                owner_id="user-2",
                name="Bob Main",
                broker="IBKR",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add_all([account_a, account_b])
            session.flush()
            self.account_a_id = int(account_a.id)
            self.account_b_id = int(account_b.id)

            connection_a = PortfolioBrokerConnection(
                owner_id="user-1",
                portfolio_account_id=self.account_a_id,
                broker_type="ibkr",
                broker_name="Interactive Brokers",
                connection_name="Alice IBKR",
                broker_account_ref="RAW-BROKER-SECRET-ACCOUNT-123456",
                import_mode="api",
                status="active",
                last_imported_at=self.now - timedelta(days=2),
                last_import_source="ibkr_flex_xml",
                last_import_fingerprint="raw-import-fingerprint-secret",
                sync_metadata_json=json.dumps(
                    {
                        "api_key": "SECRET_API_KEY",
                        "access_token": "ACCESS_TOKEN_SECRET",
                        "refresh_token": "REFRESH_TOKEN_SECRET",
                        "session_token": "SESSION_TOKEN_SECRET",
                        "sync_metadata_secret": "SYNC_METADATA_SECRET",
                        "brokerOrderPayload": "ORDER_PAYLOAD_SECRET",
                        "place_order": "PLACE_ORDER_SECRET",
                        "brokerRequestId": "BROKER_REQUEST_ID_MUST_NOT_LEAK",
                        "orderId": "BROKER_ORDER_ID_MUST_NOT_LEAK",
                        "brokerApiUrl": "https://broker.example.invalid/accounts/RAW-BROKER-SECRET-ACCOUNT-123456",
                        "accountMetadata": {"label": "BROKER_ACCOUNT_LABEL_MUST_NOT_LEAK"},
                        "raw": {
                            "token": "SECRET_TOKEN",
                            "provider_payload": "RAW_PROVIDER_PAYLOAD_SECRET",
                        },
                    }
                ),
                created_at=self.now - timedelta(days=5),
                updated_at=self.now - timedelta(days=1),
            )
            connection_b = PortfolioBrokerConnection(
                owner_id="user-2",
                portfolio_account_id=self.account_b_id,
                broker_type="ibkr",
                broker_name="Interactive Brokers",
                connection_name="Bob IBKR",
                broker_account_ref="BOB-RAW-BROKER-ACCOUNT",
                import_mode="api",
                status="active",
            )
            session.add_all([connection_a, connection_b])
            session.flush()
            self.connection_a_id = int(connection_a.id)
            self.connection_b_id = int(connection_b.id)

            session.add_all(
                [
                    PortfolioBrokerSyncState(
                        owner_id="user-1",
                        broker_connection_id=self.connection_a_id,
                        portfolio_account_id=self.account_a_id,
                        broker_type="ibkr",
                        broker_account_ref="RAW-BROKER-SECRET-ACCOUNT-123456",
                        sync_source="api",
                        sync_status="success",
                        snapshot_date=date(2026, 5, 5),
                        synced_at=self.now - timedelta(hours=3),
                        base_currency="USD",
                        total_cash=Decimal("1000"),
                        total_market_value=Decimal("2500"),
                        total_equity=Decimal("3500"),
                        realized_pnl=Decimal("120"),
                        unrealized_pnl=Decimal("300"),
                        fx_stale=False,
                        payload_json=json.dumps(
                            {
                                "access_token": "ACCESS_TOKEN_SECRET",
                                "refresh_token": "REFRESH_TOKEN_SECRET",
                                "session_token": "SESSION_TOKEN_SECRET",
                                "brokerOrderPayload": "ORDER_PAYLOAD_SECRET",
                                "execute_order": "EXECUTE_ORDER_SECRET",
                                "requestId": "BROKER_REQUEST_ID_MUST_NOT_LEAK",
                                "executionPayload": "BROKER_EXECUTION_PAYLOAD_MUST_NOT_LEAK",
                                "apiBaseUrl": "https://broker.example.invalid/orders/BROKER_ORDER_ID_MUST_NOT_LEAK",
                                "provider_payload": "RAW_PROVIDER_PAYLOAD_SECRET",
                                "positions": [{"raw": True}],
                            }
                        ),
                    ),
                    PortfolioBrokerSyncState(
                        owner_id="user-2",
                        broker_connection_id=self.connection_b_id,
                        portfolio_account_id=self.account_b_id,
                        broker_type="ibkr",
                        broker_account_ref="BOB-RAW-BROKER-ACCOUNT",
                        sync_source="api",
                        sync_status="success",
                        snapshot_date=date(2026, 5, 5),
                        synced_at=self.now - timedelta(hours=2),
                        base_currency="USD",
                        total_cash=Decimal("9999"),
                        total_market_value=Decimal("9999"),
                        total_equity=Decimal("19998"),
                        realized_pnl=Decimal("0"),
                        unrealized_pnl=Decimal("0"),
                        fx_stale=False,
                        payload_json='{"token": "BOB_SECRET_TOKEN"}',
                    ),
                    PortfolioBrokerSyncPosition(
                        owner_id="user-1",
                        broker_connection_id=self.connection_a_id,
                        portfolio_account_id=self.account_a_id,
                        broker_position_ref="RAW-POSITION-SECRET",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        quantity=Decimal("10"),
                        avg_cost=Decimal("150"),
                        last_price=Decimal("180"),
                        market_value_base=Decimal("1800"),
                        unrealized_pnl_base=Decimal("300"),
                        valuation_currency="USD",
                        payload_json=json.dumps(
                            {
                                "secret": "POSITION_SECRET",
                                "provider_payload": "RAW_PROVIDER_PAYLOAD_SECRET",
                            }
                        ),
                    ),
                    PortfolioBrokerSyncPosition(
                        owner_id="user-2",
                        broker_connection_id=self.connection_b_id,
                        portfolio_account_id=self.account_b_id,
                        broker_position_ref="BOB-POSITION-SECRET",
                        symbol="MSFT",
                        market="us",
                        currency="USD",
                        quantity=Decimal("99"),
                        avg_cost=Decimal("1"),
                        last_price=Decimal("2"),
                        market_value_base=Decimal("198"),
                        unrealized_pnl_base=Decimal("99"),
                        valuation_currency="USD",
                        payload_json='{"secret": "BOB_POSITION_SECRET"}',
                    ),
                    PortfolioBrokerSyncCashBalance(
                        owner_id="user-1",
                        broker_connection_id=self.connection_a_id,
                        portfolio_account_id=self.account_a_id,
                        currency="USD",
                        amount=Decimal("1000"),
                        amount_base=Decimal("1000"),
                    ),
                    PortfolioTrade(
                        account_id=self.account_a_id,
                        trade_uid="alice-trade-secret-uid",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        trade_date=date(2026, 5, 1),
                        side="buy",
                        quantity=Decimal("10"),
                        price=Decimal("150"),
                        fee=Decimal("1"),
                        tax=Decimal("0"),
                        note="raw note with SECRET_TOKEN ACCESS_TOKEN_SECRET SESSION_TOKEN_SECRET",
                        dedup_hash="raw-dedup-secret",
                        is_active=True,
                    ),
                    PortfolioCashLedger(
                        account_id=self.account_a_id,
                        event_date=date(2026, 5, 2),
                        direction="in",
                        amount=Decimal("1000"),
                        currency="USD",
                        note="cash secret note REFRESH_TOKEN_SECRET",
                    ),
                    PortfolioCorporateAction(
                        account_id=self.account_a_id,
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        effective_date=date(2026, 5, 3),
                        action_type="cash_dividend",
                        cash_dividend_per_share=Decimal("0.24"),
                        note="corporate secret note SYNC_METADATA_SECRET",
                    ),
                    PortfolioDailySnapshot(
                        account_id=self.account_a_id,
                        snapshot_date=date(2026, 5, 5),
                        cost_method="fifo",
                        base_currency="USD",
                        total_cash=Decimal("1000"),
                        total_market_value=Decimal("1800"),
                        total_equity=Decimal("2800"),
                        unrealized_pnl=Decimal("300"),
                        realized_pnl=Decimal("120"),
                        fx_stale=False,
                        payload='{"secret": "SNAPSHOT_SECRET"}',
                    ),
                    PortfolioPosition(
                        account_id=self.account_a_id,
                        cost_method="fifo",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        quantity=Decimal("10"),
                        avg_cost=Decimal("150"),
                        total_cost=Decimal("1500"),
                        last_price=Decimal("180"),
                        market_value_base=Decimal("1800"),
                        unrealized_pnl_base=Decimal("300"),
                        valuation_currency="USD",
                    ),
                ]
            )
            session.commit()

    def _as_admin(self, user_id: str = BOOTSTRAP_ADMIN_USER_ID) -> None:
        self.app.dependency_overrides[get_current_user] = lambda: _admin_user(user_id)

    def _as_user(self) -> None:
        self.app.dependency_overrides[get_current_user] = _regular_user

    def _as_member(self, user_id: str) -> None:
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            user_id=user_id,
            username=user_id,
            display_name=user_id,
            role="user",
            is_admin=False,
            is_authenticated=True,
            transitional=False,
            auth_enabled=True,
            session_id=f"{user_id}-session",
        )

    @staticmethod
    def _json_text(response) -> str:
        return json.dumps(response.json(), ensure_ascii=False, sort_keys=True)

    def _count(self, model) -> int:
        from sqlalchemy import func, select

        with self.db.get_session() as session:
            return int(session.execute(select(func.count()).select_from(model)).scalar() or 0)

    def _portfolio_counts(self) -> dict[str, int]:
        return {
            "accounts": self._count(PortfolioAccount),
            "connections": self._count(PortfolioBrokerConnection),
            "states": self._count(PortfolioBrokerSyncState),
            "positions": self._count(PortfolioBrokerSyncPosition),
            "valuation_positions": self._count(PortfolioPosition),
            "valuation_lots": self._count(PortfolioPositionLot),
            "daily_snapshots": self._count(PortfolioDailySnapshot),
            "cash": self._count(PortfolioCashLedger),
            "trades": self._count(PortfolioTrade),
            "actions": self._count(PortfolioCorporateAction),
        }

    def _assert_safe_json(self, response) -> None:
        text = self._json_text(response)
        forbidden = [
            "RAW-BROKER-SECRET-ACCOUNT-123456",
            "RAW-POSITION-SECRET",
            "raw-import-fingerprint-secret",
            "raw-dedup-secret",
            "alice-trade-secret-uid",
            "ACCESS_TOKEN_SECRET",
            "REFRESH_TOKEN_SECRET",
            "SESSION_TOKEN_SECRET",
            "SECRET_TOKEN",
            "SECRET_API_KEY",
            "RAW_PROVIDER_PAYLOAD_SECRET",
            "SYNC_METADATA_SECRET",
            "ORDER_PAYLOAD_SECRET",
            "PLACE_ORDER_SECRET",
            "EXECUTE_ORDER_SECRET",
            "BROKER_REQUEST_ID_MUST_NOT_LEAK",
            "BROKER_ORDER_ID_MUST_NOT_LEAK",
            "BROKER_ACCOUNT_LABEL_MUST_NOT_LEAK",
            "BROKER_EXECUTION_PAYLOAD_MUST_NOT_LEAK",
            "broker.example.invalid",
            "POSITION_SECRET",
            "SNAPSHOT_SECRET",
            "BOB_SECRET_TOKEN",
            "BOB_POSITION_SECRET",
            "BOB-RAW-BROKER-ACCOUNT",
            "BOB-POSITION-SECRET",
            "sync_metadata_json",
            "payload_json",
            "payloadJson",
            "broker_account_ref",
            "brokerAccountRef",
            "brokerPositionRef",
            "brokerOrderPayload",
            "brokerRequestId",
            "accountMetadata",
            "executionPayload",
            "apiBaseUrl",
            "execute_order",
            "order_payload",
            "place_order",
            "submit_order",
            "syncMetadata",
            "password_hash",
            "pbkdf2:ops-secret-hash",
            "admin-session-raw",
            "user-session-raw",
            "frontend_authoritative_accounting",
            "ui_authoritative_accounting",
            "client_authoritative_accounting",
            "frontend_mutation_authority",
            "ui_mutation_authority",
            "client_mutation_authority",
        ]
        for needle in forbidden:
            self.assertNotIn(needle, text)

    def _seed_parity_account(
        self,
        *,
        user_id: str,
        symbol: str,
        close: Decimal,
    ) -> int:
        self.db.create_or_update_app_user(
            user_id=user_id,
            username=user_id,
            display_name=user_id,
            role="user",
            password_hash=f"pbkdf2:{user_id}-hash",
            is_active=True,
        )
        with self.db.get_session() as session:
            account = PortfolioAccount(
                owner_id=user_id,
                name=f"{user_id} account",
                broker="Demo",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add(account)
            session.flush()
            account_id = int(account.id)
            session.commit()

        service = PortfolioService(repo=PortfolioRepository(self.db), owner_id=user_id)
        service.record_trade(
            account_id=account_id,
            symbol=symbol,
            trade_date=date(2026, 5, 1),
            side="buy",
            quantity=Decimal("1"),
            price=Decimal("100"),
            market="us",
            currency="USD",
        )
        self.db.save_daily_data(
            pd.DataFrame(
                [
                    {
                        "date": date(2026, 5, 5),
                        "open": close,
                        "high": close,
                        "low": close,
                        "close": close,
                        "volume": 1.0,
                        "amount": close,
                        "pct_chg": 0.0,
                    }
                ]
            ),
            code=symbol,
            data_source="admin-parity-fixture",
        )
        return account_id

    def _assert_audit_event(self, action: str) -> None:
        with self.db.get_session() as session:
            rows = (
                session.query(ExecutionLogSession)
                .filter(ExecutionLogSession.task_id == action)
                .all()
            )
        self.assertEqual(len(rows), 1)
        text = json.dumps(rows[0].summary_json, ensure_ascii=False)
        self.assertIn("user-1", text)
        self.assertIn("admin", text)
        self.assertNotIn("SECRET_TOKEN", text)
        self.assertNotIn("RAW-BROKER-SECRET-ACCOUNT-123456", text)
        self.assertNotIn("sync_metadata_json", text)
        self.assertNotIn("payload_json", text)

    def test_admin_required_for_portfolio_visibility(self) -> None:
        unauthenticated = self.client.get("/api/v1/admin/users/user-1/portfolio-summary")
        self.assertEqual(unauthenticated.status_code, 401)

        self._as_user()
        forbidden = self.client.get("/api/v1/admin/users/user-1/portfolio-summary")
        self.assertEqual(forbidden.status_code, 403)

    def test_admin_without_portfolio_read_capability_is_denied_safely_and_read_only(self) -> None:
        self._as_admin("ops-admin-1")
        before = self._portfolio_counts()

        response = self.client.get("/api/v1/admin/users/user-1/portfolio-summary")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["error"], "admin_capability_required")
        self.assertEqual(self._portfolio_counts(), before)
        self._assert_safe_json(response)

    def test_missing_target_user_returns_404(self) -> None:
        self._as_admin()
        response = self.client.get("/api/v1/admin/users/missing-user/portfolio-summary")
        self.assertEqual(response.status_code, 404)

    def test_portfolio_summary_returns_target_user_safe_aggregates_and_audit(self) -> None:
        with self.db.get_session() as session:
            session.add(
                PortfolioAccount(
                    owner_id="user-1",
                    name="Inactive history",
                    broker="Demo",
                    market="us",
                    base_currency="USD",
                    is_active=False,
                )
            )
            session.commit()

        self._as_admin()
        before = self._portfolio_counts()

        response = self.client.get(
            "/api/v1/admin/users/user-1/portfolio-summary",
            params={"as_of": "2026-05-05", "include_inactive": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["userId"], "user-1")
        self.assertEqual(payload["accountCount"], 2)
        self.assertEqual(payload["activeAccountCount"], 1)
        self.assertEqual(payload["valuationScope"], "active_accounts_only")
        self.assertEqual(payload["valuationAccountCount"], 1)
        self.assertIn("inactive_accounts_excluded_from_valuation", payload["limitations"])
        self.assertEqual(payload["ledgerCounts"], {"trades": 1, "cashEvents": 1, "corporateActions": 1})
        self.assertEqual(payload["brokerSyncSummary"]["connections"], 1)
        self.assertEqual(payload["brokerSyncSummary"]["statuses"], {"success": 1})
        self.assertIsNone(payload["brokerSyncSummary"]["fxStale"])
        self.assertIsNone(payload["brokerSyncSummary"]["fxFreshnessState"])
        self.assertIsNone(payload["totalEquity"]["amount"])
        self.assertEqual(payload["totalEquity"]["currency"], "USD")
        self.assertEqual(payload["portfolioTruth"]["state"], "valuation_partial")
        self.assertEqual(payload["portfolioTruth"]["value_semantics"], "covered_subtotal")
        self.assertEqual(payload["portfolioTruth"]["covered_subtotal"], "3500.00")
        self.assertEqual(payload["availability"]["performance"]["calculation_state"], "unavailable")
        self.assertEqual(payload["valuation"]["value_semantics"], "covered_subtotal")
        self.assertEqual(self._portfolio_counts(), before)
        self._assert_safe_json(response)
        self._assert_audit_event("admin_portfolio.summary_viewed")

    def test_member_and_admin_api_agree_on_zero_and_gain_loss_truth(self) -> None:
        fixtures = (
            ("parity-zero", "AAPL", Decimal("100"), "fully_valued_zero", "0.00", "0.00"),
            ("parity-gain", "MSFT", Decimal("120"), "fully_valued_nonzero", "20.00", "20.00"),
            ("parity-loss", "GOOG", Decimal("80"), "fully_valued_nonzero", "-20.00", "-20.00"),
        )

        for user_id, symbol, close, expected_state, expected_equity, expected_unrealized in fixtures:
            self._seed_parity_account(user_id=user_id, symbol=symbol, close=close)
            self._as_member(user_id)
            member_response = self.client.get(
                "/api/v1/portfolio/snapshot",
                params={"as_of": "2026-05-05", "cost_method": "fifo"},
            )
            self.assertEqual(member_response.status_code, 200)
            member = member_response.json()

            self._as_admin()
            admin_response = self.client.get(
                f"/api/v1/admin/users/{user_id}/portfolio-summary",
                params={"as_of": "2026-05-05", "cost_method": "fifo"},
            )
            self.assertEqual(admin_response.status_code, 200)
            admin = admin_response.json()

            self.assertEqual(member["portfolio_truth"]["state"], expected_state)
            self.assertEqual(admin["portfolioTruth"]["state"], member["portfolio_truth"]["state"])
            self.assertEqual(admin["portfolioTruth"]["value_semantics"], member["portfolio_truth"]["value_semantics"])
            self.assertEqual(admin["valuationCurrency"], member["currency"])
            self.assertEqual(admin["fxFreshnessState"], member["fx_lineage"]["status"])
            self.assertIsNone(admin["brokerSyncSummary"]["fxStale"])
            self.assertIsNone(admin["brokerSyncSummary"]["fxFreshnessState"])
            self.assertEqual(admin["totalEquity"]["amount"], expected_equity)
            self.assertEqual(admin["unrealizedPnl"]["amount"], expected_unrealized)
            self.assertEqual(admin["totalEquity"]["amount"], member["total_equity"])
            self.assertEqual(admin["unrealizedPnl"]["amount"], member["unrealized_pnl"])
            self._assert_safe_json(member_response)
            self._assert_safe_json(admin_response)

    def test_holdings_are_target_user_only_and_safe(self) -> None:
        self._as_admin()
        original_get_snapshot = PortfolioService.get_portfolio_snapshot
        snapshot_calls = 0

        def counting_get_snapshot(service, *args, **kwargs):
            nonlocal snapshot_calls
            snapshot_calls += 1
            return original_get_snapshot(service, *args, **kwargs)

        with patch.object(PortfolioService, "get_portfolio_snapshot", new=counting_get_snapshot):
            response = self.client.get(
                "/api/v1/admin/users/user-1/holdings",
                params={"limit": 200, "as_of": "2026-05-05"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(snapshot_calls, 1)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["items"][0]["symbol"], "AAPL")
        self.assertEqual(payload["items"][0]["accountId"], self.account_a_id)
        self.assertEqual(payload["items"][0]["marketValueBase"], "1800.00")
        self.assertEqual(payload["items"][0]["unrealizedPnlBase"], "300.00")
        self.assertEqual(payload["items"][0]["fxStatus"], "live")
        self.assertEqual(payload["portfolioTruth"]["state"], "valuation_partial")
        self.assertNotIn("MSFT", self._json_text(response))
        self.assertRegex(payload["items"][0]["brokerAccountHandle"], r"^acct_[a-f0-9]{12}$")
        self._assert_safe_json(response)
        self._assert_audit_event("admin_portfolio.holdings_viewed")

    def test_admin_projection_matches_member_truth_for_missing_hkd_fx(self) -> None:
        with self.db.get_session() as session:
            account = PortfolioAccount(
                owner_id="user-1",
                name="Alice HK",
                broker="Demo",
                market="hk",
                base_currency="CNY",
                is_active=True,
            )
            session.add(account)
            session.flush()
            account_id = int(account.id)
            session.add(
                PortfolioTrade(
                    account_id=account_id,
                    trade_uid="hk-missing-fx",
                    symbol="00700",
                    market="hk",
                    currency="HKD",
                    trade_date=date(2026, 5, 1),
                    side="buy",
                    quantity=Decimal("1"),
                    price=Decimal("300"),
                    is_active=True,
                )
            )
            session.commit()

        member_snapshot = PortfolioService(
            repo=PortfolioRepository(self.db),
            owner_id="user-1",
        ).get_portfolio_snapshot(account_id=account_id, as_of=date(2026, 5, 5))
        member_truth = member_snapshot["portfolio_truth"]
        self.assertEqual(member_truth["state"], "valuation_unavailable")

        member_aggregate = PortfolioService(
            repo=PortfolioRepository(self.db),
            owner_id="user-1",
        ).get_portfolio_snapshot(as_of=date(2026, 5, 5))
        self._as_admin()
        summary_response = self.client.get(
            "/api/v1/admin/users/user-1/portfolio-summary",
            params={"as_of": "2026-05-05"},
        )
        self.assertEqual(summary_response.status_code, 200)
        summary_payload = summary_response.json()
        self.assertEqual(summary_payload["portfolioTruth"]["state"], member_aggregate["portfolio_truth"]["state"])
        self.assertEqual(
            summary_payload["portfolioTruth"]["value_semantics"],
            member_aggregate["portfolio_truth"]["value_semantics"],
        )
        self.assertEqual(
            Decimal(summary_payload["portfolioTruth"]["covered_subtotal"]),
            Decimal(str(member_aggregate["portfolio_truth"]["covered_subtotal"])),
        )
        self.assertEqual(summary_payload["valuationCurrency"], member_aggregate["currency"])
        self.assertEqual(summary_payload["fxFreshnessState"], member_aggregate["fx_lineage"]["status"])
        for field_name in ("totalCash", "totalMarketValue", "totalEquity", "realizedPnl", "unrealizedPnl"):
            self.assertIsNone(summary_payload[field_name]["amount"])
        self._assert_safe_json(summary_response)

        response = self.client.get(
            "/api/v1/admin/users/user-1/holdings",
            params={"account_id": account_id, "as_of": "2026-05-05", "limit": 200},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["portfolioTruth"]["state"], member_truth["state"])
        self.assertEqual(payload["portfolioTruth"]["value_semantics"], member_truth["value_semantics"])
        self.assertEqual(payload["valuationCurrency"], member_snapshot["currency"])
        self.assertEqual(payload["fxFreshnessState"], "missing")
        self.assertEqual(payload["unvaluedHoldingCount"], 1)
        holding = payload["items"][0]
        self.assertIsNone(holding["marketValueBase"])
        self.assertIsNone(holding["unrealizedPnlBase"])
        self.assertIsNone(holding["displayMarketValue"])
        self.assertIsNone(holding["displayUnrealizedPnl"])
        self.assertEqual(holding["fxStatus"], "unavailable")
        self.assertEqual(holding["valuationStatus"], "unavailable")
        self.assertEqual(
            holding["valuationUnavailableReason"],
            member_snapshot["accounts"][0]["positions"][0]["valuation_unavailable_reason"],
        )
        self._assert_safe_json(response)
        self._assert_audit_event("admin_portfolio.holdings_viewed")

        # Use the existing user-2 USD sync state plus a CNY account so the
        # aggregate must convert before presenting a single-currency projection.
        with self.db.get_session() as session:
            account = PortfolioAccount(
                owner_id="user-2",
                name="Bob CNY",
                broker="Demo",
                market="us",
                base_currency="CNY",
                is_active=True,
            )
            session.add(account)
            session.flush()
            account_id = int(account.id)
            connection = PortfolioBrokerConnection(
                owner_id="user-2",
                portfolio_account_id=account_id,
                broker_type="demo",
                broker_name="Demo",
                connection_name="Alice Demo",
                broker_account_ref="DEMO-CNY",
                import_mode="api",
                status="active",
            )
            session.add(connection)
            session.flush()
            session.add(
                PortfolioBrokerSyncState(
                    owner_id="user-2",
                    broker_connection_id=int(connection.id),
                    portfolio_account_id=account_id,
                    broker_type="demo",
                    broker_account_ref="DEMO-CNY",
                    sync_source="fixture",
                    sync_status="success",
                    snapshot_date=date(2026, 5, 5),
                    synced_at=self.now,
                    base_currency="CNY",
                    total_cash=Decimal("0"),
                    total_market_value=Decimal("792"),
                    total_equity=Decimal("792"),
                    realized_pnl=Decimal("0"),
                    unrealized_pnl=Decimal("72"),
                    fx_stale=False,
                )
            )
            session.add(
                PortfolioBrokerSyncPosition(
                    owner_id="user-2",
                    broker_connection_id=int(connection.id),
                    portfolio_account_id=account_id,
                    broker_position_ref="DEMO-CNY-AAPL",
                    symbol="AAPL",
                    market="us",
                    currency="USD",
                    quantity=Decimal("1"),
                    avg_cost=Decimal("100"),
                    last_price=Decimal("110"),
                    market_value_base=Decimal("792"),
                    unrealized_pnl_base=Decimal("72"),
                    valuation_currency="CNY",
                )
            )
            session.commit()

        PortfolioRepository(self.db).save_fx_rate(
            from_currency="USD",
            to_currency="CNY",
            rate_date=date(2026, 5, 5),
            rate=Decimal("7.2"),
            source="reviewed_fixture",
            is_stale=False,
        )
        member_available = PortfolioService(
            repo=PortfolioRepository(self.db),
            owner_id="user-2",
        ).get_portfolio_snapshot(as_of=date(2026, 5, 5))
        self.assertEqual(member_available["currency"], "CNY")
        self.assertEqual(member_available["fx_lineage"]["status"], "available")
        self.assertEqual(member_available["portfolio_truth"]["value_semantics"], "covered_subtotal")
        self.assertIsNone(member_available["total_equity"])
        self.assertEqual(member_available["portfolio_truth"]["covered_subtotal"], Decimal("144777.60"))
        self.assertEqual(member_available["performance"]["calculation_state"], "unavailable")

        available_summary = self.client.get(
            "/api/v1/admin/users/user-2/portfolio-summary",
            params={"as_of": "2026-05-05"},
        )
        self.assertEqual(available_summary.status_code, 200)
        available_payload = available_summary.json()
        self.assertEqual(available_payload["valuationCurrency"], member_available["currency"])
        self.assertEqual(available_payload["fxFreshnessState"], member_available["fx_lineage"]["status"])
        self.assertEqual(available_payload["portfolioTruth"]["state"], member_available["portfolio_truth"]["state"])
        self.assertEqual(available_payload["portfolioTruth"]["covered_subtotal"], "144777.60")
        self.assertIsNone(available_payload["totalEquity"]["amount"])

        available_holdings = self.client.get(
            "/api/v1/admin/users/user-2/holdings",
            params={"account_id": account_id, "as_of": "2026-05-05", "limit": 200},
        )
        self.assertEqual(available_holdings.status_code, 200)
        available_item = available_holdings.json()["items"][0]
        member_available_item = next(
            item
            for account_snapshot in member_available["accounts"]
            for item in account_snapshot["positions"]
            if item["symbol"] == available_item["symbol"]
        )
        self.assertEqual(available_item["marketValueBase"], "792.00")
        self.assertEqual(available_item["fxStatus"], member_available_item["display_fx_status"])
        self.assertEqual(available_item["valuationStatus"], member_available_item["valuation_status"])
        self.assertEqual(available_item["valuationUnavailableReason"], member_available_item["valuation_unavailable_reason"])
        self.assertEqual(
            Decimal(available_item["displayMarketValue"]),
            Decimal(str(member_available_item["display_market_value"])),
        )
        self.assertEqual(
            Decimal(available_item["displayUnrealizedPnl"]),
            Decimal(str(member_available_item["display_unrealized_pnl"])),
        )
        self.assertEqual(available_item["valuationCurrency"], member_available_item["display_currency"])

        PortfolioRepository(self.db).save_fx_rate(
            from_currency="USD",
            to_currency="CNY",
            rate_date=date(2026, 5, 5),
            rate=Decimal("7.2"),
            source="reviewed_fixture",
            is_stale=True,
        )
        with self.db.get_session() as session:
            fx_row = session.execute(
                select(PortfolioFxRate).where(
                    PortfolioFxRate.from_currency == "USD",
                    PortfolioFxRate.to_currency == "CNY",
                    PortfolioFxRate.rate_date == date(2026, 5, 5),
                )
            ).scalar_one()
            snapshot_row = session.execute(
                select(PortfolioDailySnapshot).where(
                    PortfolioDailySnapshot.account_id == account_id,
                    PortfolioDailySnapshot.snapshot_date == date(2026, 5, 5),
                )
            ).scalar_one()
            fx_row.updated_at = snapshot_row.updated_at - timedelta(seconds=1)
            session.commit()
        member_stale = PortfolioService(
            repo=PortfolioRepository(self.db),
            owner_id="user-2",
        ).get_portfolio_snapshot(as_of=date(2026, 5, 5))
        self.assertEqual(member_stale["fx_lineage"]["status"], "stale")
        stale_summary = self.client.get(
            "/api/v1/admin/users/user-2/portfolio-summary",
            params={"as_of": "2026-05-05"},
        )
        self.assertEqual(stale_summary.status_code, 200)
        stale_payload = stale_summary.json()
        self.assertEqual(stale_payload["fxFreshnessState"], "stale")
        self.assertEqual(stale_payload["portfolioTruth"]["state"], member_stale["portfolio_truth"]["state"])
        self.assertIsNone(stale_payload["totalEquity"]["amount"])

        stale_holdings = self.client.get(
            "/api/v1/admin/users/user-2/holdings",
            params={"account_id": account_id, "as_of": "2026-05-05", "limit": 200},
        )
        self.assertEqual(stale_holdings.status_code, 200)
        self.assertEqual(stale_holdings.json()["items"][0]["fxStatus"], "stale")
        self.assertEqual(stale_holdings.json()["items"][0]["valuationStatus"], "stale")
        self.assertEqual(stale_holdings.json()["items"][0]["valuationUnavailableReason"], "stale_fx")

        all_stale_holdings = self.client.get(
            "/api/v1/admin/users/user-2/holdings",
            params={"as_of": "2026-05-05", "limit": 200},
        )
        self.assertEqual(all_stale_holdings.status_code, 200)
        stale_items = [
            item
            for item in all_stale_holdings.json()["items"]
            if item["currency"] == "USD" and item["valuationCurrency"] == "CNY"
        ]
        self.assertGreaterEqual(len(stale_items), 1)
        for item in stale_items:
            member_stale_item = next(
                holding
                for account in member_stale["accounts"]
                if account["account_id"] == item["accountId"]
                for holding in account["positions"]
                if holding["symbol"] == item["symbol"]
                and holding["currency"] == item["currency"]
                and holding["display_currency"] == item["valuationCurrency"]
            )
            self.assertEqual(item["fxStatus"], "stale")
            self.assertEqual(item["valuationStatus"], "stale")
            self.assertEqual(item["valuationUnavailableReason"], "stale_fx")
            self.assertIsNotNone(item["displayMarketValue"])
            self.assertIsNotNone(item["displayUnrealizedPnl"])
            self.assertEqual(item["fxStatus"], member_stale_item["display_fx_status"])
            self.assertEqual(item["valuationStatus"], member_stale_item["valuation_status"])
            self.assertEqual(item["valuationUnavailableReason"], member_stale_item["valuation_unavailable_reason"])
            self.assertEqual(
                Decimal(item["displayMarketValue"]),
                Decimal(str(member_stale_item["display_market_value"])),
            )
            self.assertEqual(
                Decimal(item["displayUnrealizedPnl"]),
                Decimal(str(member_stale_item["display_unrealized_pnl"])),
            )
            self.assertEqual(item["valuationCurrency"], member_stale_item["display_currency"])

    def test_account_detail_validates_account_owner_and_excludes_raw_payloads(self) -> None:
        self._as_admin()
        wrong_account = self.client.get(f"/api/v1/admin/users/user-1/portfolio/accounts/{self.account_b_id}")
        self.assertEqual(wrong_account.status_code, 404)

        with self.db.get_session() as session:
            inactive = PortfolioAccount(
                owner_id="user-1",
                name="Inactive account",
                broker="Demo",
                market="us",
                base_currency="USD",
                is_active=False,
            )
            session.add(inactive)
            session.flush()
            inactive_account_id = int(inactive.id)
            session.commit()
        inactive_response = self.client.get(
            f"/api/v1/admin/users/user-1/portfolio/accounts/{inactive_account_id}"
        )
        self.assertEqual(inactive_response.status_code, 404)

        response = self.client.get(f"/api/v1/admin/users/user-1/portfolio/accounts/{self.account_a_id}")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["userId"], "user-1")
        self.assertEqual(payload["account"]["id"], self.account_a_id)
        self.assertEqual(payload["brokerConnections"][0]["brokerAccountHandle"], payload["account"]["brokerAccountHandle"])
        self.assertEqual(payload["syncState"]["status"], "success")
        self._assert_safe_json(response)
        self._assert_audit_event("admin_portfolio.account_detail_viewed")

    def test_account_detail_does_not_attach_unverified_sync_provenance_to_canonical_valuation(self) -> None:
        account_id = self._seed_parity_account(
            user_id="historical-parity",
            symbol="AAPL",
            close=Decimal("120"),
        )
        with self.db.get_session() as session:
            connection = PortfolioBrokerConnection(
                owner_id="historical-parity",
                portfolio_account_id=account_id,
                broker_type="demo",
                broker_name="Demo",
                connection_name="Newer sync",
                broker_account_ref="HISTORICAL-PARITY",
                import_mode="api",
                status="active",
            )
            session.add(connection)
            session.flush()
            session.add(
                PortfolioBrokerSyncState(
                    owner_id="historical-parity",
                    broker_connection_id=int(connection.id),
                    portfolio_account_id=account_id,
                    broker_type="demo",
                    broker_account_ref="HISTORICAL-PARITY",
                    sync_source="fixture",
                    sync_status="success",
                    snapshot_date=date(2026, 5, 5),
                    synced_at=self.now + timedelta(hours=1),
                    base_currency="USD",
                    total_cash=Decimal("0"),
                    total_market_value=Decimal("999"),
                    total_equity=Decimal("999"),
                    realized_pnl=Decimal("0"),
                    unrealized_pnl=Decimal("999"),
                    fx_stale=False,
                )
            )
            session.add(
                PortfolioBrokerSyncPosition(
                    owner_id="historical-parity",
                    broker_connection_id=int(connection.id),
                    portfolio_account_id=account_id,
                    broker_position_ref="SAME-DATE-POSITION",
                    symbol="AAPL",
                    market="us",
                    currency="USD",
                    quantity=Decimal("1"),
                    avg_cost=Decimal("100"),
                    last_price=Decimal("999"),
                    market_value_base=Decimal("999"),
                    unrealized_pnl_base=Decimal("899"),
                    valuation_currency="USD",
                )
            )
            session.commit()

        original_get_snapshot = PortfolioService.get_portfolio_snapshot
        snapshot_calls = 0

        def counting_get_snapshot(service, *args, **kwargs):
            nonlocal snapshot_calls
            snapshot_calls += 1
            return original_get_snapshot(service, *args, **kwargs)

        self._as_admin()
        with patch.object(PortfolioService, "get_portfolio_snapshot", new=counting_get_snapshot):
            response = self.client.get(
                f"/api/v1/admin/users/historical-parity/portfolio/accounts/{account_id}",
                params={"as_of": "2026-05-05", "cost_method": "fifo"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(snapshot_calls, 1)
        payload = response.json()
        self.assertEqual(payload["asOf"], "2026-05-05")
        self.assertEqual(payload["portfolioTruth"]["state"], "valuation_partial")
        self.assertEqual(payload["portfolioTruth"]["value_semantics"], "covered_subtotal")
        self.assertEqual(payload["portfolioTruth"]["covered_subtotal"], "999.00")
        self.assertEqual(payload["holdings"]["portfolioTruth"], payload["portfolioTruth"])
        self.assertEqual(payload["holdings"]["items"][0]["displayMarketValue"], "999.00")
        self.assertEqual(payload["syncState"]["snapshotDate"], "2026-05-05")
        for field_name in (
            "totalCash",
            "totalMarketValue",
            "totalEquity",
            "realizedPnl",
            "unrealizedPnl",
        ):
            self.assertIsNone(payload["syncState"][field_name]["amount"])
        self.assertIsNone(payload["syncState"]["fxStale"])
        self._assert_safe_json(response)

    def test_admin_cold_projection_does_not_persist_valuation_cache(self) -> None:
        with self.db.get_session() as session:
            account = PortfolioAccount(
                owner_id="user-1",
                name="Alice Cold Read",
                broker="Demo",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add(account)
            session.commit()

        self._as_admin()
        with patch.object(
            PortfolioRepository,
            "replace_positions_lots_and_snapshot",
            side_effect=AssertionError("admin projection persisted valuation cache"),
        ):
            response = self.client.get(
                "/api/v1/admin/users/user-1/portfolio-summary",
                params={"as_of": "2026-08-24"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["portfolioTruth"]["state"], "valuation_unavailable")

    def test_portfolio_activity_returns_safe_rows_and_does_not_trigger_mutations_or_refresh(self) -> None:
        self._as_admin()
        before = self._portfolio_counts()

        with patch("src.services.portfolio_ibkr_sync_service.PortfolioIbkrSyncService.sync_read_only_account_state", side_effect=AssertionError("sync called")), patch(
            "src.services.portfolio_import_service.PortfolioImportService.commit_import_records",
            side_effect=AssertionError("import commit called"),
        ), patch("src.services.fx_rate_service.FxRateService.fetch_rate", side_effect=AssertionError("fx refresh called")):
            response = self.client.get("/api/v1/admin/users/user-1/portfolio-activity", params={"limit": 200})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["summary"], {"trades": 1, "cashEvents": 1, "corporateActions": 1})
        self.assertEqual({item["type"] for item in payload["items"]}, {"trade", "cash", "corporate_action"})
        self.assertEqual(self._portfolio_counts(), before)
        self._assert_safe_json(response)
        self._assert_audit_event("admin_portfolio.activity_viewed")

    def test_portfolio_activity_preserves_ordering_pagination_shape_and_multi_account_scope(self) -> None:
        self._as_admin()
        with self.db.get_session() as session:
            account_c = PortfolioAccount(
                owner_id="user-1",
                name="Alice Satellite",
                broker="IBKR",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add(account_c)
            session.flush()
            account_c_id = int(account_c.id)
            session.add_all(
                [
                    PortfolioTrade(
                        account_id=account_c_id,
                        trade_uid="satellite-trade",
                        symbol="TSLA",
                        market="us",
                        currency="USD",
                        trade_date=date(2026, 5, 4),
                        side="sell",
                        quantity=Decimal("2"),
                        price=Decimal("210"),
                        is_active=True,
                    ),
                    PortfolioCashLedger(
                        account_id=account_c_id,
                        event_date=date(2026, 5, 3),
                        direction="out",
                        amount=Decimal("250"),
                        currency="USD",
                    ),
                    PortfolioCorporateAction(
                        account_id=account_c_id,
                        symbol="TSLA",
                        market="us",
                        currency="USD",
                        effective_date=date(2026, 5, 2),
                        action_type="split_adjustment",
                        split_ratio=Decimal("2"),
                    ),
                ]
            )
            session.commit()

        full = self.client.get("/api/v1/admin/users/user-1/portfolio-activity", params={"limit": 200})
        page = self.client.get("/api/v1/admin/users/user-1/portfolio-activity", params={"limit": 2, "offset": 1})

        self.assertEqual(full.status_code, 200)
        self.assertEqual(page.status_code, 200)
        full_payload = full.json()
        page_payload = page.json()
        self.assertEqual(full_payload["total"], 6)
        self.assertEqual(full_payload["summary"], {"trades": 2, "cashEvents": 2, "corporateActions": 2})
        self.assertEqual([item["idHash"] for item in page_payload["items"]], [item["idHash"] for item in full_payload["items"][1:3]])
        self.assertEqual(page_payload["limit"], 2)
        self.assertEqual(page_payload["offset"], 1)
        self.assertTrue(page_payload["hasMore"])
        self.assertEqual(sorted({item["accountId"] for item in full_payload["items"]}), [self.account_a_id, account_c_id])
        self.assertEqual(
            set(full_payload["items"][0].keys()),
            {
                "idHash",
                "type",
                "accountId",
                "accountName",
                "eventDate",
                "symbol",
                "market",
                "currency",
                "side",
                "direction",
                "actionType",
                "quantity",
                "price",
                "amount",
                "createdAt",
            },
        )
        ordered_keys = [(item["eventDate"], item["idHash"]) for item in full_payload["items"]]
        self.assertEqual(ordered_keys, sorted(ordered_keys, reverse=True))
        self._assert_safe_json(full)
        self._assert_safe_json(page)

    def test_portfolio_activity_empty_account_returns_empty_projection(self) -> None:
        self._as_admin()
        with self.db.get_session() as session:
            empty_account = PortfolioAccount(
                owner_id="user-1",
                name="Alice Empty",
                broker="IBKR",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add(empty_account)
            session.commit()
            empty_account_id = int(empty_account.id)

        response = self.client.get(
            "/api/v1/admin/users/user-1/portfolio-activity",
            params={"account_id": empty_account_id, "limit": 5},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["total"], 0)
        self.assertEqual(payload["summary"], {"trades": 0, "cashEvents": 0, "corporateActions": 0})
        self.assertFalse(payload["hasMore"])

    def test_portfolio_activity_uses_bounded_row_projection_queries(self) -> None:
        self._as_admin()
        with self.db.get_session() as session:
            for index in range(12):
                session.add(
                    PortfolioTrade(
                        account_id=self.account_a_id,
                        trade_uid=f"extra-trade-{index}",
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        trade_date=date(2026, 4, 1),
                        side="buy",
                        quantity=Decimal("1"),
                        price=Decimal(100 + index),
                        is_active=True,
                    )
                )
                session.add(
                    PortfolioCashLedger(
                        account_id=self.account_a_id,
                        event_date=date(2026, 4, 1),
                        direction="in",
                        amount=Decimal(100 + index),
                        currency="USD",
                    )
                )
                session.add(
                    PortfolioCorporateAction(
                        account_id=self.account_a_id,
                        symbol="AAPL",
                        market="us",
                        currency="USD",
                        effective_date=date(2026, 4, 1),
                        action_type="cash_dividend",
                        cash_dividend_per_share=Decimal("0.01"),
                    )
                )
            session.commit()

        statements: list[str] = []

        def _capture_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            statements.append(str(statement).lower())

        engine = getattr(self.db, "_engine")
        event.listen(engine, "before_cursor_execute", _capture_statement)
        try:
            response = self.client.get("/api/v1/admin/users/user-1/portfolio-activity", params={"limit": 2, "offset": 1})
        finally:
            event.remove(engine, "before_cursor_execute", _capture_statement)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 39)
        self.assertTrue(any("from portfolio_trades" in statement and " limit " in statement for statement in statements))
        self.assertTrue(any("from portfolio_cash_ledger" in statement and " limit " in statement for statement in statements))
        self.assertTrue(any("from portfolio_corporate_actions" in statement and " limit " in statement for statement in statements))

    def test_admin_portfolio_export_redaction_matrix_excludes_raw_payloads_and_secrets(self) -> None:
        self._as_admin()
        before = self._portfolio_counts()

        with patch(
            "src.services.portfolio_ibkr_sync_service.PortfolioIbkrSyncService.sync_read_only_account_state",
            side_effect=AssertionError("sync called"),
        ), patch(
            "src.services.portfolio_import_service.PortfolioImportService.commit_import_records",
            side_effect=AssertionError("import commit called"),
        ), patch(
            "src.services.portfolio_service.PortfolioService.refresh_fx_rates",
            side_effect=AssertionError("fx refresh called"),
        ):
            matrix = {
                "summary": self.client.get("/api/v1/admin/users/user-1/portfolio-summary"),
                "holdings": self.client.get("/api/v1/admin/users/user-1/holdings", params={"limit": 200}),
                "activity": self.client.get("/api/v1/admin/users/user-1/portfolio-activity", params={"limit": 200}),
                "account_detail": self.client.get(
                    f"/api/v1/admin/users/user-1/portfolio/accounts/{self.account_a_id}"
                ),
            }

        for surface, response in matrix.items():
            self.assertEqual(response.status_code, 200)
            text = self._json_text(response)
            self.assertNotIn("MSFT", text)
            self.assertNotIn("user-2", text)
            self._assert_safe_json(response)
            self.assertNotIn("access_token", text, surface)
            self.assertNotIn("refresh_token", text, surface)
            self.assertNotIn("session_token", text, surface)
            self.assertNotIn("api_key", text, surface)
            self.assertNotIn("provider_payload", text, surface)
            self.assertNotIn("sync_metadata_secret", text, surface)

        detail = matrix["account_detail"].json()
        self.assertEqual(detail["brokerConnections"][0]["brokerAccountHandle"], detail["account"]["brokerAccountHandle"])
        self.assertNotIn("brokerAccountRef", self._json_text(matrix["account_detail"]))
        self.assertEqual(self._portfolio_counts(), before)


if __name__ == "__main__":
    unittest.main()
