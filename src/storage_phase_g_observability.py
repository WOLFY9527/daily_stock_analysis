# -*- coding: utf-8 -*-
"""Phase G observability helpers for DatabaseManager."""

from __future__ import annotations

from typing import Any


def build_phase_g_execution_log_status(
    manager: Any,
    *,
    topology: dict[str, Any],
    include_connection_probe: bool = False,
) -> dict[str, Any]:
    phase_g_report = topology["stores"]["phase_g"]
    phase_g_enabled = bool(getattr(manager, "_phase_g_enabled", False))
    phase_g_store = getattr(manager, "_phase_g_store", None)
    if not phase_g_enabled or phase_g_store is None:
        return {
            "bridge_enabled": bool(topology["postgres_bridge"]["enabled"]),
            "shadow_enabled": False,
            "mode": phase_g_report["mode"],
            "shadow_store": "phase_g",
            "shadow_entities": ["execution_sessions", "execution_events"],
            "primary_runtime": {
                "store": "sqlite",
                "session_entity": "execution_log_sessions",
                "event_entity": "execution_log_events",
            },
            "serving_flags": {
                "sqlite_primary": True,
                "pg_execution_logs_shadow": False,
                "pg_execution_logs_are_serving_truth": False,
            },
            "serving_semantics": topology["serving_semantics"]["phase_g"],
            "schema": phase_g_report["schema"],
            "connection": phase_g_report["connection"],
        }

    return phase_g_store.describe_execution_log_status(
        bridge_enabled=bool(topology["postgres_bridge"]["enabled"]),
        include_connection_probe=include_connection_probe,
        serving_semantics=topology["serving_semantics"]["phase_g"],
    )

