# -*- coding: utf-8 -*-
"""Contract and fallback tests for market temperature endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketTemperatureApiTestCase(unittest.TestCase):
    def test_get_temperature_returns_stable_scores(self) -> None:
        service = MagicMock()
        service.get_market_temperature.return_value = {
            "source": "computed",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "scores": {
                "overall": {"value": 62, "label": "偏暖", "trend": "improving", "description": "风险偏好改善。"},
                "usRiskAppetite": {"value": 68, "label": "偏暖", "trend": "improving", "description": "美股改善。"},
                "cnMoneyEffect": {"value": 55, "label": "中性", "trend": "stable", "description": "市场宽度一般。"},
                "macroPressure": {"value": 58, "label": "中性偏高", "trend": "rising", "description": "利率压力。"},
                "liquidity": {"value": 52, "label": "中性", "trend": "stable", "description": "资金平稳。"},
            },
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_temperature()

        self.assertEqual(payload["source"], "computed")
        self.assertTrue(payload["updatedAt"])
        self.assertEqual(set(payload["scores"].keys()), {"overall", "usRiskAppetite", "cnMoneyEffect", "macroPressure", "liquidity"})
        for score in payload["scores"].values():
            self.assertGreaterEqual(score["value"], 0)
            self.assertLessEqual(score["value"], 100)
            self.assertTrue(score["label"])
            self.assertTrue(score["description"])

    def test_get_temperature_falls_back_when_inputs_fail(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_build_market_temperature_inputs", side_effect=RuntimeError("provider down")):
            payload = service.get_market_temperature()

        self.assertIn(payload["source"], {"computed", "fallback", "mixed"})
        self.assertTrue(payload["updatedAt"])
        self.assertEqual(set(payload["scores"].keys()), {"overall", "usRiskAppetite", "cnMoneyEffect", "macroPressure", "liquidity"})
        for score in payload["scores"].values():
            self.assertGreaterEqual(score["value"], 0)
            self.assertLessEqual(score["value"], 100)


if __name__ == "__main__":
    unittest.main()
