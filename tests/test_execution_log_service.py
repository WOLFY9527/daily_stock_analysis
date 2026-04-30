# -*- coding: utf-8 -*-
"""Focused tests for global admin observability metadata."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from src.storage import DatabaseManager
from src.services.execution_log_service import ExecutionLogService


class ExecutionLogServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        DatabaseManager.reset_instance()
        self.db = DatabaseManager(db_url="sqlite:///:memory:")

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()

    def test_start_session_persists_actor_scope_metadata_for_user_activity(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            session_id = service.start_session(
                task_id="task-1",
                stock_code="600519",
                stock_name="贵州茅台",
                configured_execution={"request_source": "web"},
                actor={
                    "user_id": "user-1",
                    "username": "alice",
                    "display_name": "Alice",
                    "role": "user",
                },
                subsystem="analysis",
            )
            detail = service.get_session_detail(session_id)

        self.assertIsNotNone(detail)
        readable = detail["readable_summary"]
        self.assertEqual(readable["actor_display"], "Alice")
        self.assertEqual(readable["actor_role"], "user")
        self.assertEqual(readable["session_kind"], "user_activity")
        self.assertEqual(readable["subsystem"], "analysis")

    def test_record_admin_action_persists_global_admin_observability_fields(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            session_id = service.record_admin_action(
                action="factory_reset_system",
                message="Factory reset completed",
                actor={
                    "user_id": "bootstrap-admin",
                    "username": "admin",
                    "display_name": "Bootstrap Admin",
                    "role": "admin",
                },
                subsystem="system_control",
                destructive=True,
                detail={"counts": {"users": 2}},
            )
            sessions, total = service.list_sessions(limit=10)
            detail = service.get_session_detail(session_id)

        self.assertEqual(total, 1)
        self.assertEqual(sessions[0]["readable_summary"]["session_kind"], "admin_action")
        self.assertEqual(sessions[0]["readable_summary"]["actor_role"], "admin")
        self.assertEqual(sessions[0]["readable_summary"]["action_name"], "factory_reset_system")
        self.assertTrue(sessions[0]["readable_summary"]["destructive"])
        self.assertEqual(detail["events"][0]["detail"]["action"], "factory_reset_system")

    def test_record_market_overview_fetch_persists_panel_audit_fields(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            session_id = service.record_market_overview_fetch(
                panel_name="VolatilityCard",
                endpoint_url="/api/v1/market-overview/volatility",
                status="failure",
                fetch_timestamp="2026-04-29T10:00:00",
                error_message="provider timeout",
                raw_response={"cache": "stale_or_fallback", "error": "provider timeout"},
                actor={"user_id": "user-1", "username": "alice", "role": "user"},
            )
            detail = service.get_session_detail(session_id)

        self.assertIsNotNone(detail)
        self.assertEqual(detail["readable_summary"]["subsystem"], "data_source")
        self.assertEqual(detail["events"][0]["phase"], "data_source")
        self.assertEqual(detail["events"][0]["level"], "WARNING")
        self.assertEqual(detail["events"][0]["category"], "data_source")
        self.assertEqual(detail["events"][0]["detail"]["panel_name"], "VolatilityCard")
        self.assertEqual(detail["events"][0]["detail"]["endpoint_url"], "/api/v1/market-overview/volatility")
        self.assertEqual(detail["events"][0]["detail"]["raw_response"], {"cache": "stale_or_fallback", "error": "provider timeout"})

    def test_list_sessions_filters_by_task_id(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            service.start_session(
                task_id="task-a",
                stock_code="TSLA",
                stock_name="Tesla",
                configured_execution={},
                actor={"user_id": "user-1", "role": "user"},
                subsystem="analysis",
            )
            service.start_session(
                task_id="task-b",
                stock_code="NVDA",
                stock_name="NVIDIA",
                configured_execution={},
                actor={"user_id": "user-1", "role": "user"},
                subsystem="analysis",
            )

            items, total = service.list_sessions(task_id="task-b", limit=10)

        self.assertEqual(total, 1)
        self.assertEqual(items[0]["task_id"], "task-b")

    def test_analysis_detail_exposes_operation_log_contract_with_fallback_diagnostics(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            session_id = service.start_session(
                task_id="task-tsla",
                stock_code="TSLA",
                stock_name="Tesla",
                configured_execution={},
                actor={"user_id": "user-1", "role": "user"},
                subsystem="analysis",
            )
            service.append_runtime_result(
                session_id=session_id,
                runtime_execution={
                    "score": 5.2,
                    "ai": {
                        "model": "alpaca",
                        "gateway": "deepseek",
                        "fallback_occurred": True,
                        "attempt_chain": [
                            {
                                "model": "gemini-2.5-flash",
                                "version": "2.5-flash",
                                "status": "failed",
                                "reason": "Service unavailable, code 503",
                            },
                            {
                                "model": "alpaca",
                                "version": "fallback",
                                "status": "succeeded",
                                "message": "Fallback after primary failed",
                            },
                        ],
                    },
                    "data": {
                        "market": {
                            "source": "Finnhub",
                            "status": "succeeded",
                            "source_chain": [
                                {
                                    "source": "Yahoo Finance",
                                    "status": "failed",
                                    "reason": "Timeout error",
                                    "response": {"status_code": 504},
                                    "stack_trace": "TimeoutError: Yahoo Finance",
                                },
                                {
                                    "source": "Finnhub",
                                    "status": "succeeded",
                                    "message": "Data fetched",
                                },
                            ],
                        },
                    },
                },
                notification_result={"status": "not_configured"},
                query_id="query-tsla",
                overall_status="partial_success",
            )
            items, _ = service.list_sessions(limit=10)
            detail = service.get_session_detail(session_id)

        self.assertEqual(items[0]["readable_summary"]["operation_category"], "single_stock_analysis")
        self.assertEqual(items[0]["readable_summary"]["operation_type"], "Single Stock Analysis")
        self.assertEqual(items[0]["readable_summary"]["operation_target"], "TSLA")
        self.assertEqual(items[0]["readable_summary"]["operation_status"], "partial fail")
        self.assertEqual(items[0]["readable_summary"]["key_metric"], "Score 5.2")

        operation_detail = detail["operation_detail"]
        self.assertEqual(operation_detail["operation_category"], "single_stock_analysis")
        self.assertEqual(operation_detail["target"], "TSLA")
        self.assertTrue(any(call["model"] == "gemini-2.5-flash" and call["status"] == "fail" for call in operation_detail["ai_calls"]))
        self.assertTrue(any(call["source"] == "Yahoo Finance" and call["status"] == "fail" for call in operation_detail["data_source_calls"]))
        self.assertTrue(any("Fallback" in item["label"] for item in operation_detail["timeline"]))
        self.assertTrue(any("Timeout error" in item["message"] for item in operation_detail["diagnostics"]))


if __name__ == "__main__":
    unittest.main()
