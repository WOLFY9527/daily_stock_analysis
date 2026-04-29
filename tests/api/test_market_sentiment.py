# -*- coding: utf-8 -*-
"""Contract and fallback tests for market sentiment endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketSentimentApiTestCase(unittest.TestCase):
    def test_get_sentiment_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_market_sentiment.return_value = {
            "items": [
                {
                    "symbol": "FGI",
                    "price": 26,
                    "change": -7.0,
                    "trend": [42, 38, 33, 26],
                    "last_update": "2026-04-29T10:00:00",
                    "error": None,
                }
            ],
            "last_update": "2026-04-29T10:00:00",
            "error": None,
            "fallback_used": False,
            "source": "alternative_me",
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_sentiment()

        self.assertEqual(payload["source"], "alternative_me")
        self.assertFalse(payload["fallback_used"])
        self.assertEqual(payload["items"][0]["symbol"], "FGI")
        self.assertIn("price", payload["items"][0])
        self.assertIn("change", payload["items"][0])
        self.assertIn("trend", payload["items"][0])
        self.assertIn("last_update", payload["items"][0])
        self.assertIn("error", payload["items"][0])

    def test_get_sentiment_falls_back_to_last_successful_snapshot(self) -> None:
        service = MarketOverviewService()
        service._market_data_cache["sentiment"] = {
            "items": [
                {
                    "symbol": "FGI",
                    "price": 33,
                    "change": -2.0,
                    "trend": [38, 36, 33],
                    "last_update": "2026-04-29T09:00:00",
                    "error": None,
                }
            ],
            "last_update": "2026-04-29T09:00:00",
            "error": None,
            "fallback_used": False,
            "source": "alternative_me",
        }

        with patch.object(service, "_fetch_market_sentiment_snapshot", side_effect=RuntimeError("cnn unavailable")):
            payload = service.get_market_sentiment()

        self.assertTrue(payload["fallback_used"])
        self.assertEqual(payload["items"][0]["price"], 33)
        self.assertIn("cnn unavailable", payload["error"])


if __name__ == "__main__":
    unittest.main()
