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

    def test_agent_tool_session_persists_tool_input_and_output_summaries(self) -> None:
        with patch("src.services.execution_log_service.get_db", return_value=self.db):
            service = ExecutionLogService()
            session_id = service.start_agent_tool_session(
                owner_id="user-1",
                actor={"user_id": "user-1", "display_name": "Alice", "role": "user"},
                conversation_session_id="chat-session-1",
                user_message="analyze tsla",
                stock_code="TSLA",
            )
            service.append_agent_tool_call(
                session_id,
                {
                    "step": 1,
                    "tool": "get_realtime_quote",
                    "arguments": {"stock_code": "TSLA"},
                    "success": True,
                    "duration": 0.12,
                    "result_length": 32,
                    "result_preview": {"price": 123.45},
                },
                user_id="user-1",
                stock_code="TSLA",
            )
            service.finalize_agent_tool_session(
                session_id,
                success=True,
                content="done",
                error=None,
                tool_calls_log=[
                    {
                        "step": 1,
                        "tool": "get_realtime_quote",
                        "arguments": {"stock_code": "TSLA"},
                        "success": True,
                    }
                ],
                stock_code="TSLA",
            )
            detail = service.get_session_detail(session_id)

        self.assertIsNotNone(detail)
        self.assertEqual(detail["summary"]["agent_chat"]["tool_call_count"], 1)
        tool_events = [event for event in detail["events"] if event["phase"] == "agent_tool"]
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0]["detail"]["stock_code"], "TSLA")
        self.assertEqual(tool_events[0]["detail"]["input_summary"]["stock_code"], "TSLA")
        self.assertEqual(tool_events[0]["detail"]["output_summary"]["price"], 123.45)


if __name__ == "__main__":
    unittest.main()
