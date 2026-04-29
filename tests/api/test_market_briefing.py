# -*- coding: utf-8 -*-
"""Contract and fallback tests for market briefing endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketBriefingApiTestCase(unittest.TestCase):
    def test_get_market_briefing_returns_rule_items(self) -> None:
        service = MagicMock()
        service.get_market_briefing.return_value = {
            "source": "computed",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "items": [
                {"title": "美股风险偏好偏暖", "message": "主要指数走强。", "severity": "positive", "category": "us"},
                {"title": "A股赚钱效应中性", "message": "市场宽度一般。", "severity": "neutral", "category": "cn"},
                {"title": "宏观压力仍需关注", "message": "美元走强。", "severity": "warning", "category": "macro"},
            ],
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_market_briefing()

        self.assertEqual(payload["source"], "computed")
        self.assertTrue(payload["updatedAt"])
        self.assertGreaterEqual(len(payload["items"]), 3)
        for item in payload["items"]:
            self.assertIn(item["severity"], {"positive", "neutral", "warning", "risk"})
            self.assertTrue(item["title"])
            self.assertTrue(item["message"])
            self.assertTrue(item["category"])

    def test_get_market_briefing_falls_back_when_inputs_fail(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_build_market_temperature_inputs", side_effect=RuntimeError("provider down")):
            payload = service.get_market_briefing()

        self.assertTrue(payload["updatedAt"])
        self.assertGreaterEqual(len(payload["items"]), 3)
        for item in payload["items"]:
            self.assertIn(item["severity"], {"positive", "neutral", "warning", "risk"})


if __name__ == "__main__":
    unittest.main()
