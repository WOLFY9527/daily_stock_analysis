# Storage Coordination Layer Split Plan

> **For agentic workers:** planning only. Keep existing `DatabaseManager`, doctor/support-bundle, and Phase G session/detail method names and JSON shapes stable until follow-up refactor slices prove compatibility with the current storage and doctor tests.

**Goal:** Decompose PostgreSQL coexistence coordination and observability/reporting out of `src/storage.py` without changing SQLite runtime truth, Phase F comparison-only semantics, or Phase G `.env` live-source authority.

**Architecture:** Keep SQLite CRUD/write paths, runtime serving decisions, Phase F authority/comparison logic, and execution-log write hooks where they already live. Extract only three low-risk seams: PG bridge coordination, topology/bootstrap aggregation, and Phase G observability serializers. The first implementation slices should be delegation-only so existing public entry points remain the same.

**Tech Stack:** Python, SQLAlchemy, SQLite primary runtime, PostgreSQL coexistence stores, database doctor/support bundle Markdown + JSON reports.

---

## Motivation

`src/storage.py` currently mixes four very different responsibilities:

1. SQLite primary runtime persistence and legacy serving truth.
2. PostgreSQL coexistence bridge startup/teardown.
3. Read-only topology/bootstrap reporting for operators and AI support.
4. Phase G execution-log observability summaries.

That mixture makes the file harder to reason about and makes future diagnostics changes risky because the same file also contains runtime-truth and shadow-write behavior that must not drift.

The next safe step is not a storage redesign. The next safe step is to isolate read-mostly coordination/reporting code behind stable helpers while leaving runtime truth exactly where it is today.

## Scope And Non-Goals

This plan is explicitly bounded to documentation-first, low-risk modularization planning.

In scope:

- PG store initialization/disposal and store-spec iteration.
- Database topology/bootstrap reporting.
- Phase G execution-log observability reporting for `execution_sessions` and `execution_events`.
- Compatibility with `src/database_doctor.py`, support-bundle output, and Real-PG bundle mode.

Out of scope:

- SQLite runtime truth changes.
- Phase F authority, comparison, or serving logic changes.
- Phase G execution-log write path changes.
- PostgreSQL cutover or new serving modes.
- schema changes, env-var changes, or new configuration switches.

## Current Code Map

| Concern | Current location | Current consumers | Split reason |
| --- | --- | --- | --- |
| PG bridge store-spec registry | `src/storage.py` `_POSTGRES_PHASE_STORE_SPECS` | bridge init, dispose, topology iteration | one iteration source exists already, but it is trapped inside the runtime file |
| PG bridge init/dispose | `DatabaseManager.__init__`, `_dispose_postgres_phase_stores()`, `reset_instance()` | startup, shutdown, tests | coordination-only and already delegates to Phase store constructors/dispose |
| Topology/bootstrap reporting | `DatabaseManager.describe_database_topology()` | startup logs, doctor, support bundle, tests | read-only aggregation, but currently mixed with runtime initialization |
| Store runtime report | `PostgresPhaseXStore.describe_runtime()` | topology report, doctor, manual probes | already modular by store; should stay that way |
| Phase G status summary | `DatabaseManager.describe_phase_g_execution_log_status()` and `PostgresPhaseGStore.describe_execution_log_status()` | doctor, support bundle, tests | reporting-only surface with stable truth reminders |
| Phase G session/detail serialization | `PostgresPhaseGStore.list_execution_sessions()` and `get_execution_session_detail()` | handbook playbook commands, tests, AI handoff | SQL query and dict serialization are currently coupled in one store file |

## Current Constraints To Preserve

- SQLite stays `primary_runtime`.
- `serving_semantics.phase_f` stays `legacy_serving_pg_comparison_only`.
- `serving_semantics.phase_g` stays `env_live_source_pg_snapshot_shadow`.
- Phase F comparison allowlists and authority summary remain owned by the existing config + doctor logic.
- Phase G `.env` live-source reminders stay explicit in every operator-facing report.
- Doctor/support bundle JSON shape stays backward compatible for the existing test surfaces.

## Proposed Decomposition Strategy

### 1. PG Bridge Coordination Layer

**Proposed module:** `src/storage_postgres_bridge.py`

**Responsibilities**

