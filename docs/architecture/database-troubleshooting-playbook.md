# Database Troubleshooting Playbook

Use this playbook after reading the handbook.

## Fast Triage

Run this first:

```bash
python3 scripts/database_doctor.py --write
```

This is now the default troubleshooting entrypoint.

Use the Markdown report for human reading and AI copy/paste:

- `tmp/database-doctor-report.md`
- `tmp/database-doctor-report.json`

Then classify the failure from `probable_issue_classification`.

If the default doctor looks healthy locally but you still need disposable-DSN proof, run this next:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
```

Bundle outputs:

- `tmp/database-real-pg-bundle.md`
- `tmp/database-real-pg-bundle.json`

If you want a second smoke artifact after the default doctor, run the formal smoke wrapper second:

```bash
python3 scripts/database_doctor_smoke.py --write
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor_smoke.py --real-pg-bundle --write
```

Smoke outputs:

- `tmp/database-doctor-report-smoke.md`
- `tmp/database-doctor-report-smoke.json`
- `tmp/database-real-pg-bundle-smoke.md`
- `tmp/database-real-pg-bundle-smoke.json`

If you still need raw helper output after the doctor, use the deeper commands below.

For execution-log questions, run this immediately after topology:

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
print(json.dumps(db.describe_phase_g_execution_log_status(include_connection_probe=True), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

The doctor already includes a compact Phase G execution-log observability block.

## Maintainer Refactor Note

If troubleshooting turns into a code-change task in topology or Phase G observability, read [`storage-coordination-layer-split-plan.md`](./storage-coordination-layer-split-plan.md) first.

Current delegated homes:

- `src/storage_postgres_bridge.py`: PG bridge init/dispose and phase-store iteration
- `src/storage_topology_report.py`: topology/bootstrap report aggregation
- `src/storage_phase_g_observability.py`: Phase G status plus `execution_sessions` / `execution_events` serializers

After P8 formal integration, keep these current payloads backward compatible for the doctor/support-bundle flow and the Real-PG bundle:

- `DatabaseManager.describe_database_topology(...)`
- `DatabaseManager.describe_phase_g_execution_log_status(...)`
- `PostgresPhaseGStore.list_execution_sessions(...)`
- `PostgresPhaseGStore.get_execution_session_detail(...)`

P6/P7/P8 history and current smoke note:

- `scripts/database_doctor_smoke.py` is the preferred smoke wrapper path.
- default production startup/reporting now delegate to the final helper paths through `src/storage.py`.
- the historical split plan remains in `storage-coordination-layer-split-plan.md`; the wrapper itself is now just a formal smoke path.
- runtime truth still does not move out of `src/storage.py`.
- if the smoke wrapper path and default doctor disagree, treat the default doctor as source of truth and debug the wrapper/helper drift first.

## How To Classify The Problem

### Config-only

Usually true when:

- `POSTGRES_PHASE_A_URL` is missing or malformed
- `POSTGRES_PHASE_A_APPLY_SCHEMA` is set unexpectedly
- Phase F comparison flags are wrong or missing
- the doctor `Phase F Authority Summary` disagrees with the intended allowlist rollout
- Phase G behavior disagrees with `.env`
- the doctor says PG coexistence is disabled when you expected bridge/shadow behavior

Read:

- [`src/config.py`](../../src/config.py)
- [`src/storage.py`](../../src/storage.py)

### Schema-only

Usually true when:

- a store starts but required tables are missing
- `postgres_schema_bootstrap` has no record for a schema key
- `describe_runtime()` shows missing expected tables or indexes
- the doctor classifies the issue as `schema_bootstrap_issue`

Read:

- [`src/postgres_schema_bootstrap.py`](../../src/postgres_schema_bootstrap.py)
- [`docs/architecture/postgresql-baseline-v1.sql`](./postgresql-baseline-v1.sql)
- failing store module

### Bridge-only

Usually true when:

- SQLite still works but PG shadow/comparison rows are stale or absent
- Phase F comparison reports are missing even though legacy endpoints still serve
- Phase G shadow rows do not match `.env`, but runtime behavior still follows `.env`
- the doctor says PG coexistence is configured but bridge initialization failed

Read:

- [`src/storage.py`](../../src/storage.py)
- failing store module
- [`docs/architecture/phase-f/runbook.md`](./phase-f/runbook.md) for Phase F

### Execution-log shadow issue

Usually true when:

- SQLite execution logs exist but Phase G `execution_sessions` / `execution_events` are empty
- `describe_phase_g_execution_log_status()` says the bridge is enabled but `missing_tables` or `missing_indexes` is non-empty
- Phase G detail exists but the ownership mapping or related Phase G audit counts do not match the expected subsystem
- the doctor shows `Phase G Control Plane` as shadow-enabled but schema-incomplete

Read:

- [`src/postgres_control_plane_store.py`](../../src/postgres_control_plane_store.py)
- [`src/storage.py`](../../src/storage.py)
- [`src/services/execution_log_service.py`](../../src/services/execution_log_service.py)
- [`docs/architecture/database-maintenance-handbook.md`](./database-maintenance-handbook.md)

### Business-logic-level

Usually true when:

- both SQLite and PG schema look healthy
- the wrong rows are written, filtered, compared, or backfilled
- ownership rules, account scoping, or fallback rules are wrong
- the doctor says runtime topology and schema visibility look healthy enough

Read:

- caller service/repository
- the matching `tests/test_postgres_phase_*.py`
- [`src/storage.py`](../../src/storage.py)

## Common Failure Modes

| Symptom | Likely class | First check |
| --- | --- | --- |
| App starts with SQLite only, PG bridge disabled unexpectedly | config-only | topology report `postgres_bridge.configured` |
| PG store init crashes during startup | config-only or schema-only | startup error message plus `POSTGRES_PHASE_A_URL` and bootstrap status |
| `phase_f` looks healthy but endpoint still serves SQLite | not a bug by itself | expected current behavior |
| Phase F comparison report missing | bridge-only | feature flags and allowlist ids |
| Phase F feature flag is on but cash-ledger or corporate-actions still never compare | config-only | `Phase F Authority Summary` empty allowlist behavior |
| Phase G row exists but live behavior still follows `.env` | not a bug by itself | expected current behavior |
| SQLite execution log exists but Phase G execution session is absent | execution-log shadow issue | Phase G execution-log status report plus schema/bootstrap state |
| Disposable-DSN bundle proves init/bootstrap but runtime still disagrees | business-logic-level | compare bundle AI handoff with live doctor AI handoff |
| Store report says `last_apply_status=skipped` | config-only | `POSTGRES_PHASE_A_APPLY_SCHEMA` or direct `auto_apply_schema=False` |
| Store report says tables missing but bootstrap exists | schema drift | baseline SQL vs existing DB |
| Old import path appears broken | compatibility issue | `src/postgres_phase_*.py` compatibility re-export |

## How To Use The Doctor With AI

1. Run `python3 scripts/database_doctor.py --write`.
2. Copy the `AI Handoff` block from the Markdown report.
3. Paste that block together with:
   - the exact error text
   - the failing command or user action
   - whether the issue is local-only or real-PG-only
4. Tell AI whether it should start from config, schema/bootstrap, bridge/coexistence, or business/domain if you already know.

If you ran bundle mode, use `Real-PG Bundle AI Handoff` instead when the question is specifically about the disposable DSN verification run.

If you do not know, let the doctor classification drive the first read order.

## Exact Commands By Problem Family

### Topology and schema status

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
report = db.describe_database_topology(include_connection_probe=True)
print(json.dumps(report["stores"], ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

### Phase-specific local verification

```bash
python3 -m pytest tests/test_postgres_phase_a.py -q
python3 -m pytest tests/test_postgres_phase_b.py -q
python3 -m pytest tests/test_postgres_phase_c.py -q
python3 -m pytest tests/test_postgres_phase_d.py -q
python3 -m pytest tests/test_postgres_phase_e.py -q
python3 -m pytest tests/test_postgres_phase_f.py -q
python3 -m pytest tests/test_postgres_phase_g.py -q
```

### Phase G execution-log inspection

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

db = DatabaseManager.get_instance()
print(json.dumps(db.list_phase_g_execution_sessions(limit=10), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

```bash
python3 - <<'PY'
from src.storage import DatabaseManager
import json

