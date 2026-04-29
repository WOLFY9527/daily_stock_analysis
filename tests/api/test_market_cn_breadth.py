# -*- coding: utf-8 -*-
"""Contract and fallback tests for China market breadth endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCnBreadthApiTestCase(unittest.TestCase):
    def test_cn_breadth_endpoint_returns_stable_contract(self) -> None:
        payload = market.get_cn_breadth()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])
        metrics = {item["symbol"]: item for item in payload["items"]}
        self.assertIn("EFFECT", metrics)
        self.assertIsInstance(metrics["EFFECT"]["value"], (int, float))
        self.assertIn("explanation", payload)

    def test_cn_breadth_fallback_is_not_empty_when_provider_fails(self) -> None:
        service = MarketOverviewService()

        with patch.object(service, "_fetch_cn_breadth_snapshot", side_effect=RuntimeError("provider down")):
            payload = service.get_cn_breadth()

        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["fallbackUsed"])
        self.assertTrue(payload["items"])


if __name__ == "__main__":
    unittest.main()