- own the single iteration source for Phase A-G store registration
- initialize registered PG stores from `POSTGRES_PHASE_A_URL` and `POSTGRES_PHASE_A_APPLY_SCHEMA`
- dispose initialized PG stores in a consistent order
- preserve the existing partial-init cleanup and bridge failure message contract
- expose lightweight iteration helpers that reporting code can reuse without depending on `DatabaseManager` internals

**Must not own**

- SQLite engine/session creation
- Phase F comparison or authority decisions
- Phase G execution-log write hooks
- doctor/support-bundle formatting

**Example API sketch**

```python
from dataclasses import dataclass
from typing import Any


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


def iter_phase_store_specs() -> tuple[PhaseStoreSpec, ...]: ...


def initialize_postgres_phase_stores(
    manager: Any,
    *,
    bridge_url: str | None,
    auto_apply_schema: bool,
) -> BridgeInitResult: ...


def dispose_postgres_phase_stores(manager: Any) -> None: ...
```

**Low-risk split steps**

1. Move only `_POSTGRES_PHASE_STORE_SPECS` plus init/dispose loop bodies into the new module.
2. Keep `DatabaseManager` attribute names unchanged: `_phase_a_store`, `_phase_a_enabled`, and so on.
3. Keep `DatabaseManager.__init__()` responsible for reading config and raising the same startup error text.
4. Keep `DatabaseManager.reset_instance()` calling a method with the same name, but make that method delegate internally.

**Risks / dependencies**

- Import-cycle risk if the helper module imports `DatabaseManager`.
  Mitigation: helper functions accept the manager instance and mutate only existing attributes.
- Startup regression risk if partial-init cleanup order changes.
  Mitigation: preserve the current spec order and cleanup behavior exactly.

### 2. Topology / Bootstrap Reporting

**Proposed module:** `src/storage_topology_report.py`

**Responsibilities**

- aggregate store-level `describe_runtime(...)` results for Phase A-G
- build the current top-level topology payload returned by `DatabaseManager.describe_database_topology(...)`
- include SQLite primary runtime metadata, PG bridge config, serving semantics, coexistence features, and bootstrap registry state
- build disabled/uninitialized store payloads using the same keys the doctor already expects
- optionally expose a small startup-log summary derived from the full report

**Must not own**

- store initialization side effects
- any direct schema apply / bootstrap writes
- Phase F authority calculations beyond copying current feature flags into the report

**Example API sketch**

```python
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TopologyInputs:
    sqlite_url: str
    sqlite_dialect: str
    bridge_url: str | None
    auto_apply_schema: bool
    config: Any
    manager: Any


def build_database_topology_report(
    inputs: TopologyInputs,
    *,
    include_connection_probe: bool = False,
) -> dict[str, Any]: ...


def build_disabled_store_runtime(
    spec: PhaseStoreSpec,
    *,
    bridge_url: str | None,
) -> dict[str, Any]: ...


def build_topology_log_summary(topology: dict[str, Any]) -> dict[str, Any]: ...


def build_degraded_topology_report(
    inputs: TopologyInputs,
    *,
    error: str,
) -> dict[str, Any]: ...
```

**Compatibility contract**

- `DatabaseManager.describe_database_topology()` keeps the same method name and return shape.
- `stores[phase_key].schema.*` keys stay stable for doctor/support-bundle parsing.
- `bootstrap_registry.recorded_schema_keys` stays present even when the bridge is disabled.
- `serving_semantics.phase_f` and `serving_semantics.phase_g` stay string-compatible with the current doctor text.

**Example output**

```json
{
  "primary_runtime": "sqlite",
  "postgres_bridge": {
    "configured": true,
    "enabled": true,
    "auto_apply_schema": true
  },
  "serving_semantics": {
    "sqlite": "primary",
    "phase_f": "legacy_serving_pg_comparison_only",
    "phase_g": "env_live_source_pg_snapshot_shadow"
  },
  "bootstrap_registry": {
    "recorded_schema_keys": ["phase_a", "phase_b", "phase_g"]
  },
  "stores": {
    "phase_g": {
      "enabled": true,
      "mode": "env_live_source_with_pg_snapshot",
      "schema": {
        "last_apply_status": "applied",
        "bootstrap_recorded": true
      }
    }
  }
}
```