SESSION_ID = "<execution_session_id>"
db = DatabaseManager.get_instance()
print(json.dumps(db.get_phase_g_execution_session_detail(SESSION_ID), ensure_ascii=False, indent=2))
DatabaseManager.reset_instance()
PY
```

Direct SQL against PostgreSQL when credentials are available:

```bash
psql "$POSTGRES_PHASE_A_URL" -c "select session_id, subsystem, session_kind, overall_status, started_at from execution_sessions order by started_at desc limit 20;"
psql "$POSTGRES_PHASE_A_URL" -c "select execution_session_id, phase, step, status, occurred_at from execution_events order by occurred_at desc limit 50;"
psql "$POSTGRES_PHASE_A_URL" -c "select schema_key, schema_version, applied_via, applied_at from postgres_schema_bootstrap order by applied_at desc;"
```

### Storage entrypoint verification

```bash
python3 -m pytest tests/test_storage.py -q
python3 -m py_compile src/postgres_store_utils.py src/storage.py
```

### Real PostgreSQL verification

Use a disposable PostgreSQL database and run these serially:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_runtime_real_pg.py -q
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_phase_g_real_pg.py -q
```

Do not parallelize these commands against the same database. Shared-DSN parallel runs can deadlock on `postgres_schema_bootstrap`.
Prefer the bundle as the first disposable-DSN artifact because it preserves the same doctor/support-bundle shape operators already know how to hand to AI.

