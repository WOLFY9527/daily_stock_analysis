# -*- coding: utf-8 -*-
"""Contract and fallback tests for China and Hong Kong flow endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCnFlowsApiTestCase(unittest.TestCase):
    def test_cn_flows_endpoint_returns_stable_contract(self) -> None:
        payload = market.get_cn_flows()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])
        symbols = {item["symbol"] for item in payload["items"]}
        self.assertIn("NORTHBOUND", symbols)
        self.assertIn("SOUTHBOUND", symbols)
        for item in payload["items"]:
            self.assertIsInstance(item["value"], (int, float))
            self.assertIn("changePercent", item)

    def test_cn_flows_fallback_is_not_empty_when_provider_fails(self) -> None:
        service = MarketOverviewService()

        with patch.object(service, "_fetch_cn_flows_snapshot", side_effect=RuntimeError("provider down")):
            payload = service.get_cn_flows()

        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["fallbackUsed"])
        self.assertTrue(payload["items"])


if __name__ == "__main__":
    unittest.main()