**Fallback if report building fails**

The safe fallback is a degraded report, not a runtime-behavior change.

- keep `primary_runtime=sqlite`
- keep `postgres_bridge.configured` based on env/config only
- return placeholder `stores` entries for every registered phase so downstream consumers still have stable keys
- attach a `report_error` block with the original exception text
- never claim `last_apply_status=applied` or `bootstrap_recorded=true` when the reporting path failed

**Degraded example**

```json
{
  "primary_runtime": "sqlite",
  "postgres_bridge": {
    "configured": true,
    "enabled": false
  },
  "report_error": {
    "kind": "topology_report_failed",
    "error": "RuntimeError: failed to inspect phase_g runtime"
  },
  "stores": {
    "phase_g": {
      "enabled": false,
      "mode": "env_live_source_with_pg_snapshot",
      "schema": {
        "last_apply_status": "report_failed",
        "bootstrap_recorded": false
      }
    }
  }
}
```

**Low-risk split steps**

1. Extract the disabled-store payload builder first.
2. Extract the full topology builder as a pure helper that still reads current manager attributes.
3. Keep startup logging in `DatabaseManager`, but make it consume the helper output.
4. Only after the pure helper is stable, consider a safe/degraded wrapper for startup logs or doctor fallback.

### 3. Phase G Observability Reporting

**Proposed module:** `src/storage_phase_g_observability.py`

**Responsibilities**

- build the Phase G execution-log status summary returned by `DatabaseManager.describe_phase_g_execution_log_status(...)`
- centralize execution ownership mapping for `execution_sessions` and `execution_events`
- serialize Phase G execution-session summaries and details into the AI-friendly dict shape currently returned by the store
- keep truth reminders explicit: SQLite primary, PG shadow, `.env` still live source

**Must not own**

- execution-log writes
- `ExecutionLogService` behavior
- Phase F authority summary logic
- doctor classification logic

**Example API sketch**

```python
from typing import Any, Iterable


def build_phase_g_execution_log_status(
    *,
    topology: dict[str, Any],
    phase_g_enabled: bool,
    phase_g_store: Any | None,
    include_connection_probe: bool = False,
) -> dict[str, Any]: ...


def build_execution_ownership(*, subsystem: str | None, entity: str) -> dict[str, Any]: ...


def serialize_execution_session_summary(row: Any) -> dict[str, Any]: ...


def serialize_execution_session_detail(
    row: Any,
    *,
    event_rows: Iterable[Any],
    admin_log_ids: Iterable[int],
    system_action_ids: Iterable[int],
) -> dict[str, Any]: ...
```

**AI-friendly output contract**

- top-level fields stay flat and explicit: `bridge_enabled`, `shadow_enabled`, `mode`, `serving_flags`, `schema`, `connection`
- session/detail payloads keep the existing `ownership` block instead of forcing the caller to infer store truth
- `events` remain ordered and keep their own `ownership` block
- Phase G shadow rows never imply config-truth promotion; the payload must keep `.env`/SQLite reminders visible

**Example output**

```json
{
  "bridge_enabled": true,
  "shadow_enabled": true,
  "mode": "env_live_source_with_pg_snapshot",
  "shadow_store": "phase_g",
  "shadow_entities": ["execution_sessions", "execution_events"],
  "serving_flags": {
    "sqlite_primary": true,
    "pg_execution_logs_shadow": true,
    "pg_execution_logs_are_serving_truth": false
  },
  "schema": {
    "last_apply_status": "applied",
    "bootstrap_recorded": true
  }
}
```

```json
{
  "session_id": "analysis-session-123",
  "subsystem": "analysis",
  "overall_status": "succeeded",
  "ownership": {
    "execution_store": "phase_g",
    "runtime_primary_store": "sqlite",
    "domain_store": "phase_b",
    "domain_entity": "analysis_records"
  },
  "events": [
    {
      "phase": "fetch_market_data",
      "status": "succeeded",
      "ownership": {
        "execution_entity": "execution_events",
        "domain_store": "phase_b"
      }
    }
  ]
}
```

**Compatibility contract**

