# -*- coding: utf-8 -*-
"""Tests for read-only IBKR API sync foundation."""

from __future__ import annotations

import os
import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pandas as pd

from src.config import Config
from src.services.portfolio_ibkr_currency import (
    IbkrCurrencyStatus,
    classify_ibkr_currency,
)
from src.services.portfolio_ibkr_sync_service import (
    IbkrHttpResult,
    PortfolioIbkrSyncError,
    PortfolioIbkrSyncService,
    RequestsIbkrHttpTransport,
)
from src.services.portfolio_import_service import PortfolioImportService
from src.portfolio_exact_numeric import PortfolioExactNumericError
from src.services.portfolio_service import PortfolioService
from src.storage import DatabaseManager
from src.utils.symbol_normalization import parse_canonical_symbol


class FakeIbkrTransport:
    """Deterministic transport for service-level sync tests."""

    def __init__(self, responses: dict[str, object]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def get(self, url: str, *, headers, params, verify, timeout) -> IbkrHttpResult:
        from urllib.parse import urlparse

        path = urlparse(url).path
        self.calls.append(path)
        value = self.responses.get(path)
        if value is None:
            return IbkrHttpResult(status_code=404, payload={"message": f"not mocked: {path}"})
        if isinstance(value, tuple):
            status_code, payload = value
            return IbkrHttpResult(status_code=int(status_code), payload=payload)
        return IbkrHttpResult(status_code=200, payload=value)


class PortfolioIbkrSyncServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.db_path = Path(self.temp_dir.name) / "portfolio_ibkr_sync.db"
        self.env_path.write_text(
            "\n".join(
                [
                    "STOCK_LIST=600519",
                    "GEMINI_API_KEY=test",
                    "ADMIN_AUTH_ENABLED=false",
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

        self.db = DatabaseManager.get_instance()
        self.service = PortfolioService()
        self.import_service = PortfolioImportService(portfolio_service=self.service)

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        self.temp_dir.cleanup()

    def test_requests_transport_preserves_json_decimal_and_normalizer_rejects_float(self) -> None:
        response = MagicMock(status_code=200)
        payload_text = '{"amount": 9007199254740993.12345678}'

        def parse_json(**kwargs):
            return json.loads(payload_text, **kwargs)

        response.json.side_effect = parse_json
        with patch("src.services.portfolio_ibkr_sync_service.requests.get", return_value=response):
            result = RequestsIbkrHttpTransport().get(
                "https://localhost:5000/v1/api/portfolio/U1234567/summary",
                headers={},
                params=None,
                verify=True,
                timeout=20,
            )

        self.assertEqual(result.payload["amount"], Decimal("9007199254740993.12345678"))
        response.json.assert_called_once_with(parse_float=Decimal)
        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            PortfolioIbkrSyncService._to_decimal(1.25)
        self.assertEqual(ctx.exception.code, "ibkr_precision_invalid")

    def test_transport_decoded_bare_decimal_summary_survives_read_only_sync(self) -> None:
        exact_money = "9007199254740993.12"
        payloads = {
            "/v1/api/portfolio/accounts": '[{"accountId": "U-BARE", "displayName": "Bare Decimal", "currency": "USD"}]',
            "/v1/api/portfolio/U-BARE/summary": (
                "{"
                f"\"totalcashvalue\": {exact_money}, "
                "\"stockmarketvalue\": 0, "
                f"\"netliquidation\": {exact_money}, "
                "\"realizedpnl\": 0, "
                "\"unrealizedpnl\": 0"
                "}"
            ),
            "/v1/api/portfolio/U-BARE/ledger": "{}",
            "/v1/api/portfolio/U-BARE/positions/0": "[]",
        }

        def fake_get(url, **_kwargs):
            from urllib.parse import urlparse

            response = MagicMock(status_code=200)
            payload_text = payloads[urlparse(url).path]
            response.json.side_effect = lambda **kwargs: json.loads(payload_text, **kwargs)
            return response

        account = self.service.create_account(name="Bare Summary", broker="IBKR", market="us", base_currency="USD")
        with patch("src.services.portfolio_ibkr_sync_service.requests.get", side_effect=fake_get):
            result = PortfolioIbkrSyncService(portfolio_service=self.service).sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
                api_base_url="https://localhost:5000",
            )

        self.assertEqual(result["total_cash"], exact_money)
        self.assertEqual(result["total_equity"], exact_money)
        latest = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest["total_cash"], exact_money)

    @staticmethod
    def _ibkr_flex_xml_bytes() -> bytes:
        xml_text = """<?xml version="1.0" encoding="UTF-8"?>
<FlexStatements>
  <FlexStatement accountId="U1234567" fromDate="2026-01-01" toDate="2026-01-31" currency="USD">
    <Trades>
      <Trade assetCategory="STK" symbol="AAPL" exchange="NASDAQ" currency="USD" tradeDate="2026-01-03" buySell="BUY" quantity="10" tradePrice="150" ibCommission="1.25" taxes="0" ibExecID="AAPL-1" description="AAPL BUY"/>
    </Trades>
    <CashTransactions>
      <CashTransaction reportDate="2026-01-02" currency="USD" amount="5000" description="Deposit"/>
    </CashTransactions>
  </FlexStatement>
</FlexStatements>
"""
        return xml_text.encode("utf-8")

    def _save_close(self, symbol: str, on_date: date, close: float) -> None:
        df = pd.DataFrame(
            [
                {
                    "date": on_date,
                    "open": close,
                    "high": close,
                    "low": close,
                    "close": close,
                    "volume": 1.0,
                    "amount": close,
                    "pct_chg": 0.0,
                }
            ]
        )
        self.db.save_daily_data(df, code=symbol, data_source="portfolio-ibkr-sync-test")

    def _build_transport(self, *, account_ref: str = "U1234567", multi_market: bool = False) -> FakeIbkrTransport:
        positions = [
            {
                "conid": "265598",
                "contractDesc": "AAPL",
                "position": "10",
                "avgCost": "150",
                "mktPrice": "160",
                "mktValue": "1600",
                "unrealizedPnl": "100",
                "currency": "USD",
                "assetClass": "STK",
                "listingExchange": "NASDAQ",
                "countryCode": "US",
            }
        ]
        if multi_market:
            positions.append(
                {
                    "conid": "700",
                    "contractDesc": "700",
                    "position": "100",
                    "avgCost": "320",
                    "mktPrice": "330",
                    "mktValue": "33000",
                    "unrealizedPnl": "1000",
                    "currency": "HKD",
                    "assetClass": "STK",
                    "listingExchange": "SEHK",
                    "countryCode": "HK",
                }
            )
        responses = {
            "/v1/api/portfolio/accounts": [
                {"accountId": account_ref, "displayName": "Primary IBKR", "currency": "USD"}
            ],
            f"/v1/api/portfolio/{account_ref}/summary": {
                "totalcashvalue": {"amount": "5000"},
                "stockmarketvalue": {"amount": "5824" if multi_market else "1600"},
                "netliquidation": {"amount": "10824" if multi_market else "6600"},
                "realizedpnl": {"amount": "0"},
                "unrealizedpnl": {"amount": "228" if multi_market else "100"},
            },
            f"/v1/api/portfolio/{account_ref}/ledger": {"USD": {"cashbalance": "5000"}},
            f"/v1/api/portfolio/{account_ref}/positions/0": positions,
            f"/v1/api/portfolio/{account_ref}/positions/1": [],
        }
        return FakeIbkrTransport(responses)

    def _build_cross_currency_transport(
        self,
        *,
        account_ref: str = "U1234567",
        account_currency: object = "USD",
        position_currency: object = "HKD",
        ledger_currency: object = "USD",
    ) -> FakeIbkrTransport:
        transport = self._build_transport(account_ref=account_ref)
        account_row = transport.responses["/v1/api/portfolio/accounts"][0]
        if account_currency is ...:
            account_row.pop("currency", None)
        else:
            account_row["currency"] = account_currency
        transport.responses[f"/v1/api/portfolio/{account_ref}/summary"] = {
            "realizedpnl": {"amount": "0"},
        }
        transport.responses[f"/v1/api/portfolio/{account_ref}/ledger"] = {
            ledger_currency: {"cashbalance": "5000"}
        }
        position = transport.responses[f"/v1/api/portfolio/{account_ref}/positions/0"][0]
        if position_currency is ...:
            position.pop("currency", None)
        else:
            position["currency"] = position_currency
        position["mktValue"] = "1600"
        position["unrealizedPnl"] = "100"
        return transport

    def test_ibkr_currency_classifier_distinguishes_all_states(self) -> None:
        cases = [
            (" usd ", None, IbkrCurrencyStatus.VALID, "USD"),
            ("inr", None, IbkrCurrencyStatus.VALID, "INR"),
            ("sek", None, IbkrCurrencyStatus.VALID, "SEK"),
            (None, None, IbkrCurrencyStatus.MISSING, None),
            ("   ", None, IbkrCurrencyStatus.MISSING, None),
            ("US D", None, IbkrCurrencyStatus.MALFORMED, None),
            (["USD"], None, IbkrCurrencyStatus.MALFORMED, None),
            ("XYZ", None, IbkrCurrencyStatus.UNKNOWN, None),
            ("EUR", False, IbkrCurrencyStatus.OPERATIONALLY_UNSUPPORTED, "EUR"),
        ]

        for raw, operationally_supported, expected_status, expected_code in cases:
            with self.subTest(raw=raw, operationally_supported=operationally_supported):
                result = classify_ibkr_currency(
                    raw,
                    operationally_supported=operationally_supported,
                )
                self.assertEqual(result.status, expected_status)
                self.assertEqual(result.code, expected_code)

    def test_position_normalization_keeps_decimal_values_until_public_serialization(self) -> None:
        portfolio_service = MagicMock()
        portfolio_service.convert_amount_exact.side_effect = lambda *, amount, **_kwargs: (
            Decimal(amount),
            False,
            "identity",
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=portfolio_service)

        rows, market_total, unrealized_total, fx_stale, warnings, markets = (
            sync_service._normalize_positions(
                positions=[
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "10.12345678",
                        "avgCost": "150.12345678",
                        "mktPrice": "160.12345678",
                        "mktValue": "1620.00000000",
                        "unrealizedPnl": "100.00000000",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                    }
                ],
                base_currency="USD",
                as_of_date=date(2026, 1, 3),
            )
        )

        self.assertEqual(rows[0]["quantity"], Decimal("10.12345678"))
        self.assertEqual(rows[0]["avg_cost"], Decimal("150.12345678"))
        self.assertEqual(rows[0]["last_price"], Decimal("160.12345678"))
        self.assertEqual(rows[0]["market_value_base"], Decimal("1620.00000000"))
        self.assertEqual(market_total, Decimal("1620.00000000"))
        self.assertEqual(unrealized_total, Decimal("100.00000000"))
        self.assertFalse(fx_stale)
        self.assertEqual(warnings, [])
        self.assertEqual(markets, ["us"])

    def test_position_normalization_rejects_missing_valuation_sources_instead_of_zero(self) -> None:
        portfolio_service = MagicMock()
        portfolio_service.convert_amount_exact.side_effect = lambda *, amount, **_kwargs: (
            Decimal(amount),
            False,
            "identity",
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=portfolio_service)

        missing_market_and_price = {
            "contractDesc": "AAPL",
            "position": "1",
            "avgCost": "100",
            "unrealizedPnl": "0",
            "currency": "USD",
            "assetClass": "STK",
            "listingExchange": "NASDAQ",
        }
        with self.assertRaises(PortfolioIbkrSyncError) as market_ctx:
            sync_service._normalize_positions(
                positions=[missing_market_and_price],
                base_currency="USD",
                as_of_date=date(2026, 1, 3),
            )
        self.assertEqual(market_ctx.exception.code, "ibkr_valuation_unavailable")
        self.assertIn("市值和价格来源", str(market_ctx.exception))

        missing_cost_and_pnl = {
            "contractDesc": "AAPL",
            "position": "1",
            "mktPrice": "100",
            "mktValue": "100",
            "currency": "USD",
            "assetClass": "STK",
            "listingExchange": "NASDAQ",
        }
        with self.assertRaises(PortfolioIbkrSyncError) as pnl_ctx:
            sync_service._normalize_positions(
                positions=[missing_cost_and_pnl],
                base_currency="USD",
                as_of_date=date(2026, 1, 3),
            )
        self.assertEqual(pnl_ctx.exception.code, "ibkr_valuation_unavailable")
        self.assertIn("成本和未实现盈亏来源", str(pnl_ctx.exception))

    def test_position_normalization_rounds_derived_market_price_before_strict_parse(self) -> None:
        portfolio_service = MagicMock()
        portfolio_service.convert_amount_exact.side_effect = lambda *, amount, **_kwargs: (
            Decimal(amount),
            False,
            "identity",
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=portfolio_service)

        rows, market_total, unrealized_total, fx_stale, warnings, markets = (
            sync_service._normalize_positions(
                positions=[
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "3",
                        "avgCost": "30",
                        "mktPrice": "0",
                        "mktValue": "100",
                        "unrealizedPnl": "0",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                    }
                ],
                base_currency="USD",
                as_of_date=date(2026, 1, 3),
            )
        )

        self.assertEqual(rows[0]["last_price"], Decimal("33.33333333"))
        self.assertEqual(market_total, Decimal("100.00"))
        self.assertEqual(unrealized_total, Decimal("0.00"))
        self.assertFalse(fx_stale)
        self.assertEqual(warnings, [])
        self.assertEqual(markets, ["us"])

    def test_read_only_sync_requires_explicit_valid_broker_base_currency(self) -> None:
        cases = [
            (..., "ibkr_currency_missing"),
            (None, "ibkr_currency_missing"),
            ("", "ibkr_currency_missing"),
            ("   ", "ibkr_currency_missing"),
            ("US D", "ibkr_currency_malformed"),
            ("US$", "ibkr_currency_malformed"),
            ("TOOLONGCODE", "ibkr_currency_malformed"),
            (["USD"], "ibkr_currency_malformed"),
            ({"currency": "USD"}, "ibkr_currency_malformed"),
            ("XYZ", "ibkr_currency_unknown"),
        ]

        for index, (raw_currency, expected_code) in enumerate(cases):
            with self.subTest(raw_currency=raw_currency):
                account = self.service.create_account(
                    name=f"Invalid Currency {index}",
                    broker="IBKR",
                    market="cn",
                    base_currency="CNY",
                )
                sync_service = PortfolioIbkrSyncService(
                    portfolio_service=self.service,
                    transport=self._build_cross_currency_transport(
                        account_ref=f"U-CURRENCY-{index}",
                        account_currency=raw_currency,
                        position_currency="XYZ" if raw_currency == "XYZ" else "USD",
                    ),
                )

                with self.assertRaises(PortfolioIbkrSyncError) as ctx:
                    sync_service.sync_read_only_account_state(
                        account_id=account["id"],
                        session_token="unit-test-session",
                    )

                self.assertEqual(ctx.exception.code, expected_code)
                unchanged = self.service.get_account(account["id"], include_inactive=True)
                self.assertEqual(unchanged["base_currency"], "CNY")
                self.assertEqual(
                    self.service.list_broker_connections(
                        portfolio_account_id=account["id"],
                        broker_type="ibkr",
                    ),
                    [],
                )

        account = self.service.create_account(
            name="Invalid Summary Currency",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        transport = self._build_cross_currency_transport(
            account_ref="U-INVALID-SUMMARY",
            account_currency="USD",
            position_currency="USD",
        )
        transport.responses["/v1/api/portfolio/U-INVALID-SUMMARY/summary"] = {
            "currency": "XYZ",
        }
        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            PortfolioIbkrSyncService(
                portfolio_service=self.service,
                transport=transport,
            ).sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
            )
        self.assertEqual(ctx.exception.code, "ibkr_currency_unknown")
        self.assertEqual(
            self.service.list_broker_connections(portfolio_account_id=account["id"]),
            [],
        )

    def test_read_only_sync_accepts_explicit_summary_currency_evidence(self) -> None:
        account = self.service.create_account(name="Summary Currency", broker="IBKR", market="us", base_currency="CNY")
        transport = self._build_cross_currency_transport(
            account_currency=...,
            position_currency="USD",
        )
        transport.responses["/v1/api/portfolio/U1234567/summary"] = {
            "totalcashvalue": {"amount": "5000", "currency": " usd "},
            "stockmarketvalue": {"amount": "1600", "currency": "USD"},
            "netliquidation": {"amount": "6600", "currency": "USD"},
            "realizedpnl": {"amount": "0", "currency": "USD"},
        }

        result = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=transport,
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        self.assertEqual(result["base_currency"], "USD")
        aligned = self.service.get_account(account["id"], include_inactive=True)
        self.assertEqual(aligned["base_currency"], "USD")

    def test_read_only_sync_uses_direct_fx_for_material_position_values(self) -> None:
        account = self.service.create_account(name="Direct FX", broker="IBKR", market="hk", base_currency="INR")
        self.service.repo.save_fx_rate(
            from_currency="SEK",
            to_currency="INR",
            rate_date=date.today(),
            rate=Decimal("1.28"),
            source="unit-test",
            is_stale=False,
        )

        result = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=self._build_cross_currency_transport(
                account_currency="INR",
                position_currency="SEK",
                ledger_currency="INR",
            ),
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        state = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        self.assertEqual(state["positions"][0]["market_value_base"], "2048.00")
        self.assertEqual(state["positions"][0]["unrealized_pnl_base"], "128.00")
        self.assertFalse(result["fx_stale"])

    def test_read_only_sync_rounds_derived_fx_values_at_destination_money_boundary(self) -> None:
        account = self.service.create_account(name="Derived FX Rounding", broker="IBKR", market="hk", base_currency="USD")
        original_convert_amount_exact = self.service.convert_amount_exact

        def convert_amount_exact(*, amount, from_currency, to_currency, as_of_date):
            if from_currency == "HKD" and to_currency == "USD":
                self.assertIsInstance(amount, Decimal)
                converted = {
                    Decimal("1600"): Decimal("204.805"),
                    Decimal("100"): Decimal("12.805"),
                }[amount]
                return converted, False, "unit-test-derived-fx"
            return original_convert_amount_exact(
                amount=amount,
                from_currency=from_currency,
                to_currency=to_currency,
                as_of_date=as_of_date,
            )

        with patch.object(
            self.service,
            "convert_amount_exact",
            side_effect=convert_amount_exact,
        ) as convert_amount_exact_mock:
            result = PortfolioIbkrSyncService(
                portfolio_service=self.service,
                transport=self._build_cross_currency_transport(),
            ).sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
            )

        cross_currency_amounts = {
            call.kwargs["amount"]
            for call in convert_amount_exact_mock.call_args_list
            if call.kwargs["from_currency"] == "HKD" and call.kwargs["to_currency"] == "USD"
        }
        self.assertEqual(cross_currency_amounts, {Decimal("1600"), Decimal("100")})
        state = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        self.assertEqual(state["positions"][0]["market_value_base"], "204.80")
        self.assertEqual(state["positions"][0]["unrealized_pnl_base"], "12.80")
        self.assertFalse(result["fx_stale"])

    def test_read_only_sync_uses_inverse_fx_for_material_position_values(self) -> None:
        account = self.service.create_account(name="Inverse FX", broker="IBKR", market="hk", base_currency="USD")
        self.service.repo.save_fx_rate(
            from_currency="USD",
            to_currency="HKD",
            rate_date=date.today(),
            rate=Decimal("7.8125"),
            source="unit-test",
            is_stale=False,
        )

        PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=self._build_cross_currency_transport(),
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        state = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        self.assertEqual(state["positions"][0]["market_value_base"], "204.80")
        self.assertEqual(state["positions"][0]["unrealized_pnl_base"], "12.80")

    def test_rejected_sync_preserves_account_overlay_cash_positions_and_cached_snapshot(self) -> None:
        account = self.service.create_account(name="Preserved Sync", broker="IBKR", market="us", base_currency="USD")
        valid_service = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=self._build_transport(),
        )
        first = valid_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )
        snapshot_date = date.fromisoformat(first["snapshot_date"])
        self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=snapshot_date,
            cost_method="fifo",
        )
        before_account = self.service.get_account(account["id"], include_inactive=True)
        before_state = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        before_cache = self.service.repo.get_cached_snapshot_bundle(
            account_id=account["id"],
            snapshot_date=snapshot_date,
            cost_method="fifo",
        )
        connection_id = self.service.list_broker_connections(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
        )[0]["id"]
        before_connection = self.service.get_broker_connection(connection_id)

        invalid_transports = [
            self._build_cross_currency_transport(position_currency=...),
            self._build_cross_currency_transport(position_currency="US D"),
            self._build_cross_currency_transport(position_currency="XYZ"),
            self._build_cross_currency_transport(ledger_currency="US D", position_currency="USD"),
            self._build_cross_currency_transport(ledger_currency="XYZ", position_currency="USD"),
            self._build_cross_currency_transport(position_currency="HKD"),
        ]
        expected_codes = [
            "ibkr_currency_missing",
            "ibkr_currency_malformed",
            "ibkr_currency_unknown",
            "ibkr_currency_malformed",
            "ibkr_currency_unknown",
            "ibkr_fx_unavailable",
        ]
        for transport, expected_code in zip(invalid_transports, expected_codes):
            with self.subTest(expected_code=expected_code):
                with self.assertRaises(PortfolioIbkrSyncError) as ctx:
                    PortfolioIbkrSyncService(
                        portfolio_service=self.service,
                        transport=transport,
                    ).sync_read_only_account_state(
                        account_id=account["id"],
                        broker_connection_id=connection_id,
                        session_token="unit-test-session",
                    )
                self.assertEqual(ctx.exception.code, expected_code)
                self.assertEqual(
                    self.service.get_account(account["id"], include_inactive=True),
                    before_account,
                )
                self.assertEqual(
                    self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"]),
                    before_state,
                )
                self.assertEqual(self.service.get_broker_connection(connection_id), before_connection)
                after_cache = self.service.repo.get_cached_snapshot_bundle(
                    account_id=account["id"],
                    snapshot_date=snapshot_date,
                    cost_method="fifo",
                )
                self.assertEqual(after_cache["snapshot"].payload, before_cache["snapshot"].payload)
                self.assertEqual(
                    [(row.symbol, row.currency) for row in after_cache["positions"]],
                    [(row.symbol, row.currency) for row in before_cache["positions"]],
                )

        mismatch_account = self.service.create_account(
            name="Rejected Alignment",
            broker="IBKR",
            market="cn",
            base_currency="CNY",
        )
        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            PortfolioIbkrSyncService(
                portfolio_service=self.service,
                transport=self._build_cross_currency_transport(
                    account_ref="U-REJECTED-ALIGNMENT",
                    account_currency="USD",
                    position_currency="HKD",
                ),
            ).sync_read_only_account_state(
                account_id=mismatch_account["id"],
                session_token="unit-test-session",
            )
        self.assertEqual(ctx.exception.code, "ibkr_fx_unavailable")
        mismatch_after = self.service.get_account(mismatch_account["id"], include_inactive=True)
        self.assertEqual(mismatch_after["base_currency"], "CNY")
        self.assertEqual(
            self.service.list_broker_connections(portfolio_account_id=mismatch_account["id"]),
            [],
        )

    def test_read_only_sync_creates_user_owned_connection_and_snapshot_overlay(self) -> None:
        account = self.service.create_account(name="IBKR Main", broker="IBKR", market="us", base_currency="USD")
        transport = self._build_transport()
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        result = sync_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
            api_base_url="https://localhost:5000",
        )

        self.assertEqual(result["broker_account_ref"], "U1234567")
        self.assertEqual(result["position_count"], 1)
        self.assertFalse(result["verify_ssl"])
        connections = self.service.list_broker_connections(portfolio_account_id=account["id"], broker_type="ibkr")
        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["import_mode"], "api")
        self.assertEqual(connections[0]["broker_account_ref"], "U1234567")
        self.assertEqual(
            connections[0]["sync_metadata"]["ibkr_api"]["api_base_url"],
            "https://localhost:5000/v1/api",
        )

        snapshot_date = date.fromisoformat(result["snapshot_date"])
        snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=snapshot_date,
            cost_method="fifo",
        )
        acc = snapshot["accounts"][0]
        self.assertEqual(acc["positions"][0]["symbol"], "AAPL")
        self.assertAlmostEqual(acc["positions"][0]["quantity"], 10.0, places=6)
        self.assertAlmostEqual(acc["total_cash"], 5000.0, places=6)
        self.assertAlmostEqual(acc["total_market_value"], 1600.0, places=6)
        self.assertAlmostEqual(acc["total_equity"], 6600.0, places=6)
        self.assertNotIn("price_cost_basis_native", acc["positions"][0])
        self.assertNotIn("price_pnl_native", acc["positions"][0])

        cached = self.service.repo.get_cached_snapshot_bundle(
            account_id=account["id"],
            snapshot_date=snapshot_date,
            cost_method="fifo",
        )
        self.assertIsNotNone(cached)
        self.assertIsNone(cached["positions"][0].price_cost)

        with patch.object(
            self.service,
            "_build_account_snapshot",
            side_effect=AssertionError("synced snapshot cache should preserve unavailable price cost"),
        ):
            cached_snapshot = self.service.get_portfolio_snapshot(
                account_id=account["id"],
                as_of=snapshot_date,
                cost_method="fifo",
            )

        cached_position = cached_snapshot["accounts"][0]["positions"][0]
        self.assertAlmostEqual(cached_position["quantity"], 10.0, places=6)
        self.assertNotIn("price_cost_basis_native", cached_position)
        self.assertNotIn("price_pnl_native", cached_position)

        trades = self.service.list_trade_events(account_id=account["id"], page=1, page_size=20)
        self.assertEqual(trades["total"], 0)

    def test_read_only_sync_preserves_exact_broker_snapshot_values_through_latest_state_and_overlay(self) -> None:
        exact_money = "9007199254740993.12"
        exact_quantity = "9007199254740993.00000000"
        account = self.service.create_account(
            name="IBKR Exact Overlay",
            broker="IBKR",
            market="us",
            base_currency="USD",
        )
        transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U-EXACT", "displayName": "Exact IBKR", "currency": "USD"}
                ],
                "/v1/api/portfolio/U-EXACT/summary": {
                    "totalcashvalue": {"amount": exact_money},
                    "stockmarketvalue": {"amount": "0.00"},
                    "netliquidation": {"amount": exact_money},
                    "realizedpnl": {"amount": "0.00"},
                    "unrealizedpnl": {"amount": "0.00"},
                },
                "/v1/api/portfolio/U-EXACT/ledger": {
                    "USD": {"cashbalance": exact_money},
                },
                "/v1/api/portfolio/U-EXACT/positions/0": [
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": exact_quantity,
                        "avgCost": "1.00000000",
                        "mktPrice": "1.00000000",
                        "mktValue": exact_money,
                        "unrealizedPnl": "0.00",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    }
                ],
                "/v1/api/portfolio/U-EXACT/positions/1": [],
            }
        )

        result = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=transport,
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
            api_base_url="https://localhost:5000",
        )

        self.assertEqual(result["total_cash"], exact_money)
        latest = self.service.get_latest_broker_sync_state(portfolio_account_id=account["id"])
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest["total_cash"], exact_money)
        self.assertEqual(latest["cash_balances"][0]["amount"], exact_money)
        self.assertEqual(latest["positions"][0]["quantity"], exact_quantity)
        self.assertEqual(latest["positions"][0]["market_value_base"], exact_money)

        snapshot_date = date.fromisoformat(result["snapshot_date"])
        snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=snapshot_date,
            cost_method="fifo",
        )
        overlay = snapshot["accounts"][0]
        self.assertEqual(overlay["total_cash"], Decimal(exact_money))
        self.assertEqual(overlay["positions"][0]["quantity"], Decimal(exact_quantity))
        self.assertEqual(overlay["positions"][0]["market_value_base"], Decimal(exact_money))

        connection_id = self.service.list_broker_connections(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
        )[0]["id"]
        with self.assertRaises(PortfolioExactNumericError):
            self.service.replace_broker_sync_state(
                broker_connection_id=connection_id,
                portfolio_account_id=account["id"],
                broker_type="ibkr",
                broker_account_ref="U-EXACT",
                sync_source="api",
                sync_status="success",
                snapshot_date=snapshot_date,
                synced_at=datetime.now(),
                base_currency="USD",
                total_cash=1.0,
                total_market_value="0.00",
                total_equity="1.00",
                realized_pnl="0.00",
                unrealized_pnl="0.00",
                fx_stale=False,
                payload={},
                positions=[],
                cash_balances=[],
            )

    def test_read_only_sync_does_not_infer_hk_for_bare_five_digit_position_without_context(self) -> None:
        account = self.service.create_account(name="IBKR Ambiguous Position", broker="IBKR", market="us", base_currency="USD")
        self.service.repo.save_fx_rate(
            from_currency="HKD",
            to_currency="USD",
            rate_date=date.today(),
            rate=Decimal("0.128"),
            source="unit-test",
            is_stale=False,
        )
        transport = self._build_transport(multi_market=True)
        positions = transport.responses["/v1/api/portfolio/U1234567/positions/0"]
        self.assertIsInstance(positions, list)
        hk_position = positions[1]
        self.assertIsInstance(hk_position, dict)
        hk_position["symbol"] = "00700"
        hk_position.pop("countryCode")
        hk_position.pop("listingExchange")

        result = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=transport,
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date.fromisoformat(result["snapshot_date"]),
            cost_method="fifo",
        )
        self.assertEqual(result["position_count"], 1)
        self.assertEqual([item["symbol"] for item in snapshot["accounts"][0]["positions"]], ["AAPL"])
        self.assertIn("ambiguous", " ".join(result["warnings"]))

    def test_read_only_sync_requires_transient_session_token(self) -> None:
        account = self.service.create_account(name="IBKR Main", broker="IBKR", market="us", base_currency="USD")
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=self._build_transport())

        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            sync_service.sync_read_only_account_state(
                account_id=account["id"],
                session_token="   ",
            )

        self.assertEqual(ctx.exception.code, "ibkr_session_required")

    def test_read_only_sync_surfaces_expired_session_as_safe_error(self) -> None:
        account = self.service.create_account(name="IBKR Main", broker="IBKR", market="us", base_currency="USD")
        transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": (401, {"message": "session expired"}),
            }
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            sync_service.sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
            )

        self.assertEqual(ctx.exception.code, "ibkr_session_expired")
        self.assertEqual(
            self.service.list_broker_connections(portfolio_account_id=account["id"], broker_type="ibkr"),
            [],
        )

    def test_read_only_sync_rejects_accounts_payload_without_supported_identifier(self) -> None:
        account = self.service.create_account(name="IBKR Main", broker="IBKR", market="us", base_currency="USD")
        transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"displayName": "Primary Only", "currency": "USD"},
                ],
            }
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            sync_service.sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
            )

        self.assertEqual(ctx.exception.code, "ibkr_account_identifier_invalid")

    def test_read_only_sync_treats_empty_positions_as_valid_current_state(self) -> None:
        account = self.service.create_account(name="IBKR Cash Only", broker="IBKR", market="us", base_currency="USD")
        transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"}
                ],
                "/v1/api/portfolio/U1234567/summary": {
                    "totalcashvalue": {"amount": "5000"},
                    "stockmarketvalue": {"amount": "0"},
                    "netliquidation": {"amount": "5000"},
                    "realizedpnl": {"amount": "0"},
                },
                "/v1/api/portfolio/U1234567/ledger": {"USD": {"cashbalance": "5000"}},
                "/v1/api/portfolio/U1234567/positions/0": [],
            }
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        result = sync_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        self.assertEqual(result["position_count"], 0)
        self.assertIn("未返回持仓", " ".join(result["warnings"]))
        snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date.fromisoformat(result["snapshot_date"]),
            cost_method="fifo",
        )
        self.assertAlmostEqual(snapshot["accounts"][0]["total_cash"], 5000.0, places=6)
        self.assertEqual(snapshot["accounts"][0]["positions"], [])

    def test_read_only_sync_rejects_missing_account_valuation_sources_instead_of_zero(self) -> None:
        account = self.service.create_account(name="IBKR Missing Totals", broker="IBKR", market="us", base_currency="USD")
        cases = [
            (
                {
                    "netliquidation": {"amount": "5000"},
                    "realizedpnl": {"amount": "0"},
                },
                {},
                "总现金来源",
            ),
            (
                {
                    "totalcashvalue": {"amount": "5000"},
                    "netliquidation": {"amount": "5000"},
                    "realizedpnl": {"amount": "0"},
                },
                {"USD": {"cashbalance": "5000"}},
                "总市值来源",
            ),
        ]
        for summary, ledger, expected_fragment in cases:
            with self.subTest(expected_fragment=expected_fragment):
                transport = FakeIbkrTransport(
                    {
                        "/v1/api/portfolio/accounts": [
                            {"accountId": "U-MISSING-TOTALS", "displayName": "Missing Totals", "currency": "USD"}
                        ],
                        "/v1/api/portfolio/U-MISSING-TOTALS/summary": summary,
                        "/v1/api/portfolio/U-MISSING-TOTALS/ledger": ledger,
                        "/v1/api/portfolio/U-MISSING-TOTALS/positions/0": [],
                    }
                )
                with self.assertRaises(PortfolioIbkrSyncError) as ctx:
                    PortfolioIbkrSyncService(
                        portfolio_service=self.service,
                        transport=transport,
                    ).sync_read_only_account_state(
                        account_id=account["id"],
                        session_token="unit-test-session",
                    )
                self.assertEqual(ctx.exception.code, "ibkr_valuation_unavailable")
                self.assertIn(expected_fragment, str(ctx.exception))

    def test_read_only_sync_coexists_with_existing_ibkr_file_import(self) -> None:
        account = self.service.create_account(name="IBKR History", broker="IBKR", market="us", base_currency="USD")
        parsed = self.import_service.parse_import_file(broker="ibkr", content=self._ibkr_flex_xml_bytes())
        self.import_service.commit_import_records(
            account_id=account["id"],
            broker="ibkr",
            parsed_payload=parsed,
            dry_run=False,
        )
        self.service.repo.save_fx_rate(
            from_currency="HKD",
            to_currency="USD",
            rate_date=date.today(),
            rate=Decimal("0.128"),
            source="unit-test",
            is_stale=False,
        )

        transport = self._build_transport(multi_market=True)
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)
        result = sync_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
            broker_account_ref="U1234567",
            api_base_url="https://localhost:5000/v1/api",
        )

        self.assertTrue(result["used_existing_connection"])
        connections = self.service.list_broker_connections(portfolio_account_id=account["id"], broker_type="ibkr")
        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["import_mode"], "file")
        self.assertIn("last_statement_from", connections[0]["sync_metadata"])
        self.assertIn("ibkr_api", connections[0]["sync_metadata"])

        snapshot_date = date.fromisoformat(result["snapshot_date"])
        current_snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=snapshot_date,
            cost_method="fifo",
        )
        current_positions = current_snapshot["accounts"][0]["positions"]
        self.assertEqual({item["symbol"] for item in current_positions}, {"AAPL", "HK00700"})

        historical_snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date(2026, 1, 31),
            cost_method="fifo",
        )
        historical_positions = historical_snapshot["accounts"][0]["positions"]
        self.assertEqual([item["symbol"] for item in historical_positions], ["AAPL"])

        account_after_sync = self.service.get_account(account["id"], include_inactive=True)
        self.assertEqual(account_after_sync["market"], "global")

    @patch(
        "src.services.portfolio_ibkr_sync_service.parse_canonical_symbol",
        wraps=parse_canonical_symbol,
    )
    def test_read_only_sync_uses_canonical_parser_for_sehk_position(self, parser) -> None:
        account = self.service.create_account(name="IBKR HK Position", broker="IBKR", market="hk", base_currency="USD")
        self.service.repo.save_fx_rate(
            from_currency="HKD",
            to_currency="USD",
            rate_date=date.today(),
            rate=Decimal("0.128"),
            source="unit-test",
            is_stale=False,
        )
        transport = self._build_transport(multi_market=True)
        positions = transport.responses["/v1/api/portfolio/U1234567/positions/0"]
        self.assertIsInstance(positions, list)
        hk_position = positions[1]
        self.assertIsInstance(hk_position, dict)
        hk_position["symbol"] = "00700"

        result = PortfolioIbkrSyncService(
            portfolio_service=self.service,
            transport=transport,
        ).sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
        )

        snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date.fromisoformat(result["snapshot_date"]),
            cost_method="fifo",
        )
        hk_positions = [item for item in snapshot["accounts"][0]["positions"] if item["market"] == "hk"]
        self.assertEqual(len(hk_positions), 1)
        self.assertEqual(hk_positions[0]["symbol"], "HK00700")
        parser.assert_any_call("00700", market="hk")

    def test_ibkr_hk_trade_preview_uses_canonical_symbol_identity(self) -> None:
        content = b'''<?xml version="1.0" encoding="UTF-8"?>
<FlexStatements>
  <FlexStatement accountId="U7654321" fromDate="2026-02-01" toDate="2026-02-28" currency="USD">
    <Trades>
      <Trade assetCategory="STK" symbol="00700" exchange="SEHK" currency="HKD" tradeDate="2026-02-03" buySell="BUY" quantity="10" tradePrice="400" ibCommission="1" taxes="0" ibExecID="HK-700-1" description="Tencent BUY"/>
    </Trades>
  </FlexStatement>
</FlexStatements>
'''

        parsed = self.import_service.parse_import_file(broker="ibkr", content=content)

        self.assertEqual(parsed["record_count"], 1)
        self.assertEqual(parsed["records"][0]["market"], "hk")
        self.assertEqual(parsed["records"][0]["symbol"], "HK00700")

    def test_ibkr_hk_corporate_action_preview_uses_canonical_symbol_identity(self) -> None:
        content = b'''<?xml version="1.0" encoding="UTF-8"?>
<FlexStatements>
  <FlexStatement accountId="U7654321" fromDate="2026-02-01" toDate="2026-02-28" currency="USD">
    <CorporateActions>
      <CorporateAction symbol="00700" exchange="SEHK" currency="HKD" reportDate="2026-02-05" ratio="2" description="Tencent stock split 2 for 1"/>
    </CorporateActions>
  </FlexStatement>
</FlexStatements>
'''

        parsed = self.import_service.parse_import_file(broker="ibkr", content=content)

        self.assertEqual(parsed["corporate_action_count"], 1)
        self.assertEqual(parsed["corporate_actions"][0]["market"], "hk")
        self.assertEqual(parsed["corporate_actions"][0]["symbol"], "HK00700")

    def test_ibkr_hk_open_position_preview_uses_canonical_symbol_identity(self) -> None:
        content = b'''<?xml version="1.0" encoding="UTF-8"?>
<FlexStatements>
  <FlexStatement accountId="U7654321" fromDate="2026-02-01" toDate="2026-02-28" currency="USD">
    <OpenPositions>
      <OpenPosition assetCategory="STK" symbol="00700" exchange="SEHK" currency="HKD" reportDate="2026-02-28" position="10" costBasisPrice="400"/>
    </OpenPositions>
  </FlexStatement>
</FlexStatements>
'''

        parsed = self.import_service.parse_import_file(broker="ibkr", content=content)

        self.assertTrue(parsed["metadata"]["open_position_seeded"])
        self.assertEqual(parsed["record_count"], 1)
        self.assertEqual(parsed["records"][0]["market"], "hk")
        self.assertEqual(parsed["records"][0]["symbol"], "HK00700")

    def test_read_only_sync_rejects_duplicate_remote_account_link_on_another_portfolio_account(self) -> None:
        account_a = self.service.create_account(name="A", broker="IBKR", market="us", base_currency="USD")
        account_b = self.service.create_account(name="B", broker="IBKR", market="us", base_currency="USD")
        transport = self._build_transport()
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        sync_service.sync_read_only_account_state(
            account_id=account_a["id"],
            session_token="unit-test-session",
        )
        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            sync_service.sync_read_only_account_state(
                account_id=account_b["id"],
                session_token="unit-test-session",
                broker_account_ref="U1234567",
            )
        self.assertEqual(ctx.exception.code, "ibkr_account_mapping_conflict")

    def test_read_only_sync_requires_explicit_account_ref_when_session_has_multiple_accounts(self) -> None:
        account = self.service.create_account(name="Need Ref", broker="IBKR", market="us", base_currency="USD")
        transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary", "currency": "USD"},
                    {"accountId": "U7654321", "displayName": "Secondary", "currency": "USD"},
                ]
            }
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=transport)

        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            sync_service.sync_read_only_account_state(
                account_id=account["id"],
                session_token="unit-test-session",
            )
        self.assertEqual(ctx.exception.code, "ibkr_account_ambiguous")

    def test_read_only_sync_is_owner_scoped(self) -> None:
        self.db.create_or_update_app_user(user_id="user-a", username="alice")
        self.db.create_or_update_app_user(user_id="user-b", username="bob")
        service_a = PortfolioService(owner_id="user-a")
        service_b = PortfolioService(owner_id="user-b")
        sync_service_b = PortfolioIbkrSyncService(
            portfolio_service=service_b,
            transport=self._build_transport(),
        )

        account_a = service_a.create_account(name="Alice IBKR", broker="IBKR", market="us", base_currency="USD")
        with self.assertRaisesRegex(ValueError, "Active account not found"):
            sync_service_b.sync_read_only_account_state(
                account_id=account_a["id"],
                session_token="unit-test-session",
            )

    def test_same_user_multi_account_sync_keeps_mapping_stable_and_overlays_isolated(self) -> None:
        account_a = self.service.create_account(name="IBKR Imported", broker="IBKR", market="us", base_currency="USD")
        account_b = self.service.create_account(name="IBKR Secondary", broker="IBKR", market="us", base_currency="USD")
        account_c = self.service.create_account(name="IBKR Conflict", broker="IBKR", market="us", base_currency="USD")
        parsed = self.import_service.parse_import_file(broker="ibkr", content=self._ibkr_flex_xml_bytes())
        self.import_service.commit_import_records(
            account_id=account_a["id"],
            broker="ibkr",
            parsed_payload=parsed,
            dry_run=False,
        )

        first_transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"},
                    {"accountId": "U7654321", "displayName": "Secondary IBKR", "currency": "USD"},
                ],
                "/v1/api/portfolio/U1234567/summary": {
                    "totalcashvalue": {"amount": "5000"},
                    "stockmarketvalue": {"amount": "1600"},
                    "netliquidation": {"amount": "6600"},
                    "realizedpnl": {"amount": "0"},
                    "unrealizedpnl": {"amount": "100"},
                },
                "/v1/api/portfolio/U1234567/ledger": {"USD": {"cashbalance": "5000"}},
                "/v1/api/portfolio/U1234567/positions/0": [
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "10",
                        "avgCost": "150",
                        "mktPrice": "160",
                        "mktValue": "1600",
                        "unrealizedPnl": "100",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    }
                ],
                "/v1/api/portfolio/U1234567/positions/1": [],
                "/v1/api/portfolio/U7654321/summary": {
                    "totalcashvalue": {"amount": "2000"},
                    "stockmarketvalue": {"amount": "2000"},
                    "netliquidation": {"amount": "4000"},
                    "realizedpnl": {"amount": "0"},
                    "unrealizedpnl": {"amount": "100"},
                },
                "/v1/api/portfolio/U7654321/ledger": {"USD": {"cashbalance": "2000"}},
                "/v1/api/portfolio/U7654321/positions/0": [
                    {
                        "conid": "272093",
                        "contractDesc": "MSFT",
                        "position": "5",
                        "avgCost": "380",
                        "mktPrice": "400",
                        "mktValue": "2000",
                        "unrealizedPnl": "100",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    }
                ],
                "/v1/api/portfolio/U7654321/positions/1": [],
            }
        )

        sync_service_a = PortfolioIbkrSyncService(portfolio_service=self.service, transport=first_transport)
        first_result_a = sync_service_a.sync_read_only_account_state(
            account_id=account_a["id"],
            session_token="unit-test-session",
            broker_account_ref="U1234567",
        )
        first_result_b = sync_service_a.sync_read_only_account_state(
            account_id=account_b["id"],
            session_token="unit-test-session",
            broker_account_ref="U7654321",
        )

        first_connections_a = self.service.list_broker_connections(portfolio_account_id=account_a["id"], broker_type="ibkr")
        first_connections_b = self.service.list_broker_connections(portfolio_account_id=account_b["id"], broker_type="ibkr")
        self.assertEqual(len(first_connections_a), 1)
        self.assertEqual(len(first_connections_b), 1)
        connection_id_a = first_connections_a[0]["id"]
        connection_id_b = first_connections_b[0]["id"]
        self.assertNotEqual(connection_id_a, connection_id_b)

        second_transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"},
                    {"accountId": "U7654321", "displayName": "Secondary IBKR", "currency": "USD"},
                ],
                "/v1/api/portfolio/U1234567/summary": {
                    "totalcashvalue": {"amount": "4500"},
                    "stockmarketvalue": {"amount": "5450"},
                    "netliquidation": {"amount": "9950"},
                    "realizedpnl": {"amount": "0"},
                    "unrealizedpnl": {"amount": "250"},
                },
                "/v1/api/portfolio/U1234567/ledger": {"USD": {"cashbalance": "4500"}},
                "/v1/api/portfolio/U1234567/positions/0": [
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "12",
                        "avgCost": "150",
                        "mktPrice": "165",
                        "mktValue": "1980",
                        "unrealizedPnl": "180",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    },
                    {
                        "conid": "208813719",
                        "contractDesc": "GOOG",
                        "position": "1",
                        "avgCost": "3200",
                        "mktPrice": "3470",
                        "mktValue": "3470",
                        "unrealizedPnl": "270",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    },
                ],
                "/v1/api/portfolio/U1234567/positions/1": [],
            }
        )
        repeat_sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=second_transport)
        second_result_a = repeat_sync_service.sync_read_only_account_state(
            account_id=account_a["id"],
            session_token="unit-test-session",
            broker_connection_id=connection_id_a,
        )

        self.assertTrue(second_result_a["used_existing_connection"])
        second_connections_a = self.service.list_broker_connections(portfolio_account_id=account_a["id"], broker_type="ibkr")
        self.assertEqual(len(second_connections_a), 1)
        self.assertEqual(second_connections_a[0]["id"], connection_id_a)

        latest_sync_a = self.service.get_latest_broker_sync_state(portfolio_account_id=account_a["id"])
        latest_sync_b = self.service.get_latest_broker_sync_state(portfolio_account_id=account_b["id"])
        self.assertEqual([item["symbol"] for item in latest_sync_a["positions"]], ["AAPL", "GOOG"])
        self.assertEqual([item["symbol"] for item in latest_sync_b["positions"]], ["MSFT"])

        snapshot_a = self.service.get_portfolio_snapshot(
            account_id=account_a["id"],
            as_of=date.fromisoformat(second_result_a["snapshot_date"]),
            cost_method="fifo",
        )
        snapshot_b = self.service.get_portfolio_snapshot(
            account_id=account_b["id"],
            as_of=date.fromisoformat(first_result_b["snapshot_date"]),
            cost_method="fifo",
        )
        self.assertEqual({item["symbol"] for item in snapshot_a["accounts"][0]["positions"]}, {"AAPL", "GOOG"})
        self.assertEqual({item["symbol"] for item in snapshot_b["accounts"][0]["positions"]}, {"MSFT"})

        historical_snapshot_a = self.service.get_portfolio_snapshot(
            account_id=account_a["id"],
            as_of=date(2026, 1, 31),
            cost_method="fifo",
        )
        self.assertEqual([item["symbol"] for item in historical_snapshot_a["accounts"][0]["positions"]], ["AAPL"])

        conflict_transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"},
                    {"accountId": "U7654321", "displayName": "Secondary IBKR", "currency": "USD"},
                ]
            }
        )
        conflict_sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=conflict_transport)
        with self.assertRaises(PortfolioIbkrSyncError) as ctx:
            conflict_sync_service.sync_read_only_account_state(
                account_id=account_c["id"],
                session_token="unit-test-session",
                broker_account_ref="U1234567",
            )

        self.assertEqual(ctx.exception.code, "ibkr_account_mapping_conflict")

    def test_same_day_overlay_resync_refreshes_cached_snapshot(self) -> None:
        account = self.service.create_account(name="Primary IBKR", broker="IBKR", market="us", base_currency="USD")
        first_transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"},
                ],
                "/v1/api/portfolio/U1234567/summary": {
                    "totalcashvalue": {"amount": "5000"},
                    "stockmarketvalue": {"amount": "1600"},
                    "netliquidation": {"amount": "6600"},
                    "realizedpnl": {"amount": "0"},
                    "unrealizedpnl": {"amount": "100"},
                },
                "/v1/api/portfolio/U1234567/ledger": {"USD": {"cashbalance": "5000"}},
                "/v1/api/portfolio/U1234567/positions/0": [
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "10",
                        "avgCost": "150",
                        "mktPrice": "160",
                        "mktValue": "1600",
                        "unrealizedPnl": "100",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    }
                ],
                "/v1/api/portfolio/U1234567/positions/1": [],
            }
        )
        sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=first_transport)
        first_result = sync_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
            broker_account_ref="U1234567",
        )
        snapshot_date = date.fromisoformat(first_result["snapshot_date"])
        first_snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=snapshot_date,
            cost_method="fifo",
        )
        self.assertEqual([item["symbol"] for item in first_snapshot["accounts"][0]["positions"]], ["AAPL"])

        connection_id = self.service.list_broker_connections(
            portfolio_account_id=account["id"],
            broker_type="ibkr",
        )[0]["id"]
        second_transport = FakeIbkrTransport(
            {
                "/v1/api/portfolio/accounts": [
                    {"accountId": "U1234567", "displayName": "Primary IBKR", "currency": "USD"},
                ],
                "/v1/api/portfolio/U1234567/summary": {
                    "totalcashvalue": {"amount": "4500"},
                    "stockmarketvalue": {"amount": "5450"},
                    "netliquidation": {"amount": "9950"},
                    "realizedpnl": {"amount": "0"},
                    "unrealizedpnl": {"amount": "250"},
                },
                "/v1/api/portfolio/U1234567/ledger": {"USD": {"cashbalance": "4500"}},
                "/v1/api/portfolio/U1234567/positions/0": [
                    {
                        "conid": "265598",
                        "contractDesc": "AAPL",
                        "position": "12",
                        "avgCost": "150",
                        "mktPrice": "165",
                        "mktValue": "1980",
                        "unrealizedPnl": "180",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    },
                    {
                        "conid": "208813719",
                        "contractDesc": "GOOG",
                        "position": "1",
                        "avgCost": "3200",
                        "mktPrice": "3470",
                        "mktValue": "3470",
                        "unrealizedPnl": "270",
                        "currency": "USD",
                        "assetClass": "STK",
                        "listingExchange": "NASDAQ",
                        "countryCode": "US",
                    },
                ],
                "/v1/api/portfolio/U1234567/positions/1": [],
            }
        )
        repeat_sync_service = PortfolioIbkrSyncService(portfolio_service=self.service, transport=second_transport)
        second_result = repeat_sync_service.sync_read_only_account_state(
            account_id=account["id"],
            session_token="unit-test-session",
            broker_connection_id=connection_id,
        )

        refreshed_snapshot = self.service.get_portfolio_snapshot(
            account_id=account["id"],
            as_of=date.fromisoformat(second_result["snapshot_date"]),
            cost_method="fifo",
        )
        self.assertEqual(
            {item["symbol"] for item in refreshed_snapshot["accounts"][0]["positions"]},
            {"AAPL", "GOOG"},
        )
