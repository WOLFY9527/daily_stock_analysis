# -*- coding: utf-8 -*-
"""Contract and fallback tests for market crypto endpoint."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


CN_TZ = timezone(timedelta(hours=8))


class MarketCryptoApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        MarketOverviewService._market_cache.clear()
        MarketOverviewService._market_data_cache.clear()

    def test_get_crypto_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_crypto.return_value = {
            "items": [
                {
                    "symbol": "BTC",
                    "price": 76837.04,
                    "change": 1.47,
                    "trend": [74211.0, 75120.0, 76837.04],
                    "last_update": "2026-04-29T10:00:00",
                    "error": None,
                }
            ],
            "last_update": "2026-04-29T10:00:00",
            "error": None,
            "fallback_used": False,
            "source": "binance",
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_crypto()

        self.assertEqual(payload["source"], "binance")
        self.assertFalse(payload["fallback_used"])
        self.assertEqual(payload["items"][0]["symbol"], "BTC")
        self.assertIn("price", payload["items"][0])
        self.assertIn("change", payload["items"][0])
        self.assertIn("trend", payload["items"][0])
        self.assertIn("last_update", payload["items"][0])
        self.assertIn("error", payload["items"][0])

    def test_get_crypto_falls_back_to_last_successful_snapshot(self) -> None:
        service = MarketOverviewService()
        service._market_data_cache["crypto"] = {
            "items": [
                {
                    "symbol": "BTC",
                    "price": 73000.0,
                    "change": 0.5,
                    "trend": [70000.0, 72000.0, 73000.0],
                    "last_update": "2026-04-29T09:00:00",
                    "error": None,
                }
            ],
            "last_update": "2026-04-29T09:00:00",
            "error": None,
            "fallback_used": False,
            "source": "binance",
        }

        with patch.object(service, "_fetch_crypto_market_snapshot", side_effect=RuntimeError("binance down")):
            payload = service.get_crypto()

        self.assertTrue(payload["fallback_used"])
        self.assertEqual(payload["items"][0]["price"], 73000.0)
        self.assertIn("binance down", payload["error"])

    def test_get_crypto_uses_cache_within_ttl(self) -> None:
        calls = 0

        def fetcher(self: MarketOverviewService) -> dict:
            nonlocal calls
            calls += 1
            updated_at = datetime(2026, 4, 30, 10, calls, tzinfo=CN_TZ).isoformat(timespec="seconds")
            return {
                "items": [
                    {
                        "symbol": "BTC",
                        "price": 70000 + calls,
                        "change": 1.0,
                        "trend": [69000, 70000 + calls],
                        "last_update": updated_at,
                        "source": "binance",
                    }
                ],
                "last_update": updated_at,
                "source": "binance",
                "fallback_used": False,
            }

        with patch.object(MarketOverviewService, "_fetch_crypto_market_snapshot", fetcher):
            first = market.get_crypto()
            second = market.get_crypto()

        self.assertEqual(calls, 1)
        self.assertEqual(second["items"][0]["price"], first["items"][0]["price"])
        self.assertIn("isRefreshing", second)


if __name__ == "__main__":
    unittest.main()
