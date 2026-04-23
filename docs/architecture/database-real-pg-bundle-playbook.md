# Database Real-PG Bundle Playbook

Use this playbook when the default doctor is not enough and you need one disposable-DSN verification artifact that stays compatible with the doctor/support-bundle workflow.

## Goal

The Real-PG bundle answers four questions in one run:

- Do Phase A-G stores initialize against the disposable DSN?
- Did schema/bootstrap application succeed for the current implemented slices?
- Can Phase G shadow `execution_sessions` / `execution_events` be observed through a real bridge path?
- What is the current Phase F comparison authority posture?

It does not:

- change SQLite runtime truth
- enable PostgreSQL serving for Phase F
- change `.env` live-source semantics for Phase G
- perform PG cutover

## Safe Run Command

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor.py --real-pg-bundle --write
```

Optional explicit DSN form:

```bash
python3 scripts/database_doctor.py --real-pg-bundle --real-pg-dsn '<disposable_pg_dsn>' --write
```

Outputs:

- `tmp/database-real-pg-bundle.md`
- `tmp/database-real-pg-bundle.json`

Formal smoke wrapper form:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 scripts/database_doctor_smoke.py --real-pg-bundle --write
```

Smoke outputs:

- `tmp/database-real-pg-bundle-smoke.md`
- `tmp/database-real-pg-bundle-smoke.json`

## Safety Contract

Bundle mode is intentionally isolated:

- it creates a temporary SQLite file for the probe run
- it temporarily points `POSTGRES_PHASE_A_URL` to the disposable DSN only inside the bundle process
- it forces schema auto-apply for the disposable probe
- it leaves the active runtime SQLite path untouched
- it keeps Phase F as legacy-serving plus comparison-only PG

The smoke bundle keeps the same safety contract and reuses the same delegated final helper modules that now back the default doctor/runtime coordination path.

## How To Read The Bundle

### 1. Base doctor sections

Read `Runtime Summary`, `Store Status`, `Phase F Mode`, `Phase F Authority Summary`, and `Phase G Control Plane` exactly the same way you read the default doctor.

### 2. Real-PG Bundle Verification

This adds bundle-specific checks:

- `Store initialization`
  - `passed=true` means Phase A-G stores reached initialized state against the disposable DSN
- `Schema/bootstrap`
  - `passed=true` means bootstrap records and required tables were visible for the implemented slices
  - SQLite-backed disposable smoke runs may still show tolerated index gaps; those stay visible but do not fail the bundle
- `Phase G shadow verification`
  - this writes one small probe session through the existing execution-log path
  - success means both SQLite and PG-side execution-log detail became visible for that probe
- `Phase F comparison flags`
  - this confirms bundle mode did not alter SQLite truth or Phase F comparison-only posture

### 3. Real-PG Bundle AI Handoff

Use this block instead of the default AI handoff when the failure is specifically about the disposable DSN probe.

It includes:

- disposable DSN summary
- isolated SQLite path
- runtime safety reminders
- bundle verification status
- the first code files to inspect

## Phase F Authority Summary Interpretation

The bundle always includes the same `Phase F Authority Summary` shape as the default doctor.

Read it with these rules:

- `allowed_roles=admin,user` means there is no special comparison-only role gate; portfolio requests remain owner-scoped
- `trades_list` with an empty allowlist can still compare broadly
- `cash_ledger` and `corporate_actions` with empty allowlists stay effectively blocked from comparison attempts
- non-empty restriction sets are the compact list of currently bounded rollout account ids

## AI Workflow

Recommended order:

1. Run the default doctor first.
2. If the issue still looks DSN-specific, run the Real-PG bundle.
3. Hand AI both:
   - the exact error text
   - the `Real-PG Bundle AI Handoff` block
4. Only then fall back to ad-hoc SQL or individual `tests/test_postgres_phase_*_real_pg.py` runs.

## Limitations

- The bundle assumes the DSN is disposable.
- The bundle is observability-first, not a promotion/cutover gate.
- It verifies implemented Phase A-G slices only; it does not prove future migration readiness.
- If the disposable DSN is unreachable, the bundle still emits a redacted failure report instead of hard-crashing.
- The smoke form is now a formal wrapper around the same default doctor/report builders, which already route through `src/storage_postgres_bridge.py`, `src/storage_topology_report.py`, and `src/storage_phase_g_observability.py`.

## Rollback

If the smoke bundle diverges from the default doctor output or creates debugging confusion:

- stop using `scripts/database_doctor_smoke.py`
- fall back to `scripts/database_doctor.py --real-pg-bundle --write`
- if necessary, restore the old P9 reference layer from git history for one-off comparisons
- keep `storage-coordination-layer-split-plan.md` as the baseline reference for the P6/P7/P8 split history and future file moves

## Follow-Up Commands

Use these only after the bundle:

```bash
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_runtime_real_pg.py -q
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_phase_g_real_pg.py -q
POSTGRES_PHASE_A_REAL_DSN='<disposable_pg_dsn>' python3 -m pytest tests/test_postgres_phase_f_real_pg.py -q
```

Run them serially when they target the same database.
