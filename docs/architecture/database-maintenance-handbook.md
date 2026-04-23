# Database Maintenance Handbook

This is the primary maintenance entry point for the current database architecture.

Use this file first when future AI or non-programmer troubleshooting needs to answer:

- Is this a SQLite primary-path issue or a PostgreSQL coexistence issue?
- Which store owns the failing area?
- Which files and tests should be read first?
- Is the problem config-only, schema-only, bridge-only, or business-logic-level?

## Current Reality

- SQLite is still the runtime primary store and serving source for the legacy path.
- PostgreSQL is still a coexistence bridge, shadow store, or comparison store depending on domain.
- Phase F remains legacy-serving plus PostgreSQL comparison-only.
- Phase G remains `.env` live-source-backed, with PostgreSQL acting as snapshot/shadow for control-plane rows.
- Compatibility env vars stay unchanged:
  - `POSTGRES_PHASE_A_URL`
  - `POSTGRES_PHASE_A_APPLY_SCHEMA`

## Default Doctor Command

Run this first:

```bash
python3 scripts/database_doctor.py --write
```

This does three things in one pass:

- prints a compact Markdown doctor report to stdout
- writes `tmp/database-doctor-report.md`
- writes `tmp/database-doctor-report.json`

Use this as the default non-programmer/operator entrypoint before reading code.

The doctor report is intentionally AI-friendly:

- it states whether SQLite primary looks healthy
- it states whether PostgreSQL coexistence is configured and initialized
- it summarizes Phase A-G store status, schema visibility, and bootstrap visibility
- it explains current Phase F and Phase G serving semantics
- it includes a dedicated `Phase F Authority Summary` block for feature flags, account allowlists, and owner-scope reminders
- it emits a short `probable_issue_classification`
- it includes a ready-to-paste AI handoff block with the first files to read

## Disposable Real-PG Bundle

