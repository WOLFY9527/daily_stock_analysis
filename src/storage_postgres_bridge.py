# -*- coding: utf-8 -*-
"""PostgreSQL bridge helpers for DatabaseManager coordination."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from src.postgres_phase_a import PostgresPhaseAStore
from src.postgres_phase_b import PostgresPhaseBStore
from src.postgres_phase_c import PostgresPhaseCStore
from src.postgres_phase_d import PostgresPhaseDStore
from src.postgres_phase_e import PostgresPhaseEStore
from src.postgres_phase_f import PostgresPhaseFStore
from src.postgres_phase_g import PostgresPhaseGStore

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PhaseStoreSpec:
    phase_key: str
    store_attr: str
    enabled_attr: str
    store_cls: type[Any]


@dataclass(frozen=True)
class BridgeInitResult:
    initialized_phases: tuple[str, ...]
    failed_phase: str | None


class BridgeInitializationError(RuntimeError):
    """Carry partial bridge-init context back to the runtime caller."""

    def __init__(
        self,
        *,
        failed_phase: str | None,
        initialized_phases: tuple[str, ...],
        cause: Exception,
    ) -> None:
        self.failed_phase = failed_phase
        self.initialized_phases = initialized_phases
        self.cause = cause
        super().__init__(
            format_bridge_initialization_error(
                failed_phase=failed_phase,
                initialized_phases=initialized_phases,
            )
        )


_PHASE_STORE_SPECS = (
    PhaseStoreSpec("phase_a", "_phase_a_store", "_phase_a_enabled", PostgresPhaseAStore),
    PhaseStoreSpec("phase_b", "_phase_b_store", "_phase_b_enabled", PostgresPhaseBStore),
    PhaseStoreSpec("phase_c", "_phase_c_store", "_phase_c_enabled", PostgresPhaseCStore),
    PhaseStoreSpec("phase_d", "_phase_d_store", "_phase_d_enabled", PostgresPhaseDStore),
    PhaseStoreSpec("phase_e", "_phase_e_store", "_phase_e_enabled", PostgresPhaseEStore),
    PhaseStoreSpec("phase_f", "_phase_f_store", "_phase_f_enabled", PostgresPhaseFStore),
    PhaseStoreSpec("phase_g", "_phase_g_store", "_phase_g_enabled", PostgresPhaseGStore),
)


def iter_phase_store_specs() -> tuple[PhaseStoreSpec, ...]:
    return _PHASE_STORE_SPECS


def format_bridge_initialization_error(
    *,
    failed_phase: str | None,
    initialized_phases: tuple[str, ...],
) -> str:
    initialized_text = ",".join(initialized_phases) or "none"
    return (
        "Failed to initialize PostgreSQL coexistence bridge while SQLite remained the primary "
        f"runtime store. failed_phase={failed_phase or 'unknown'} initialized_before_failure={initialized_text}. "
        "Check POSTGRES_PHASE_A_URL connectivity/credentials and schema availability. "
        "If the schema is already provisioned, POSTGRES_PHASE_A_APPLY_SCHEMA=false can skip bootstrap writes."
    )


def initialize_postgres_phase_stores(
    manager: Any,
    *,
    bridge_url: str | None,
    auto_apply_schema: bool,
) -> BridgeInitResult:
    if not str(bridge_url or "").strip():
        return BridgeInitResult(initialized_phases=(), failed_phase=None)

    initialized_phases: list[str] = []
    failed_phase: str | None = None
    try:
        for spec in iter_phase_store_specs():
            failed_phase = spec.phase_key
            setattr(
                manager,
                spec.store_attr,
                spec.store_cls(
                    str(bridge_url).strip(),
                    auto_apply_schema=auto_apply_schema,
                ),
            )
            setattr(manager, spec.enabled_attr, True)
            initialized_phases.append(spec.phase_key)
    except Exception as exc:
        dispose_postgres_phase_stores(manager)
        raise BridgeInitializationError(
            failed_phase=failed_phase,
            initialized_phases=tuple(initialized_phases),
            cause=exc,
        ) from exc

    return BridgeInitResult(
        initialized_phases=tuple(initialized_phases),
        failed_phase=failed_phase,
    )


def dispose_postgres_phase_stores(manager: Any) -> None:
    for spec in iter_phase_store_specs():
        store = getattr(manager, spec.store_attr, None)
        if store is not None:
            try:
                store.dispose()
            except Exception as exc:
                logger.warning("清理 PostgreSQL store %s 失败: %s", spec.store_attr, exc)
        setattr(manager, spec.store_attr, None)
        setattr(manager, spec.enabled_attr, False)

