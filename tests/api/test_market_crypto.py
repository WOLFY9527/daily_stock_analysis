# -*- coding: utf-8 -*-
"""Contract and fallback tests for market crypto endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCryptoApiTestCase(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