When local topology looks healthy enough but you still need a disposable-DSN proof run, use:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
```

This mode is intentionally isolated:

- it creates a temporary SQLite file instead of touching the active runtime SQLite path
- it points `POSTGRES_PHASE_A_URL` at the disposable DSN only for the bundle process
- it keeps SQLite as truth and keeps Phase F in comparison-only mode
- it writes `tmp/database-real-pg-bundle.md`
- it writes `tmp/database-real-pg-bundle.json`

Use this when you need one AI-friendly artifact that proves:

- Phase A-G store initialization against the disposable DSN
- schema/bootstrap visibility
- Phase G `execution_sessions` / `execution_events` shadow viability
- current Phase F comparison flags and allowlist posture

## Read First

Start in this order:

1. [`src/storage.py`](../../src/storage.py)
2. [`src/storage_postgres_bridge.py`](../../src/storage_postgres_bridge.py)
3. [`src/storage_topology_report.py`](../../src/storage_topology_report.py)
4. [`src/storage_phase_g_observability.py`](../../src/storage_phase_g_observability.py)
5. [`src/config.py`](../../src/config.py)
6. [`src/postgres_schema_bootstrap.py`](../../src/postgres_schema_bootstrap.py)
7. [`src/postgres_store_utils.py`](../../src/postgres_store_utils.py)
8. Domain store for the failing area:
   [`src/postgres_identity_store.py`](../../src/postgres_identity_store.py),
   [`src/postgres_analysis_chat_store.py`](../../src/postgres_analysis_chat_store.py),
   [`src/postgres_market_metadata_store.py`](../../src/postgres_market_metadata_store.py),
   [`src/postgres_scanner_watchlist_store.py`](../../src/postgres_scanner_watchlist_store.py),
   [`src/postgres_backtest_store.py`](../../src/postgres_backtest_store.py),
   [`src/postgres_portfolio_coexistence_store.py`](../../src/postgres_portfolio_coexistence_store.py),
   [`src/postgres_control_plane_store.py`](../../src/postgres_control_plane_store.py)
9. Compatibility re-export only if an old import path appears:
   [`src/postgres_phase_a.py`](../../src/postgres_phase_a.py),
   [`src/postgres_phase_b.py`](../../src/postgres_phase_b.py),
   [`src/postgres_phase_c.py`](../../src/postgres_phase_c.py),
   [`src/postgres_phase_d.py`](../../src/postgres_phase_d.py),
   [`src/postgres_phase_e.py`](../../src/postgres_phase_e.py),
   [`src/postgres_phase_f.py`](../../src/postgres_phase_f.py),
   [`src/postgres_phase_g.py`](../../src/postgres_phase_g.py)

## Maintainability Audit Snapshot

### 1. Safe-to-extract shared infrastructure

- Store engine creation now lives in [`src/postgres_store_utils.py`](../../src/postgres_store_utils.py).
- Session factory and session-scope handling now live in [`src/postgres_store_utils.py`](../../src/postgres_store_utils.py).
- Baseline SQL slice loading now lives in [`src/postgres_store_utils.py`](../../src/postgres_store_utils.py).
- Schema apply/bootstrap orchestration now routes through [`src/postgres_schema_bootstrap.py`](../../src/postgres_schema_bootstrap.py) for all current Phase A-G stores.
- Runtime schema diagnostics now use one shared reporting shape across Phase A-G stores.

### 2. Safe-to-consolidate docs and diagnostics

- Cross-domain troubleshooting should start from this handbook, not from individual phase docs.
- Exact topology and coexistence feature inspection should start from `DatabaseManager.describe_database_topology(...)`.
- Store-level schema/bootstrap inspection should start from `PostgresPhaseXStore.describe_runtime(...)`.

### 2.5 P6 baseline and P8 formal integration

P6 remains the baseline design reference. P8 formally wires the split helpers into the default runtime/doctor path without changing runtime truth.

- Read [`storage-coordination-layer-split-plan.md`](./storage-coordination-layer-split-plan.md) before changing topology or Phase G observability code.
- Default delegated homes:
  - `src/storage_postgres_bridge.py`: PG bridge init/dispose plus store-spec iteration
  - `src/storage_topology_report.py`: topology/bootstrap aggregation
  - `src/storage_phase_g_observability.py`: Phase G status plus `execution_sessions` / `execution_events` observability
- `src/storage.py` remains the entrypoint and runtime owner. The split helpers only own coordination/reporting seams.
- Keep these public surfaces shape-stable because doctor/support bundle and Real-PG bundle consume them directly:
- `DatabaseManager.describe_database_topology(...)`
- `DatabaseManager.describe_phase_g_execution_log_status(...)`
- `PostgresPhaseGStore.list_execution_sessions(...)`
- `PostgresPhaseGStore.get_execution_session_detail(...)`

### 2.6 P6/P7/P8 history and the P10 smoke path

P6 remains the baseline design reference. P7 introduced a wrapper smoke path, P8 wired the helpers into the default runtime/doctor path, P9 finalized the helper naming, and P10 removes the old reference layer while keeping rollback instructions in git history.

- `src/storage_postgres_bridge.py`
- `src/storage_topology_report.py`
- `src/storage_phase_g_observability.py`

Current reality:

- `src/storage.py` still owns the production initialization path and serving truth.
- default doctor/runtime now delegate bridge coordination, topology/bootstrap reporting, and Phase G observability to these helper modules
- `scripts/database_doctor_smoke.py` now calls the same formal doctor/report builders directly instead of going through any experimental/split alias layer
- SQLite remains primary runtime truth.
- Phase F remains PostgreSQL comparison-only.
- Phase G remains `.env` live-source-backed.

Use the formal smoke wrapper when you want a second copy/paste-friendly run without changing the default doctor/support-bundle JSON/Markdown shape:

```bash
python3 scripts/database_doctor_smoke.py --write
```

Outputs:

- `tmp/database-doctor-report-smoke.md`
- `tmp/database-doctor-report-smoke.json`

Optional disposable-DSN bundle:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor_smoke.py --real-pg-bundle --write
```

