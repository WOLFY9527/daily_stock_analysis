# -*- coding: utf-8 -*-
"""Contract and fallback tests for futures and premarket endpoint."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


CN_TZ = timezone(timedelta(hours=8))


class _FrameColumn:
    def __init__(self, values: list[float]) -> None:
        self._values = values

    def tolist(self) -> list[float]:
        return list(self._values)


class _HistoryFrame:
    def __init__(self, closes: list[float], *, as_of: datetime) -> None:
        self.empty = False
        self.index = [as_of - timedelta(days=1), as_of]
        self._columns = {"Close": _FrameColumn(closes)}

    def __getitem__(self, key: str) -> _FrameColumn:
        return self._columns[key]

    def __contains__(self, key: str) -> bool:
        return key in self._columns


class MarketFuturesApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        MarketOverviewService._market_cache.clear()
        MarketOverviewService._market_data_cache.clear()

    def test_get_futures_returns_contract_payload(self) -> None:
        service = MagicMock()
        service.get_futures.return_value = {
            "source": "unavailable",
            "updatedAt": "2026-04-30T10:00:00+08:00",
            "asOf": None,
            "freshness": "unavailable",
            "isFallback": False,
            "isUnavailable": True,
            "items": [
                {
                    "name": "纳指期货",
                    "symbol": "NQ",
                    "value": None,
                    "change": None,
                    "changePercent": None,
                    "market": "US",
                    "session": "premarket",
                    "sparkline": [],
                    "trend": [],
                    "source": "unavailable",
                    "updatedAt": "2026-04-30T10:00:00+08:00",
                    "asOf": None,
                    "freshness": "unavailable",
                    "isFallback": False,
                    "isUnavailable": True,
                }
            ],
        }

        with patch("api.v1.endpoints.market.MarketOverviewService", return_value=service):
            payload = market.get_futures()

        self.assertEqual(payload["source"], "unavailable")
        self.assertTrue(payload["updatedAt"])
        self.assertIsNone(payload["asOf"])
        self.assertEqual(payload["freshness"], "unavailable")
        self.assertFalse(payload["isFallback"])
        self.assertTrue(payload["isUnavailable"])
        self.assertTrue(payload["items"])
        item = payload["items"][0]
        for key in ("name", "symbol", "value", "change", "changePercent", "market", "session", "sparkline", "source", "updatedAt"):
            self.assertIn(key, item)

    def test_get_futures_falls_back_when_public_source_fails(self) -> None:
        service = MarketOverviewService()
        with patch.object(service, "_fetch_futures_snapshot", side_effect=RuntimeError("public source down")):
            payload = service.get_futures()

        self.assertEqual(payload["source"], "unavailable")
        self.assertTrue(payload["updatedAt"])
        self.assertIsNone(payload["asOf"])
        self.assertEqual(payload["freshness"], "unavailable")
        self.assertFalse(payload["isFallback"])
        self.assertTrue(payload["isUnavailable"])
        self.assertTrue(payload["items"])
        self.assertTrue(all(item["value"] is None for item in payload["items"]))
        self.assertTrue(all(item["change"] is None for item in payload["items"]))
        self.assertTrue(all(item["changePercent"] is None for item in payload["items"]))
        self.assertTrue(all(item["asOf"] is None for item in payload["items"]))
        self.assertTrue(all(item["sparkline"] == [] for item in payload["items"]))

    def test_get_futures_merges_delayed_proxy_items_onto_existing_fallback_card(self) -> None:
        service = MarketOverviewService()
        as_of = datetime.now(CN_TZ) - timedelta(minutes=20)
        frames = {
            "NQ=F": _HistoryFrame([18380.0, 18420.5], as_of=as_of),
            "ES=F": _HistoryFrame([5220.0, 5238.25], as_of=as_of),
            "YM=F": _HistoryFrame([38908.0, 38980.0], as_of=as_of),
            "RTY=F": _HistoryFrame([2098.4, 2094.6], as_of=as_of),
        }

        with patch(
            "src.services.market_overview_service.fetch_yfinance_quote_history_frame",
            side_effect=lambda ticker, *, timeout=None: frames[ticker],
        ):
            payload = service.get_futures()

        self.assertEqual(payload["source"], "mixed")
        self.assertEqual(payload["sourceType"], "unofficial_proxy")
        self.assertEqual(payload["freshness"], "proxy")
        self.assertIn("延迟", payload["warning"])
        self.assertTrue(payload["fallbackUsed"])
        self.assertFalse(payload["isFallback"])
        self.assertEqual(payload["providerHealth"]["status"], "partial")
        items_by_symbol = {item["symbol"]: item for item in payload["items"]}
        for symbol in ("NQ", "ES", "YM", "RTY"):
            self.assertEqual(items_by_symbol[symbol]["source"], "yfinance_proxy")
            self.assertEqual(items_by_symbol[symbol]["sourceType"], "unofficial_proxy")
            self.assertEqual(items_by_symbol[symbol]["freshness"], "delayed")
            self.assertFalse(items_by_symbol[symbol]["isFallback"])
            self.assertIsNotNone(items_by_symbol[symbol]["asOf"])
        for symbol in ("CN00Y", "HSI_F", "NKY_F"):
            self.assertEqual(items_by_symbol[symbol]["source"], "unavailable")
            self.assertEqual(items_by_symbol[symbol]["freshness"], "unavailable")
            self.assertFalse(items_by_symbol[symbol]["isFallback"])
            self.assertTrue(items_by_symbol[symbol]["isUnavailable"])
            self.assertIsNone(items_by_symbol[symbol]["asOf"])
            self.assertIsNone(items_by_symbol[symbol]["value"])
            self.assertIsNone(items_by_symbol[symbol]["price"])
            self.assertIsNone(items_by_symbol[symbol]["change"])
            self.assertIsNone(items_by_symbol[symbol]["changePercent"])
            self.assertEqual(items_by_symbol[symbol]["sparkline"], [])
            self.assertEqual(items_by_symbol[symbol]["trend"], [])

    def test_get_futures_returns_existing_fallback_snapshot_when_all_proxy_lookups_fail(self) -> None:
        service = MarketOverviewService()

        with patch(
            "src.services.market_overview_service.fetch_yfinance_quote_history_frame",
            side_effect=RuntimeError("proxy down"),
        ):
            payload = service.get_futures()

        self.assertEqual(payload["source"], "unavailable")
        self.assertEqual(payload["freshness"], "unavailable")
        self.assertFalse(payload["isFallback"])
        self.assertTrue(payload["fallbackUsed"])
        self.assertTrue(payload["isUnavailable"])
        self.assertIsNone(payload["asOf"])
        self.assertEqual(payload["providerHealth"]["status"], "unavailable")
        self.assertTrue(all(item["source"] == "unavailable" for item in payload["items"]))
        self.assertTrue(all(item["isUnavailable"] for item in payload["items"]))
        self.assertTrue(all(item["value"] is None for item in payload["items"]))
        self.assertTrue(all(item["asOf"] is None for item in payload["items"]))

    def test_get_futures_keeps_failed_proxy_symbol_on_item_level_fallback(self) -> None:
        service = MarketOverviewService()
        as_of = datetime.now(CN_TZ) - timedelta(minutes=20)
        frames = {
            "NQ=F": _HistoryFrame([18380.0, 18420.5], as_of=as_of),
            "ES=F": _HistoryFrame([5220.0, 5238.25], as_of=as_of),
            "YM=F": _HistoryFrame([38908.0, 38980.0], as_of=as_of),
        }

        def _fetch_frame(ticker: str, *, timeout: float | None = None) -> _HistoryFrame:
            if ticker == "RTY=F":
                raise RuntimeError("proxy timeout")
            return frames[ticker]

        with patch(
            "src.services.market_overview_service.fetch_yfinance_quote_history_frame",
            side_effect=_fetch_frame,
        ):
            payload = service.get_futures()

        items_by_symbol = {item["symbol"]: item for item in payload["items"]}
        self.assertEqual(payload["source"], "mixed")
        self.assertEqual(payload["providerHealth"]["status"], "partial")
        self.assertIn("部分品种暂不可用，未显示示例数值", payload["warning"])
        self.assertEqual(items_by_symbol["NQ"]["source"], "yfinance_proxy")
        self.assertEqual(items_by_symbol["RTY"]["source"], "unavailable")
        self.assertEqual(items_by_symbol["RTY"]["freshness"], "unavailable")
        self.assertFalse(items_by_symbol["RTY"]["isFallback"])
        self.assertTrue(items_by_symbol["RTY"]["isUnavailable"])
        self.assertIsNone(items_by_symbol["RTY"]["asOf"])
        self.assertIsNone(items_by_symbol["RTY"]["value"])
        self.assertIsNone(items_by_symbol["RTY"]["price"])
        self.assertIsNone(items_by_symbol["RTY"]["change"])
        self.assertIsNone(items_by_symbol["RTY"]["changePercent"])
        self.assertEqual(items_by_symbol["RTY"]["sparkline"], [])
        self.assertEqual(items_by_symbol["RTY"]["trend"], [])


if __name__ == "__main__":
    unittest.main()
