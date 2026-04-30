# -*- coding: utf-8 -*-
"""Unit tests for market data cache stale-while-revalidate behavior."""

from __future__ import annotations

import threading
import time
import unittest
from datetime import timedelta
from unittest.mock import Mock

from src.services.market_cache import MarketCache


class MarketCacheTestCase(unittest.TestCase):
    def test_fresh_cache_hit_does_not_call_fetcher(self) -> None:
        cache = MarketCache(max_workers=1)
        cache.set("crypto", {"source": "binance", "value": 1}, ttl_seconds=30)
        fetcher = Mock(return_value={"source": "binance", "value": 2})

        payload = cache.get_or_refresh("crypto", 30, fetcher)

        self.assertEqual(payload["value"], 1)
        fetcher.assert_not_called()

    def test_cold_cache_fetches_and_stores_payload(self) -> None:
        cache = MarketCache(max_workers=1)
        fetcher = Mock(return_value={"source": "binance", "value": 2})

        payload = cache.get_or_refresh("crypto", 30, fetcher)

        self.assertEqual(payload["value"], 2)
        self.assertEqual(cache.get("crypto").data["value"], 2)
        fetcher.assert_called_once()

    def test_cold_cache_slow_fetcher_returns_fallback_and_refreshes_later(self) -> None:
        cache = MarketCache(max_workers=1)
        release_fetch = threading.Event()

        def fetcher() -> dict:
            release_fetch.wait(2)
            return {"source": "binance", "value": 2}

        start = time.monotonic()
        payload = cache.get_or_refresh(
            "crypto",
            30,
            fetcher,
            fallback_factory=lambda: {"source": "fallback", "value": 1, "freshness": "fallback", "isFallback": True},
            cold_start_timeout_seconds=0.05,
        )
        elapsed = time.monotonic() - start

        self.assertLess(elapsed, 0.5)
        self.assertEqual(payload["value"], 1)
        self.assertTrue(payload["isRefreshing"])
        release_fetch.set()
        self.assertTrue(cache.wait_for_refreshes(timeout=2))
        refreshed = cache.get_or_refresh(
            "crypto",
            30,
            Mock(side_effect=AssertionError("fresh cache should not fetch")),
        )
        self.assertEqual(refreshed["value"], 2)
        self.assertFalse(refreshed["isRefreshing"])

    def test_expired_cache_returns_stale_payload_and_marks_refreshing(self) -> None:
        cache = MarketCache(max_workers=1)
        cache.set("crypto", {"source": "binance", "value": 1}, ttl_seconds=1)
        cache.get("crypto").expires_at = cache.get("crypto").fetched_at - timedelta(seconds=1)
        refresh_started = threading.Event()
        release_refresh = threading.Event()

        def fetcher() -> dict:
            refresh_started.set()
            release_refresh.wait(2)
            return {"source": "binance", "value": 2}

        payload = cache.get_or_refresh("crypto", 1, fetcher, allow_stale=True, background_refresh=True)

        self.assertEqual(payload["value"], 1)
        self.assertTrue(payload["isRefreshing"])
        self.assertTrue(refresh_started.wait(1))
        release_refresh.set()
        self.assertTrue(cache.wait_for_refreshes(timeout=2))

    def test_expired_cache_starts_only_one_background_refresh(self) -> None:
        cache = MarketCache(max_workers=2)
        cache.set("crypto", {"source": "binance", "value": 1}, ttl_seconds=1)
        cache.get("crypto").expires_at = cache.get("crypto").fetched_at - timedelta(seconds=1)
        release_refresh = threading.Event()
        calls = 0
        calls_lock = threading.Lock()

        def fetcher() -> dict:
            nonlocal calls
            with calls_lock:
                calls += 1
            release_refresh.wait(2)
            return {"source": "binance", "value": 2}

        payloads = [cache.get_or_refresh("crypto", 1, fetcher) for _ in range(5)]

        self.assertTrue(all(payload["isRefreshing"] for payload in payloads))
        release_refresh.set()
        self.assertTrue(cache.wait_for_refreshes(timeout=2))
        self.assertEqual(calls, 1)

    def test_fetcher_failure_uses_fallback_without_changing_freshness(self) -> None:
        cache = MarketCache(max_workers=1)

        payload = cache.get_or_refresh(
            "cn_indices",
            30,
            Mock(side_effect=RuntimeError("provider down")),
            fallback_factory=lambda: {"source": "fallback", "freshness": "fallback", "isFallback": True},
        )

        self.assertEqual(payload["source"], "fallback")
        self.assertEqual(payload["freshness"], "fallback")
        self.assertTrue(payload["isFallback"])

    def test_background_refresh_failure_preserves_stale_payload_with_warning(self) -> None:
        cache = MarketCache(max_workers=1)
        cache.set("sentiment", {"source": "cnn", "value": 10}, ttl_seconds=1)
        entry = cache.get("sentiment")
        entry.expires_at = entry.fetched_at - timedelta(seconds=1)

        first_payload = cache.get_or_refresh(
            "sentiment",
            1,
            Mock(side_effect=RuntimeError("cnn unavailable")),
            allow_stale=True,
            background_refresh=True,
        )
        self.assertTrue(first_payload["isRefreshing"])
        self.assertTrue(cache.wait_for_refreshes(timeout=2))

        second_payload = cache.get_or_refresh(
            "sentiment",
            1,
            Mock(side_effect=RuntimeError("still down")),
            allow_stale=True,
            background_refresh=False,
        )

        self.assertEqual(second_payload["value"], 10)
        self.assertEqual(cache.get("sentiment").data["value"], 10)
        self.assertEqual(second_payload["warning"], "数据源刷新失败，当前显示最近快照")
        self.assertIn("cnn unavailable", second_payload["lastError"])

    def test_concurrent_cold_requests_only_call_fetcher_once(self) -> None:
        cache = MarketCache(max_workers=2)
        calls = 0
        calls_lock = threading.Lock()
        release_fetch = threading.Event()

        def fetcher() -> dict:
            nonlocal calls
            with calls_lock:
                calls += 1
            time.sleep(0.05)
            release_fetch.wait(2)
            return {"source": "binance", "value": 7}

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(cache.get_or_refresh("crypto", 30, fetcher)))
            for _ in range(10)
        ]
        for thread in threads:
            thread.start()
        time.sleep(0.1)
        release_fetch.set()
        for thread in threads:
            thread.join(2)

        self.assertEqual(calls, 1)
        self.assertEqual(len(results), 10)
        self.assertTrue(all(payload["value"] == 7 for payload in results))


if __name__ == "__main__":
    unittest.main()