Outputs:

- `tmp/database-real-pg-bundle-smoke.md`
- `tmp/database-real-pg-bundle-smoke.json`

Verification checklist for this path:

- default doctor still works first: `python3 scripts/database_doctor.py --write`
- smoke wrapper produces the same Markdown/JSON report shape as the default doctor for the tested seams
- `Phase F Authority Summary` stays unchanged
- `Phase G Control Plane` still reports SQLite as serving truth and PG as snapshot/shadow only
- Real-PG smoke bundle is optional and should use a disposable DSN only

Rollback:

- keep using `src/storage.py` plus the default `scripts/database_doctor.py` path
- if smoke troubleshooting adds confusion, fall back to `scripts/database_doctor.py` and `scripts/database_doctor.py --real-pg-bundle --write`
- if rollback to the old P9 reference layer is ever needed, restore `src/experimental/` and `scripts/database_doctor_experimental.py` from git history instead of recreating them manually

Historical references to keep:

- keep [`storage-coordination-layer-split-plan.md`](./storage-coordination-layer-split-plan.md) as the P6/P7/P8 decomposition history
- keep the final helper paths stable at `src/storage_postgres_bridge.py`, `src/storage_topology_report.py`, and `src/storage_phase_g_observability.py`
- keep the public `DatabaseManager` method names unchanged during any future file move

### 3. Must-keep domain boundaries

- Identity and preferences stay in Phase A.
- Analysis/chat stays in Phase B.
- Market metadata stays in Phase C.
- Scanner/watchlist stays in Phase D.
- Backtest stays in Phase E.
- Portfolio coexistence stays in Phase F.
- Control-plane snapshot/shadow stays in Phase G.
- Do not collapse all stores into one file. Shared helpers are allowed; domain business methods stay separate.

### 4. High-risk areas that were intentionally not refactored in this slice

- SQLite runtime truth and serving semantics inside [`src/storage.py`](../../src/storage.py)
- Phase F authority/readiness/comparison logic in [`src/storage.py`](../../src/storage.py)
- Phase G `.env` live-source semantics in [`src/config.py`](../../src/config.py) and [`src/services/system_config_service.py`](../../src/services/system_config_service.py)
- Compatibility re-export modules under `src/postgres_phase_*.py`
- Schema design changes beyond maintainability or diagnostics

### 5. Missing troubleshooting affordances that are now present

- Shared topology report across SQLite primary path and PostgreSQL coexistence path
- Per-store runtime report with:
  - schema key
  - expected tables/indexes
  - tables currently present
  - bootstrap registry presence
  - last apply status: `applied`, `skipped`, `failed`, or `not_initialized`
- Clear Phase F and Phase G runtime mode indicators in the topology report
- More actionable bridge-init error text when PostgreSQL store startup fails

## Diagnostic Entry Points

### Database doctor (default)

Use the doctor output first, then fall back to the direct helper commands below only when deeper inspection is needed.

Interpret the high-level sections like this:

- `Runtime Summary`: tells you whether SQLite primary and PostgreSQL coexistence are both reachable enough for basic troubleshooting.
- `Store Status`: tells you which Phase A-G store is only configured, fully initialized, or unavailable, plus whether schema/bootstrap objects are missing.
- `Phase F Mode`: reminds you that SQLite still serves and PostgreSQL stays comparison-only.
- `Phase G Control Plane`: reminds you that `.env` is still live truth and PG rows remain snapshot/shadow only.
- `AI Handoff`: is the shortest safe thing to paste into AI together with the exact error message or screenshot.

### Global topology report

