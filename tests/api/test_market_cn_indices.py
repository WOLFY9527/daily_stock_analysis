# -*- coding: utf-8 -*-
"""Contract and fallback tests for China index market endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCnIndicesApiTestCase(unittest.TestCase):
    def test_cn_indices_endpoint_returns_stable_contract(self) -> None:
        payload = market.get_cn_indices()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])
        first_item = payload["items"][0]
        self.assertIsInstance(first_item["name"], str)
        self.assertIsInstance(first_item["symbol"], str)
        self.assertIsInstance(first_item["value"], (int, float))
        self.assertIn("change", first_item)
        self.assertIn("changePercent", first_item)
        self.assertIsInstance(first_item["sparkline"], list)
        self.assertIn(first_item["market"], {"CN", "HK", "Futures"})

    def test_cn_indices_fallback_is_not_empty_when_provider_fails(self) -> None:
        service = MarketOverviewService()

        with patch.object(service, "_fetch_cn_indices_snapshot", side_effect=RuntimeError("provider down")):
            payload = service.get_cn_indices()

        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["fallbackUsed"])
        self.assertTrue(payload["items"])


if __name__ == "__main__":
    unittest.main()
