# -*- coding: utf-8 -*-
"""Topology/bootstrap reporting helpers for DatabaseManager."""

from __future__ import annotations

from typing import Any

from src.postgres_store_utils import redact_database_url
from src.storage_postgres_bridge import PhaseStoreSpec, iter_phase_store_specs


def build_disabled_store_runtime(
    spec: PhaseStoreSpec,
    *,
    bridge_url: str | None,
) -> dict[str, Any]:
    store_cls = spec.store_cls
    return {
        "mode": getattr(store_cls, "MODE", "disabled"),
        "dialect": None,
        "schema": {
            "schema_key": getattr(store_cls, "SCHEMA_KEY", spec.phase_key),
            "source_path": None,
            "expected_tables": sorted(getattr(store_cls, "EXPECTED_TABLES", [])),
            "expected_indexes": sorted(getattr(store_cls, "EXPECTED_INDEXES", [])),
            "expected_constraints": [
                {"table": table_name, "name": constraint_name}
                for table_name, constraint_name in getattr(
                    store_cls,
                    "EXPECTED_CONSTRAINTS",
                    (),
                )
            ],
            "present_tables": [],
            "missing_tables": sorted(getattr(store_cls, "EXPECTED_TABLES", [])),
            "present_indexes": [],
            "missing_indexes": sorted(getattr(store_cls, "EXPECTED_INDEXES", [])),
            "last_apply_status": "bridge_not_configured" if not bridge_url else "not_initialized",
            "skip_reason": "postgres_bridge_disabled" if not bridge_url else "store_not_initialized",
            "last_error": None,
            "last_apply_statement_count": 0,
            "bootstrap_recorded": False,
            "bootstrap": None,
        },
        "connection": {
            "requested": False,
            "ok": None,
            "error": None,
        },
    }


def build_database_topology_report(
    manager: Any,
    *,
    config: Any,
    include_connection_probe: bool = False,
) -> dict[str, Any]:
    bridge_url = str(getattr(manager, "_postgres_bridge_url", "") or "").strip() or None
    stores: dict[str, Any] = {}
    recorded_schema_keys: list[str] = []

    for spec in iter_phase_store_specs():
        enabled = bool(getattr(manager, spec.enabled_attr, False))
        store = getattr(manager, spec.store_attr, None)
        if enabled and store is not None:
            phase_report = store.describe_runtime(include_connection_probe=include_connection_probe)
        else:
            phase_report = build_disabled_store_runtime(spec, bridge_url=bridge_url)

        phase_report["enabled"] = enabled
        stores[spec.phase_key] = phase_report
        if phase_report["schema"].get("bootstrap_recorded"):
            recorded_schema_keys.append(spec.phase_key)

    return {
        "primary_runtime": "sqlite",
        "sqlite": {
            "role": "primary_runtime",
            "url": redact_database_url(str(manager._engine.url)),
            "dialect": manager._engine.dialect.name,
        },
        "postgres_bridge": {
            "configured": bool(bridge_url),
            "enabled": any(phase_state.get("enabled") for phase_state in stores.values()),
            "url": redact_database_url(bridge_url or ""),
            "config_env_var": "POSTGRES_PHASE_A_URL",
            "apply_schema_env_var": "POSTGRES_PHASE_A_APPLY_SCHEMA",
            "auto_apply_schema": bool(getattr(manager, "_postgres_bridge_auto_apply_schema", True)),
        },
        "serving_semantics": {
            "sqlite": "primary",
            "phase_f": "legacy_serving_pg_comparison_only",
            "phase_g": "env_live_source_pg_snapshot_shadow",
        },
        "coexistence_features": {
            "phase_f_trades_list_comparison_enabled": bool(
                getattr(config, "enable_phase_f_trades_list_comparison", False)
            ),
            "phase_f_trades_list_comparison_account_ids": list(
                getattr(config, "phase_f_trades_list_comparison_account_ids", []) or []
            ),
            "phase_f_cash_ledger_comparison_enabled": bool(
                getattr(config, "enable_phase_f_cash_ledger_comparison", False)
            ),
            "phase_f_cash_ledger_comparison_account_ids": list(
                getattr(config, "phase_f_cash_ledger_comparison_account_ids", []) or []
            ),
            "phase_f_corporate_actions_comparison_enabled": bool(
                getattr(config, "enable_phase_f_corporate_actions_comparison", False)
            ),
            "phase_f_corporate_actions_comparison_account_ids": list(
                getattr(config, "phase_f_corporate_actions_comparison_account_ids", []) or []
            ),
        },
        "bootstrap_registry": {
            "recorded_schema_keys": sorted(recorded_schema_keys),
        },
        "stores": stores,
    }


def build_topology_log_summary(topology: dict[str, Any]) -> dict[str, Any]:
    enabled_store_names = [
        phase_key
        for phase_key, phase_state in topology["stores"].items()
        if phase_state.get("enabled")
    ]
    return {
        "primary_runtime": topology["primary_runtime"],
        "postgres_bridge_enabled": bool(topology["postgres_bridge"]["enabled"]),
        "enabled_stores": enabled_store_names,
        "phase_f_mode": topology["stores"]["phase_f"]["mode"],
        "phase_g_mode": topology["stores"]["phase_g"]["mode"],
    }


def build_degraded_topology_report(
    manager: Any,
    *,
    config: Any,
    error: str,
) -> dict[str, Any]:
    topology = build_database_topology_report(
        manager,
        config=config,
        include_connection_probe=False,
    )
    topology["report_error"] = {
        "kind": "topology_report_failed",
        "error": error,
    }
    for phase_report in topology["stores"].values():
        phase_report["enabled"] = False
        phase_report["connection"] = {
            "requested": False,
            "ok": None,
            "error": None,
        }
        phase_report["schema"]["last_apply_status"] = "report_failed"
        phase_report["schema"]["bootstrap_recorded"] = False
        phase_report["schema"]["bootstrap"] = None
    topology["postgres_bridge"]["enabled"] = False
    topology["bootstrap_registry"]["recorded_schema_keys"] = []
    return topology

