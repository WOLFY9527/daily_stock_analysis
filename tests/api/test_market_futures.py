# -*- coding: utf-8 -*-
"""Contract and fallback tests for futures and premarket endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketFuturesApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        MarketOverviewService._market_cache.clear()
        MarketOverviewService._market_data_cache.clear()

    def test_get_futures_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_futures.return_value = {
            "source": "fallback",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "items": [
                {
                    "name": "纳指期货",
                    "symbol": "NQ",
                    "value": 18420.5,
                    "change": 65.2,
                    "changePercent": 0.35,
                    "market": "US",
                    "session": "premarket",
                    "sparkline": [18320, 18380, 18420.5],
                    "source": "fallback",
                    "updatedAt": "2026-04-30T10:00:00+08:00",
                }
            ],
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_futures()

        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])
        item = payload["items"][0]
        for key in ("name", "symbol", "value", "change", "changePercent", "market", "session", "sparkline", "source", "updatedAt"):
            self.assertIn(key, item)

    def test_get_futures_falls_back_when_public_source_fails(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_fetch_futures_snapshot", side_effect=RuntimeError("public source down")):
            payload = service.get_futures()

        self.assertIn(payload["source"], {"fallback", "mixed", "public"})
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])


if __name__ == "__main__":
    unittest.main()