Run:

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
print(json.dumps(db.describe_database_topology(include_connection_probe=True), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

Use this first to confirm:

- SQLite is still primary
- PostgreSQL bridge is configured or disabled
- which Phase A-G stores are enabled
- which schema keys were recorded in `postgres_schema_bootstrap`
- which Phase F comparison flags are enabled

Prefer the doctor command when handing off to AI or non-programmer support.
Prefer this raw topology command when you need the full underlying JSON surface for engineering-only debugging.
If you need to change the reporting implementation rather than inspect it, start from [`storage-coordination-layer-split-plan.md`](./storage-coordination-layer-split-plan.md) so the split stays coordination-only.

### Phase G execution-log shadow status

Run:

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
print(json.dumps(db.describe_phase_g_execution_log_status(include_connection_probe=True), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

Use this when AI troubleshooting needs to answer:

- whether PostgreSQL execution-log shadowing is enabled
- whether SQLite is still the serving truth
- whether `execution_sessions` / `execution_events` were part of the last applied Phase G slice
- whether Phase G schema or connectivity is the reason observability data is missing

The database doctor already embeds this section in a smaller operator summary. Use the raw helper only if you need the full JSON payload.
If this payload needs refactoring, keep the current keys stable first and move serializer logic before moving any execution-log write path.

### Phase F authority summary

The doctor now emits a compact `Phase F Authority Summary` section by default.

Read it as:

- `allowed_roles=admin,user` does not mean a new admin override exists; it means no comparison-specific role gate was added beyond the existing authenticated owner-scoped portfolio path
- `effective_account_scope=all_requested_accounts` only applies to `trades_list` when its allowlist is empty
- `effective_account_scope=no_accounts` on `cash_ledger` or `corporate_actions` means the feature flag may be on, but comparison still skips until account ids are explicitly allowlisted
- `non_empty restriction sets` are the only compact place where current bounded rollout ids are collected for AI/operator handoff

Prefer the doctor summary first. Only read `src/services/portfolio_service.py` and Phase F runbooks directly when the summary and runtime behavior disagree.

### Real-PG bundle mode

Run:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
```

Use this mode when you need one disposable-DSN artifact instead of a sequence of ad-hoc commands.

The bundle adds:

- `Real-PG Bundle Verification`: bundle-specific safety contract plus store/bootstrap/Phase G checks
- `Real-PG Bundle AI Handoff`: a copy/paste block tailored to disposable-DSN verification failures
- the same base doctor sections that operators already know how to read

If the disposable DSN is PostgreSQL, missing indexes remain blocking evidence.
If you intentionally use a SQLite-backed disposable DSN for a local-only smoke check, bootstrap/table visibility still counts as the hard gate and SQLite-only index gaps stay visible as tolerated warnings.

### Phase G execution-log session detail

Run:

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
sessions = db.list_phase_g_execution_sessions(limit=5)
print(json.dumps(sessions, ensure_ascii=False, indent=2))
if sessions:
    print(json.dumps(db.get_phase_g_execution_session_detail(sessions[0]["session_id"]), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

This returns:

- Phase G persistence ownership: `phase_g.execution_sessions` / `phase_g.execution_events`
- legacy runtime owner: `sqlite.execution_log_sessions` / `sqlite.execution_log_events`
- mapped domain owner by subsystem: analysis -> Phase B, scanner -> Phase D, system control -> Phase G, backtest -> Phase E, portfolio -> Phase F
- related Phase G coarse audit counts for `admin_logs` / `system_actions` when the session came from `system_control`

### Single-store runtime report

Run:

```bash
python3 - <<'PY'
from src.postgres_phase_a import PostgresPhaseAStore
import json

store = PostgresPhaseAStore("sqlite:///./tmp-phase-a.sqlite", auto_apply_schema=False)
print(json.dumps(store.describe_runtime(), ensure_ascii=False, indent=2))
store.dispose()
PY
```

Swap Phase A for the failing store class when isolating one store.

## Bootstrap Governance

- The authoritative baseline SQL doc is [`docs/architecture/postgresql-baseline-v1.sql`](./postgresql-baseline-v1.sql).
- Phase stores load only their own slice from that file.
- Bootstrap records are stored in `postgres_schema_bootstrap`.
- The registry answers:
  - which schema key ran
  - which source file was used
  - how many statements were in scope
  - whether the store applied SQL directly or SQLAlchemy metadata

## Execution-Log Ownership Map

Use `subsystem` first, then check the ownership block returned by `list_phase_g_execution_sessions(...)` or `get_phase_g_execution_session_detail(...)`.

| `subsystem` | Phase G persistence owner | Legacy runtime owner | Domain/store mapping | Notes |
| --- | --- | --- | --- | --- |
| `analysis` | `execution_sessions` / `execution_events` | `execution_log_sessions` / `execution_log_events` | Phase B `analysis_records` | diagnostic session for analysis pipeline; SQLite remains serving truth |
| `scanner` | `execution_sessions` / `execution_events` | `execution_log_sessions` / `execution_log_events` | Phase D `scanner_runs` | scanner/watchlist execution diagnostics |
| `system_control` | `execution_sessions` / `execution_events` | `execution_log_sessions` / `execution_log_events` | Phase G `system_actions` | use `related_phase_g_admin_log_count` and `related_phase_g_system_action_count` to correlate |
| `backtest` | `execution_sessions` / `execution_events` | `execution_log_sessions` / `execution_log_events` | Phase E `backtest_runs` | reserved for backtest execution diagnostics |
| `portfolio` | `execution_sessions` / `execution_events` | `execution_log_sessions` / `execution_log_events` | Phase F `portfolio_accounts` | reserved for portfolio execution diagnostics |

## Exact Verification Commands

Use these when the touched area is unclear or spans multiple domains:

```bash
python3 -m py_compile src/postgres_store_utils.py src/postgres_identity_store.py src/postgres_analysis_chat_store.py src/postgres_market_metadata_store.py src/postgres_scanner_watchlist_store.py src/postgres_backtest_store.py src/postgres_portfolio_coexistence_store.py src/postgres_control_plane_store.py src/storage.py
python3 -m pytest tests/test_postgres_phase_a.py tests/test_postgres_phase_b.py tests/test_postgres_phase_c.py tests/test_postgres_phase_d.py tests/test_postgres_phase_e.py tests/test_postgres_phase_f.py tests/test_postgres_phase_g.py tests/test_storage.py -q
```

If real PostgreSQL credentials exist, also use the matching `tests/test_postgres_phase_*_real_pg.py` file. If not, say so explicitly and stop at SQLite-backed verification.

## Local-First Vs Real-PG Follow-Up

Safe to inspect locally first:

- SQLite path missing or unreadable
- `POSTGRES_PHASE_A_URL` missing or clearly malformed
- Phase F feature flags / allowlists look wrong in the doctor report
- store reports already show missing tables/indexes/bootstrap rows in SQLite-backed or local coexistence verification

Escalate to real PostgreSQL follow-up when:

- the doctor says PostgreSQL coexistence is configured and initialized, but the production issue only reproduces against a real PG DSN
- Phase G execution-log shadowing looks healthy locally but `execution_sessions` / `execution_events` are absent in real PG
- a schema drift or privilege issue appears only in the real PG environment
- bridge initialization fails only with the deployment DSN

Recommended serial real-PG verification for this slice:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_runtime_real_pg.py -q
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_phase_g_real_pg.py -q
```

Run these serially, not in parallel, when they target the same database. Parallel real-PG execution can deadlock on `postgres_schema_bootstrap` and can leave follow-up reports inspecting a partially applied Phase G slice.

## Related Docs

- [`database-component-map.md`](./database-component-map.md)
- [`database-real-pg-bundle-playbook.md`](./database-real-pg-bundle-playbook.md)
- [`storage-coordination-layer-split-plan.md`](./storage-coordination-layer-split-plan.md)
- [`database-troubleshooting-playbook.md`](./database-troubleshooting-playbook.md)
- [`postgres-real-pg-verification-2026-04-23.md`](./postgres-real-pg-verification-2026-04-23.md)
- [`phase-f/status.md`](./phase-f/status.md)
- [`phase-f/runbook.md`](./phase-f/runbook.md)
- [`phase-f/decisions.md`](./phase-f/decisions.md)