Rollback from the smoke wrapper path is immediate: stop using `scripts/database_doctor_smoke.py` and fall back to the default doctor commands above. If you need the old P9 reference layer, restore `src/experimental/` and `scripts/database_doctor_experimental.py` from git history.

## Local-Only Vs Real-PG Follow-Up

Safe to inspect locally first:

- SQLite path / file existence / reachability issues
- disabled or malformed PG bridge config
- obvious missing bootstrap rows or missing tables in the doctor/store report
- Phase F allowlist/config mismatches

Require real-PG follow-up:

- production DSN bridge-init failure that does not reproduce with SQLite-backed coexistence
- real PG schema drift / privilege problems
- missing `execution_sessions` / `execution_events` only in the real PG environment
- deployment-only Phase F / Phase G shadow-write gaps

## Decision Flow

1. Run `describe_database_topology(include_connection_probe=True)`.
   If `postgres_bridge.configured=false` or the Phase G connection probe is not OK, treat it as config-first.

2. Run `describe_phase_g_execution_log_status(include_connection_probe=True)`.
   If `schema.bootstrap_recorded=false`, or `missing_tables` / `missing_indexes` is non-empty, treat it as schema/bootstrap-first.

3. Run `list_phase_g_execution_sessions(limit=10)`.
   If SQLite logs exist but Phase G logs are empty while the schema is healthy, treat it as a shadow-write or bridge logic issue.

4. Run `get_phase_g_execution_session_detail(<session_id>)`.
   If the session exists but `ownership.domain_store`, `ownership.domain_entity`, or related admin/action counts are wrong for the subsystem, treat it as business-logic-level observability drift.

## Phase F Special Rule

Do not treat any current Phase F result as PostgreSQL serving approval.

Current meaning only:

- SQLite still serves
- PostgreSQL is comparison-only
- missing PG serving is not itself a regression
- `trades_list` may compare broadly when its allowlist is empty
- `cash_ledger` and `corporate_actions` require explicit allowlisted account ids before comparison attempts start

Read:

- [`docs/architecture/phase-f/status.md`](./phase-f/status.md)
- [`docs/architecture/phase-f/runbook.md`](./phase-f/runbook.md)
- [`docs/architecture/phase-f/decisions.md`](./phase-f/decisions.md)

## Phase G Special Rule

Do not treat PG shadow mismatch as proof that runtime config changed.

Current meaning only:

- `.env` remains live source
- PG rows are snapshot/shadow records
- PG `execution_sessions` / `execution_events` are observability shadow rows; they do not change runtime config truth

## When Real PostgreSQL Is Unavailable

Say this explicitly in the troubleshooting record:

- real PostgreSQL credentials were unavailable
- the disposable Real-PG bundle was not run
- SQLite-backed coexistence tests were run instead
- schema/bootstrap/topology logic was still verified locally
