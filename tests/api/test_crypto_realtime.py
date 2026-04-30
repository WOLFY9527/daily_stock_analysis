# -*- coding: utf-8 -*-
"""Tests for crypto realtime service and SSE stream."""

from __future__ import annotations

import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1.endpoints import market
from src.services.market_cache import market_cache
from src.services.market_overview_service import MarketOverviewService


CN_TZ = timezone(timedelta(hours=8))


class CryptoRealtimeServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        market_cache.clear()
        MarketOverviewService._market_data_cache.clear()

    def test_mock_tick_builds_snapshot_for_tracked_symbols(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeService

        service = CryptoRealtimeService(auto_start=False)
        as_of = datetime.now(CN_TZ).isoformat(timespec="seconds")
        service.handle_tick({
            "symbol": "BTC",
            "price": 75800.12,
            "change": -120.5,
            "changePercent": -0.16,
            "asOf": as_of,
        })
        service.handle_tick({
            "symbol": "ETH",
            "price": 3120.4,
            "change": 10.1,
            "changePercent": 0.32,
            "asOf": as_of,
        })
        service.handle_tick({
            "symbol": "BNB",
            "price": 590.0,
            "change": 1.7,
            "changePercent": 0.29,
            "asOf": as_of,
        })

        snapshot = service.get_snapshot()

        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["source"], "binance_ws")
        self.assertEqual(snapshot["sourceLabel"], "Binance WS")
        self.assertEqual(snapshot["freshness"], "live")
        self.assertEqual({item["symbol"] for item in snapshot["items"]}, {"BTC", "ETH", "BNB"})
        btc = next(item for item in snapshot["items"] if item["symbol"] == "BTC")
        self.assertEqual(btc["value"], 75800.12)
        self.assertEqual(btc["change"], -120.5)
        self.assertEqual(btc["changePercent"], -0.16)
        self.assertEqual(btc["source"], "binance_ws")
        self.assertFalse(btc["isFallback"])

    def test_snapshot_updates_market_cache_for_rest_endpoint(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeService

        service = CryptoRealtimeService(auto_start=False)
        as_of = datetime.now(CN_TZ).isoformat(timespec="seconds")
        service.handle_tick({
            "symbol": "BTC",
            "price": 76001,
            "change": 1,
            "changePercent": 0.1,
            "asOf": as_of,
        })

        payload = MarketOverviewService().get_crypto()

        self.assertEqual(payload["source"], "binance_ws")
        self.assertEqual(payload["items"][0]["source"], "binance_ws")
        self.assertEqual(payload["items"][0]["price"], 76001)

    def test_provider_error_does_not_escape_background_runner(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeProvider, CryptoRealtimeService

        class FailingProvider(CryptoRealtimeProvider):
            async def connect(self):
                if False:
                    yield {}
                raise RuntimeError("ws down")

        service = CryptoRealtimeService(provider=FailingProvider(), auto_start=False, reconnect_delay_seconds=0.01)

        async def run_once():
            await service.run_once_for_test()

        asyncio.run(run_once())
        self.assertIsNone(service.get_snapshot())

    def test_sse_endpoint_sends_realtime_payload(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeService

        service = CryptoRealtimeService(auto_start=False)
        as_of = datetime.now(CN_TZ).isoformat(timespec="seconds")
        service.handle_tick({
            "symbol": "BTC",
            "price": 75800.12,
            "change": -120.5,
            "changePercent": -0.16,
            "asOf": as_of,
        })
        app = FastAPI()
        app.include_router(market.router, prefix="/api/v1/market")

        with patch("api.v1.endpoints.market.get_crypto_realtime_service", return_value=service):
            client = TestClient(app)
            with client.stream("GET", "/api/v1/market/crypto/stream?once=true") as response:
                line = next(line for line in response.iter_lines() if line.startswith("data: "))

        payload = json.loads(line.removeprefix("data: "))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["source"], "binance_ws")
        self.assertEqual(payload["items"][0]["symbol"], "BTC")

    def test_sse_endpoint_sends_cache_snapshot_when_realtime_empty(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeService

        service = CryptoRealtimeService(auto_start=False)
        updated_at = datetime(2026, 4, 30, 10, 0, tzinfo=CN_TZ).isoformat(timespec="seconds")
        market_cache.set(
            "crypto",
            {
                "items": [{"symbol": "BTC", "name": "Bitcoin", "value": 70000, "price": 70000, "changePercent": 0.1, "sparkline": [69900, 70000], "source": "binance"}],
                "last_update": updated_at,
                "updatedAt": updated_at,
                "asOf": updated_at,
                "source": "binance",
                "fallback_used": False,
            },
            ttl_seconds=15,
        )
        app = FastAPI()
        app.include_router(market.router, prefix="/api/v1/market")

        with patch("api.v1.endpoints.market.get_crypto_realtime_service", return_value=service):
            client = TestClient(app)
            with client.stream("GET", "/api/v1/market/crypto/stream?once=true") as response:
                line = next(line for line in response.iter_lines() if line.startswith("data: "))

        payload = json.loads(line.removeprefix("data: "))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["source"], "binance")
        self.assertEqual(payload["items"][0]["symbol"], "BTC")

    def test_stale_snapshot_is_not_marked_live(self) -> None:
        from src.services.crypto_realtime_service import CryptoRealtimeService

        service = CryptoRealtimeService(auto_start=False, stale_after_seconds=1)
        old_as_of = (datetime.now(CN_TZ) - timedelta(seconds=90)).isoformat(timespec="seconds")
        service.handle_tick({
            "symbol": "BTC",
            "price": 75800.12,
            "change": -120.5,
            "changePercent": -0.16,
            "asOf": old_as_of,
        })

        snapshot = service.get_snapshot()

        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["freshness"], "stale")
        self.assertTrue(snapshot["isStale"])
        self.assertNotEqual(snapshot["items"][0]["freshness"], "live")


if __name__ == "__main__":
    unittest.main()
