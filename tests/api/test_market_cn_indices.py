# -*- coding: utf-8 -*-
"""Contract and fallback tests for China index market endpoint."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService, get_freshness_status


CN_TZ = timezone(timedelta(hours=8))


class MarketCnIndicesApiTestCase(unittest.TestCase):
    def test_cn_indices_endpoint_returns_stable_contract(self) -> None:
        payload = market.get_cn_indices()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["sourceLabel"])
        self.assertTrue(payload["updatedAt"])
        self.assertIn(payload["freshness"], {"live", "delayed", "cached", "stale", "fallback", "mock", "error"})
        self.assertIn("isFallback", payload)
        self.assertIn("isStale", payload)
        self.assertTrue(payload["items"])
        first_item = payload["items"][0]
        self.assertIsInstance(first_item["name"], str)
        self.assertIsInstance(first_item["symbol"], str)
        self.assertIsInstance(first_item["value"], (int, float))
        self.assertIn("change", first_item)
        self.assertIn("changePercent", first_item)
        self.assertIn("source", first_item)
        self.assertIn("sourceLabel", first_item)
        self.assertIn("freshness", first_item)
        self.assertIn("isFallback", first_item)
        self.assertIn("warning", first_item)
        self.assertIsInstance(first_item["sparkline"], list)
        self.assertIn(first_item["market"], {"CN", "HK", "Futures"})

    def test_cn_indices_fallback_is_not_empty_when_provider_fails(self) -> None:
        service = MarketOverviewService()

        with patch.object(service, "_fetch_sina_cn_index_quotes", side_effect=RuntimeError("provider down")):
            payload = service.get_cn_indices()

        self.assertEqual(payload["source"], "fallback")
        self.assertEqual(payload["freshness"], "fallback")
        self.assertTrue(payload["fallbackUsed"])
        self.assertTrue(payload["isFallback"])
        self.assertTrue(payload["items"])
        self.assertEqual(payload["items"][0]["freshness"], "fallback")
        self.assertTrue(payload["items"][0]["isFallback"])
        self.assertEqual(payload["items"][0]["warning"], "备用示例数据，不代表当前行情")

    def test_freshness_helper_never_marks_fallback_live(self) -> None:
        now = datetime(2026, 4, 30, 10, 0, tzinfo=CN_TZ)
        status = get_freshness_status(now.isoformat(), "crypto", "fallback", True, now=now)

        self.assertEqual(status["freshness"], "fallback")
        self.assertTrue(status["isFallback"])
        self.assertTrue(status["warning"])

    def test_freshness_helper_marks_old_crypto_stale(self) -> None:
        now = datetime(2026, 4, 30, 10, 0, tzinfo=CN_TZ)
        as_of = now - timedelta(minutes=20)
        status = get_freshness_status(as_of.isoformat(), "crypto", "binance", False, now=now)

        self.assertEqual(status["freshness"], "stale")
        self.assertTrue(status["isStale"])

    def test_cn_indices_supports_mixed_item_level_metadata(self) -> None:
        service = MarketOverviewService()
        now = datetime(2026, 4, 30, 10, 0, tzinfo=CN_TZ).isoformat(timespec="seconds")
        quote = {
            "000001.SH": {
                "name": "上证指数",
                "symbol": "000001.SH",
                "value": 4107.51,
                "change": 28.88,
                "changePercent": 0.71,
                "sparkline": [4078.63, 4107.51],
                "asOf": now,
            }
        }

        with patch.object(service, "_fetch_sina_cn_index_quotes", return_value=quote):
            payload = service.get_cn_indices()

        self.assertEqual(payload["source"], "mixed")
        live_item = next(item for item in payload["items"] if item["symbol"] == "000001.SH")
        fallback_item = next(item for item in payload["items"] if item["symbol"] == "399001.SZ")
        self.assertEqual(live_item["source"], "sina")
        self.assertEqual(live_item["sourceLabel"], "新浪财经")
        self.assertFalse(live_item["isFallback"])
        self.assertEqual(fallback_item["freshness"], "fallback")
        self.assertTrue(fallback_item["isFallback"])


if __name__ == "__main__":
    unittest.main()
