# -*- coding: utf-8 -*-
"""Execution log write-level classification tests."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from src.services.execution_log_service import ExecutionLogService
from src.storage import DatabaseManager


class ExecutionLoggingNoiseTestCase(unittest.TestCase):
    def setUp(self) -> None:
        DatabaseManager.reset_instance()
        self.db = DatabaseManager(db_url="sqlite:///:memory:")

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()

    def test_market_cache_hit_and_prewarm_success_are_not_persisted(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            cache_session = service.record_market_overview_fetch(
                panel_name="MarketCacheHit",
                endpoint_url="/api/v1/market-overview/indices",
                status="success",
                fetch_timestamp="2026-04-30T10:00:00",
                raw_response={"cache": "hit_or_refreshed", "event_name": "MarketCacheHit"},
            )
            prewarm_session = service.record_market_overview_fetch(
                panel_name="MarketPrewarmCompleted",
                endpoint_url="/api/v1/market-overview/prewarm",
                status="success",
                fetch_timestamp="2026-04-30T10:00:01",
                raw_response={"cache": "hit_or_refreshed", "event_name": "MarketPrewarmCompleted"},
            )
            items, total = service.list_sessions(min_level="DEBUG", since="7d", limit=100)

        self.assertEqual(cache_session, "")
        self.assertEqual(prewarm_session, "")
        self.assertEqual(total, 0)
        self.assertEqual(items, [])

    def test_market_failures_timeouts_and_slow_requests_are_default_visible(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            service.record_market_overview_fetch(
                panel_name="MarketRefreshFailed",
                endpoint_url="/api/v1/market-overview/indices",
                status="failure",
                fetch_timestamp="2026-04-30T10:00:00",
                error_message="provider down",
                raw_response={"cache": "stale_or_fallback", "error": "provider down"},
            )
            service.record_market_overview_fetch(
                panel_name="ExternalSourceTimeout",
                endpoint_url="https://example.invalid/quotes",
                status="failure",
                fetch_timestamp="2026-04-30T10:00:02",
                error_message="source timeout",
                raw_response={"duration_ms": 2500, "source": "example"},
            )
            service.record_api_request(
                route="/api/v1/market-overview/indices",
                method="GET",
                status_code=200,
                duration_ms=2400,
                request_id="req-slow",
            )
            items, _ = service.list_sessions(min_level="WARNING", since="24h", limit=100)

        event_names = {item["readable_summary"]["event_name"] for item in items}
        self.assertIn("MarketRefreshFailed", event_names)
        self.assertIn("ExternalSourceTimeout", event_names)
        self.assertIn("SlowRequest", event_names)
        self.assertTrue(all(item["readable_summary"]["log_level"] in {"WARNING", "ERROR", "CRITICAL"} for item in items))


if __name__ == "__main__":
    unittest.main()