- `DatabaseManager.describe_phase_g_execution_log_status()` keeps the same signature and keys.
- `PostgresPhaseGStore.list_execution_sessions()` and `get_execution_session_detail()` keep their current outward payload shape.
- doctor/support bundle and Real-PG bundle continue reading `shadow_entities`, `schema`, `connection`, and `serving_flags` without translation.
- Phase F authority summary remains separate; the observability module consumes shared topology state but does not compute Phase F rules.

**Low-risk split steps**

1. Extract pure ownership-mapping helpers first.
2. Extract summary/detail serializer helpers next, but keep SQL queries inside `PostgresPhaseGStore`.
3. Extract the status builder after topology reporting has a stable helper home.
4. Keep `DatabaseManager` and `PostgresPhaseGStore` public method names unchanged; only delegate internally.

## Recommended Sequence Of Future Refactor Slices

1. Freeze current contracts with the existing tests:
   - `tests/test_storage.py`
   - `tests/test_database_doctor.py`
   - `tests/test_postgres_phase_g.py`
   - `tests/test_postgres_phase_g_real_pg.py` when a disposable DSN exists
2. Extract PG bridge init/dispose coordination only.
3. Extract topology/bootstrap reporting only.
4. Extract Phase G status builder only.
5. Extract Phase G session/detail serializers only.
6. Stop after delegation is stable. Do not mix this work with Phase F, schema, or write-path changes.

## Doctor / Support-Bundle Compatibility Requirements

These are the contracts that must remain stable during the split:

| Consumer | Contract to keep stable |
| --- | --- |
| `src/database_doctor.py` | `db.describe_database_topology(...)` stays the source of truth for topology and bootstrap state |
| doctor `Phase G Control Plane` | `db.describe_phase_g_execution_log_status(...)` keeps `shadow_entities`, `schema`, `connection`, and `serving_flags` |
| Real-PG bundle verification | the same Phase G status shape works in bundle mode without a second formatter |
| `tests/test_database_doctor.py` | the live-source reminder and observability keys remain unchanged |
| `tests/test_postgres_phase_g.py` and `tests/test_postgres_phase_g_real_pg.py` | ownership blocks, event serialization, and serving-truth flags remain unchanged |
| handbook/playbook commands | `list_phase_g_execution_sessions(...)` and `get_phase_g_execution_session_detail(...)` remain copy/paste friendly for AI handoff |

## Risks And Mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Output-shape drift | doctor/support bundle and tests parse these payloads today | delegate behind existing public methods first; avoid changing keys in the same slice |
| Import cycles | `storage.py` already imports many phase modules | keep helper modules free of `DatabaseManager` imports; pass in current manager/store objects |
| False health signals in fallback reports | degraded reports could accidentally hide schema/bootstrap issues | degraded builders must expose `report_error` and conservative placeholder status values |
| Scope creep into write paths | easy to touch execution-log shadow writes while moving Phase G reporting | keep SQL writes and sync hooks out of scope; move serializers only |
| Accidental Phase F semantics drift | topology and doctor report both mention Phase F mode | copy current Phase F semantics strings; do not recompute authority logic in the new modules |

## Rollback Guidance

Rollback should be code-path only. No data rollback, schema rollback, or config rollback should be required.

If any split slice regresses startup, topology, doctor output, or Phase G observability:

1. Inline the delegated helper body back into `src/storage.py` or `src/postgres_control_plane_store.py`.
2. Remove the new helper imports.
3. Keep the same public methods and env vars.
4. Re-run the current storage + doctor + Phase G tests before attempting a smaller follow-up slice.

The intended rollback property is simple: because runtime truth, schemas, and write paths do not move, reverting the delegation should fully restore previous behavior.

## Validation Gate For A Future Refactor

Minimum local gate:

```bash
python3 -m py_compile src/storage.py src/postgres_control_plane_store.py src/database_doctor.py
python3 -m pytest tests/test_storage.py tests/test_database_doctor.py tests/test_postgres_phase_g.py -q
```

When a disposable real PG DSN is available:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_runtime_real_pg.py tests/test_postgres_phase_g_real_pg.py -q
```

## Recommendation

P6 should stay a coordination/reporting decomposition only.

The first implementation slice should leave `DatabaseManager` and `PostgresPhaseGStore` outwardly familiar, delegate internally to focused helpers, and stop before any runtime-truth or serving-semantics decision moves out of its current owner.
