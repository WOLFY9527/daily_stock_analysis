# PostgreSQL Real-PG Verification Report

Date: 2026-04-23

## Scope

This slice verified three things:

1. Phase A-G PostgreSQL coexistence stores still initialize correctly against a real PostgreSQL instance.
2. Phase G now exposes observability for PostgreSQL `execution_sessions` / `execution_events`.
3. SQLite remains the runtime truth while PostgreSQL execution logs stay shadow-only diagnostics.

## Environment

- Real PostgreSQL DSN was available via `POSTGRES_PHASE_A_REAL_DSN`.
- Verified target used a local PostgreSQL endpoint with credentials redacted:
  - `postgresql+psycopg://wolfy:***@127.0.0.1:5432/wolfystock_phase_a`
- Verification used the repo test harness plus the new Phase G status/detail helpers.

## Commands Run

```bash
python3 -m py_compile src/postgres_control_plane_store.py src/storage.py src/services/execution_log_service.py tests/test_postgres_phase_g.py tests/test_postgres_phase_g_real_pg.py tests/test_postgres_runtime_real_pg.py
python3 -m pytest tests/test_execution_log_service.py -q
python3 -m pytest tests/test_system_config_service.py -q
python3 -m pytest tests/test_postgres_phase_g.py -q
python3 -m pytest tests/test_postgres_runtime_real_pg.py -q
python3 -m pytest tests/test_postgres_phase_g_real_pg.py -q
```

## Results

### Local/unit verification

- `py_compile`: passed
- `tests/test_execution_log_service.py`: 2 passed
- `tests/test_system_config_service.py`: 47 passed
- `tests/test_postgres_phase_g.py`: 9 passed

### Real PostgreSQL verification

- `tests/test_postgres_runtime_real_pg.py`: 2 passed
- `tests/test_postgres_phase_g_real_pg.py`: 3 passed

The real-PG runtime audit confirmed:

- Phase A-G all reported `enabled=true`
- Phase A-G all reported `schema.last_apply_status=applied` during the apply run
- Phase A-G all reported `bootstrap_recorded=true`
- Phase A-G all reported empty `missing_tables` and `missing_indexes`
- a follow-up `POSTGRES_PHASE_A_APPLY_SCHEMA=false` run reported `last_apply_status=skipped` while preserving schema visibility and bootstrap visibility

The Phase G real-PG round trip confirmed:

- `execution_sessions` rows were written into PostgreSQL shadow storage
- `execution_events` rows were written into PostgreSQL shadow storage
- `describe_phase_g_execution_log_status(include_connection_probe=True)` reported:
  - bridge enabled
  - shadow enabled
  - SQLite still primary
  - PostgreSQL execution logs not serving truth
- `get_phase_g_execution_session_detail(...)` returned:
  - ownership mapping for `analysis -> phase_b.analysis_records`
  - ownership mapping for `system_control -> phase_g.system_actions`
  - related Phase G coarse audit counts for admin sessions

## Notable Finding

Running shared-DSN real-PG verification in parallel caused a PostgreSQL deadlock on `postgres_schema_bootstrap` during this audit. The serial rerun passed cleanly.

Operational conclusion:

- real-PG verification should run serially when tests share one disposable database
- the maintenance handbook and troubleshooting playbook now call this out explicitly

## Outcome Summary

- Real-PG credentials were available and verification was executed, not skipped.
- No missing Phase A-G tables or indexes were observed in the passing serial real-PG audit.
- Phase G execution-log observability is now live in PostgreSQL shadow storage.
- SQLite runtime truth, Phase F comparison-only behavior, and Phase G `.env` live-source semantics were preserved.

## Remaining Recommendations

1. Add a dedicated disposable PostgreSQL database or schema-per-run strategy before enabling any parallel real-PG CI job.
2. Add a future bridge step from `query_id` to Phase B `linked_analysis_record_id` so Phase G execution sessions can point to the PG analysis record directly instead of only the domain mapping.
3. Consider a compact SQL view or CLI helper for `execution_sessions + execution_events + related admin logs` to reduce repeated manual joins during operator debugging.
