# -*- coding: utf-8 -*-
"""Contract and fallback tests for China short-term sentiment endpoint."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketCnShortSentimentApiTestCase(unittest.TestCase):
    def test_get_cn_short_sentiment_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_cn_short_sentiment.return_value = {
            "source": "fallback",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "sentimentScore": 64,
            "summary": "涨停家数占优，炸板率可控。",
            "metrics": {
                "limitUpCount": 68,
                "limitDownCount": 18,
                "failedLimitUpRate": 24.5,
                "maxConsecutiveLimitUps": 5,
                "yesterdayLimitUpPerformance": 2.8,
                "firstBoardCount": 42,
                "secondBoardCount": 12,
                "highBoardCount": 6,
                "twentyCmLimitUpCount": 9,
                "stRiskLevel": "normal",
            },
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_cn_short_sentiment()

        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["updatedAt"])
        self.assertGreaterEqual(payload["sentimentScore"], 0)
        self.assertLessEqual(payload["sentimentScore"], 100)
        self.assertTrue(payload["summary"])
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

    def test_get_cn_short_sentiment_falls_back_when_public_source_fails(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_fetch_cn_short_sentiment_snapshot", side_effect=RuntimeError("source down")):
            payload = service.get_cn_short_sentiment()

        self.assertIn(payload["source"], {"fallback", "mixed", "public"})
        self.assertTrue(payload["updatedAt"])
        self.assertGreaterEqual(payload["sentimentScore"], 0)
        self.assertLessEqual(payload["sentimentScore"], 100)
        self.assertTrue(payload["metrics"])


if __name__ == "__main__":
    unittest.main()
