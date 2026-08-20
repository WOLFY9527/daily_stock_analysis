# -*- coding: utf-8 -*-
"""Contract and fallback tests for China short-term sentiment endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCnShortSentimentApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        MarketOverviewService._market_cache.clear()
        MarketOverviewService._market_data_cache.clear()

    def test_get_cn_short_sentiment_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_cn_short_sentiment.return_value = {
            "source": "unavailable",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "asOf": None,
            "freshness": "unavailable",
            "isFallback": False,
            "isUnavailable": True,
            "sentimentScore": None,
            "summary": "真实短线情绪观察暂不可用",
            "metrics": {
                "limitUpCount": None,
                "limitDownCount": None,
                "failedLimitUpRate": None,
                "maxConsecutiveLimitUps": None,
                "yesterdayLimitUpPerformance": None,
                "firstBoardCount": None,
                "secondBoardCount": None,
                "highBoardCount": None,
                "twentyCmLimitUpCount": None,
                "stRiskLevel": "unknown",
            },
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_cn_short_sentiment()

        self.assertEqual(payload["source"], "unavailable")
        self.assertTrue(payload["updatedAt"])
        self.assertIsNone(payload["asOf"])
        self.assertEqual(payload["freshness"], "unavailable")
        self.assertFalse(payload["isFallback"])
        self.assertTrue(payload["isUnavailable"])
        self.assertIsNone(payload["sentimentScore"])
        self.assertEqual(payload["summary"], "真实短线情绪观察暂不可用")
        for key in (
            "limitUpCount",
            "limitDownCount",
            "failedLimitUpRate",
            "maxConsecutiveLimitUps",
            "yesterdayLimitUpPerformance",
            "firstBoardCount",
            "secondBoardCount",
            "highBoardCount",
            "twentyCmLimitUpCount",
            "stRiskLevel",
        ):
            self.assertIn(key, payload["metrics"])
        for key, value in payload["metrics"].items():
            if key != "stRiskLevel":
                self.assertIsNone(value)

    def test_get_cn_short_sentiment_falls_back_when_public_source_fails(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_fetch_cn_short_sentiment_snapshot", side_effect=RuntimeError("source down")):
            payload = service.get_cn_short_sentiment()

        self.assertEqual(payload["source"], "unavailable")
        self.assertTrue(payload["updatedAt"])
        self.assertIsNone(payload["asOf"])
        self.assertEqual(payload["freshness"], "unavailable")
        self.assertFalse(payload["isFallback"])
        self.assertTrue(payload["isUnavailable"])
        self.assertIsNone(payload["sentimentScore"])
        self.assertTrue(payload["metrics"])
        self.assertTrue(all(value is None for key, value in payload["metrics"].items() if key != "stRiskLevel"))


if __name__ == "__main__":
    unittest.main()
