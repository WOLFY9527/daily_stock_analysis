# -*- coding: utf-8 -*-
"""Read-only portfolio history API contract tests."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from api.deps import CurrentUser, get_current_user
from src.config import Config
from src.storage import DatabaseManager, PortfolioAccount, PortfolioDailySnapshot


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


def _make_user() -> CurrentUser:
    return CurrentUser(
        user_id="history-user",
        username="history-user",
        display_name="History User",
        role="user",
        is_admin=False,
        is_authenticated=True,
        transitional=False,
        auth_enabled=True,
        session_id="history-session",
    )


class PortfolioHistoryClient:
    def __enter__(self) -> "PortfolioHistoryClient":
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.env_path = self.data_dir / ".env"
        self.db_path = self.data_dir / "portfolio_history_api.db"
        self.env_path.write_text(
            "\n".join(
                [
                    "STOCK_LIST=600519",
                    "GEMINI_API_KEY=test",
                    "ADMIN_AUTH_ENABLED=true",
                    f"DATABASE_PATH={self.db_path}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.db_path)
        Config.reset_instance()
        DatabaseManager.reset_instance()
        _reset_auth_globals()
        self.app = create_app(static_dir=self.data_dir / "empty-static")
        self.app.dependency_overrides[get_current_user] = _make_user
        self.client = TestClient(self.app)
        self.auth_patch = patch("api.middlewares.auth.resolve_current_user", return_value=_make_user())
        self.auth_patch.start()
        self.db = DatabaseManager.get_instance()
        self.db.create_or_update_app_user(
            user_id="history-user",
            username="history-user",
            display_name="History User",
            role="user",
            password_hash="pbkdf2:history-user",
            is_active=True,
        )
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.auth_patch.stop()
        self.app.dependency_overrides.clear()
        self.client.close()
        DatabaseManager.reset_instance()
        Config.reset_instance()
        _reset_auth_globals()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        self.temp_dir.cleanup()

    def seed_account(self, *, owner_id: str = "history-user", name: str = "History Account") -> int:
        if owner_id != "history-user":
            self.db.create_or_update_app_user(
                user_id=owner_id,
                username=owner_id,
                display_name=name,
                role="user",
                password_hash=f"pbkdf2:{owner_id}",
                is_active=True,
            )
        with self.db.get_session() as session:
            row = PortfolioAccount(
                owner_id=owner_id,
                name=name,
                broker="Manual",
                market="us",
                base_currency="USD",
                is_active=True,
            )
            session.add(row)
            session.commit()
            return int(row.id)

    def seed_snapshot(
        self,
        *,
        account_id: int,
        snapshot_date: date,
        total_cash: Decimal,
        total_market_value: Decimal,
        total_equity: Decimal,
        unrealized_pnl: Decimal,
        realized_pnl: Decimal,
        payload: str = '{"valuation": {"state": "available"}, "performance": {"calculation_state": "available"}, "secret": "SNAPSHOT_SECRET"}',
    ) -> None:
        with self.db.get_session() as session:
            session.add(
                PortfolioDailySnapshot(
                    account_id=account_id,
                    snapshot_date=snapshot_date,
                    cost_method="fifo",
                    base_currency="USD",
                    total_cash=total_cash,
                    total_market_value=total_market_value,
                    total_equity=total_equity,
                    unrealized_pnl=unrealized_pnl,
                    realized_pnl=realized_pnl,
                    fee_total=Decimal("1.5"),
                    tax_total=Decimal("0.25"),
                    fx_stale=False,
                    payload=payload,
                )
            )
            session.commit()

    def snapshot_count(self) -> int:
        with self.db.get_session() as session:
            return int(session.query(PortfolioDailySnapshot).count())


class ForbiddenServicePath:
    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"forbidden service path called: {name}")


def _json_text(response) -> str:
    return json.dumps(response.json(), ensure_ascii=False, sort_keys=True)


def test_history_returns_stored_snapshots_with_date_filter_limit_and_coverage() -> None:
    with PortfolioHistoryClient() as ctx:
        account_id = ctx.seed_account()
        other_account_id = ctx.seed_account(owner_id="other-user", name="Other Account")
        ctx.seed_snapshot(
            account_id=account_id,
            snapshot_date=date(2026, 1, 1),
            total_cash=Decimal("1000"),
            total_market_value=Decimal("2000"),
            total_equity=Decimal("3000"),
            unrealized_pnl=Decimal("100"),
            realized_pnl=Decimal("20"),
        )
        ctx.seed_snapshot(
            account_id=account_id,
            snapshot_date=date(2026, 1, 3),
            total_cash=Decimal("900"),
            total_market_value=Decimal("2300"),
            total_equity=Decimal("3200"),
            unrealized_pnl=Decimal("150"),
            realized_pnl=Decimal("30"),
        )
        ctx.seed_snapshot(
            account_id=account_id,
            snapshot_date=date(2026, 1, 4),
            total_cash=Decimal("850"),
            total_market_value=Decimal("2100"),
            total_equity=Decimal("2950"),
            unrealized_pnl=Decimal("-50"),
            realized_pnl=Decimal("35"),
        )
        ctx.seed_snapshot(
            account_id=other_account_id,
            snapshot_date=date(2026, 1, 4),
            total_cash=Decimal("999999"),
            total_market_value=Decimal("999999"),
            total_equity=Decimal("1999998"),
            unrealized_pnl=Decimal("999999"),
            realized_pnl=Decimal("999999"),
            payload='{"valuation": {"state": "available"}, "performance": {"calculation_state": "available"}, "secret": "OTHER_OWNER_SNAPSHOT_SECRET"}',
        )
        before_count = ctx.snapshot_count()

        with (
            patch("api.v1.endpoints.portfolio.PortfolioService", side_effect=AssertionError("portfolio service called")),
            patch("api.v1.endpoints.portfolio.PortfolioRiskService", side_effect=AssertionError("risk service called")),
            patch("api.v1.endpoints.portfolio.PortfolioImportService", side_effect=AssertionError("import service called")),
            patch("api.v1.endpoints.portfolio.PortfolioIbkrSyncService", side_effect=AssertionError("broker sync called")),
            patch("api.v1.endpoints.portfolio.default_fx_rate_service", new=ForbiddenServicePath()),
        ):
            response = ctx.client.get(
                "/api/v1/portfolio/history",
                params={
                    "account_id": account_id,
                    "date_from": "2026-01-02",
                    "date_to": "2026-01-04",
                    "limit": 2,
                    "cost_method": "fifo",
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["read_model_type"] == "portfolio_history_readonly_v1"
        assert payload["account_id"] == account_id
        assert payload["cost_method"] == "fifo"
        assert [item["snapshot_date"] for item in payload["items"]] == ["2026-01-03", "2026-01-04"]
        assert payload["items"][0]["total_cash"] == "900.00"
        assert payload["items"][0]["total_market_value"] == "2300.00"
        assert payload["items"][0]["total_equity"] == "3200.00"
        assert payload["items"][0]["unrealized_pnl"] == "150.00"
        assert payload["items"][0]["realized_pnl"] == "30.00"
        assert payload["coverage"]["status"] == "available"
        assert payload["coverage"]["point_count"] == 2
        assert payload["coverage"]["insufficient_data"] is False
        assert payload["coverage"]["sparse"] is False
        assert payload["metadata"]["stored_snapshot_only"] is True
        assert payload["metadata"]["no_backfill"] is True
        assert payload["metadata"]["no_accounting_replay"] is True
        assert payload["metadata"]["no_provider_runtime"] is True
        text = _json_text(response)
        assert "SNAPSHOT_SECRET" not in text
        assert "OTHER_OWNER_SNAPSHOT_SECRET" not in text
        assert "999999" not in text
        assert ctx.snapshot_count() == before_count


def test_history_reports_insufficient_data_without_backfill_or_recalculation() -> None:
    with PortfolioHistoryClient() as ctx:
        account_id = ctx.seed_account()
        ctx.seed_snapshot(
            account_id=account_id,
            snapshot_date=date(2026, 2, 5),
            total_cash=Decimal("500"),
            total_market_value=Decimal("700"),
            total_equity=Decimal("1200"),
            unrealized_pnl=Decimal("25"),
            realized_pnl=Decimal("5"),
        )
        before_count = ctx.snapshot_count()

        response = ctx.client.get(
            "/api/v1/portfolio/history",
            params={
                "account_id": account_id,
                "date_from": "2026-02-01",
                "date_to": "2026-02-10",
                "limit": 10,
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert [item["snapshot_date"] for item in payload["items"]] == ["2026-02-05"]
        assert payload["coverage"]["status"] == "insufficient_data"
        assert payload["coverage"]["point_count"] == 1
        assert payload["coverage"]["insufficient_data"] is True
        assert payload["coverage"]["sparse"] is True
        assert payload["coverage"]["warnings"] == ["history_insufficient_points"]
        assert ctx.snapshot_count() == before_count


def test_history_rejects_invalid_date_range() -> None:
    with PortfolioHistoryClient() as ctx:
        account_id = ctx.seed_account()

        response = ctx.client.get(
            "/api/v1/portfolio/history",
            params={
                "account_id": account_id,
                "date_from": "2026-03-10",
                "date_to": "2026-03-01",
            },
        )

    assert response.status_code == 400
    assert response.json()["error"] == "validation_error"
