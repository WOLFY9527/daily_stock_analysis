# Rule Backtest Support Bundle Final Backend Handoff Snapshot

## 1. Goal

Provide one internal, closure-level backend handoff snapshot for the completed rule-backtest support bundle surface.

This snapshot is intentionally narrow. It confirms the final backend contract for:

- service helpers
- export-index discovery
- compact artifact manifests
- heavy execution-trace exports
- HTTP E2E behavior

It does not introduce:

- frontend changes
- new artifact kinds
- packaging/download bundling
- multi-run exports
- runtime or engine redesign

## 2. Stable Support Bundle Surface

The current backend support bundle surface for one rule-backtest run is:

- `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest`
- `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-reproducibility-manifest`
- `GET /api/v1/backtest/rule/runs/{run_id}/export-index`
- `GET /api/v1/backtest/rule/runs/{run_id}/execution-trace.json`
- `GET /api/v1/backtest/rule/runs/{run_id}/execution-trace.csv`

The stable export-index artifact set is exactly:

- `support_bundle_manifest_json`
- `support_bundle_reproducibility_manifest_json`
- `execution_trace_json`
- `execution_trace_csv`

No additional artifact kinds are part of this phase-complete handoff boundary.

## 3. Contract Rules

### 3.1 Shared compact summaries

Both compact manifests reuse the same resolved run-level summaries from the stored-first detail read path:

- `run_timing`
- `run_diagnostics`
- `artifact_availability`
- `readback_integrity`

These blocks must stay consistent with `RuleBacktestService.get_run(run_id)` and must not fork into a second provenance system.

### 3.2 Support bundle manifest

`support-bundle-manifest` is the compact operator/debug handoff artifact.

It contains:

- `manifest_version = "v1"`
- `manifest_kind = "rule_backtest_support_bundle"`
- compact `run` metadata
- shared compact summaries
- normalized `result_authority` subset:
  - `contract_version`
  - `read_mode`
  - `domains`
- lightweight `artifact_counts`

It intentionally does not inline heavy payloads such as:

- `trades`
- `equity_curve`
- `audit_rows`
- `execution_trace`

### 3.3 Reproducibility manifest

`support-bundle-reproducibility-manifest` is the compact reproducibility/migration handoff artifact.

It contains:

- `manifest_version = "v1"`
- `manifest_kind = "rule_backtest_reproducibility_manifest"`
- compact `run` metadata
- shared compact summaries
- `execution_assumptions_fingerprint`
- reduced `result_authority` summary with `source / completeness / state`

It intentionally stays compact and does not inline heavy replay payloads.

### 3.4 Execution-trace heavy exports

The heavy exports remain:

- `execution_trace_json`
- `execution_trace_csv`

They are gated by the resolved detail readback `execution_trace.rows`.

Meaning:

- trace rows present:
  - export-index reports `available=true`
  - both execution-trace endpoints are readable
- trace rows missing:
  - export-index reports `available=false`
  - `availability_reason = execution_trace_rows_missing`
  - both execution-trace endpoints fail closed instead of fabricating empty exports

## 4. Scenario Matrix

The final support bundle handoff snapshot is expected to behave as follows:

| Scenario | Compact manifests | Export index | Trace JSON/CSV |
| --- | --- | --- | --- |
| stored-first complete run | shared summaries align with detail readback | both manifests available, trace exports available | readable |
| live-storage repair / summary drift | shared summaries reflect repaired live state, not stale summary booleans | both manifests available, trace exports still available when trace rows exist | readable |
| missing trace rows | compact manifests stay readable and truthfully report `has_execution_trace=false` / unavailable authority | both manifests available, trace exports marked unavailable | closed with export-unavailable semantics |

The key drift scenario intentionally covered in this phase is:

- trade-row storage drift with live-storage repair

The key missing-artifact scenario intentionally covered in this phase is:

- no exportable execution-trace rows

## 5. Cross-Layer Integrity Requirements

The following properties are now treated as phase-complete and must stay aligned:

- artifact metadata
  - manifest kinds, export keys, format/media metadata, payload class
- availability flags
  - export-index availability must match the actual heavy-export gate
- endpoint paths
  - service-produced `endpoint_path` values must match the real HTTP routes
- payload formats
  - compact manifests stay compact
  - trace JSON stays structured for AI/automation
  - trace CSV stays spreadsheet/operator-friendly

The practical rule is:

- the export index is the discoverability layer
- the manifests are the compact handoff layer
- the execution-trace JSON/CSV endpoints are the heavy artifact layer

All three layers must tell the same truth about one run.

## 6. Validation Entry Points

Focused validation for this handoff snapshot:

- acceptance:

```bash
python3 -m pytest tests/test_rule_backtest_reopen_acceptance.py -q
```

- backend service support bundle coverage:

```bash
python3 -m pytest tests/test_rule_backtest_service.py -q
```

- backend API contract coverage:

```bash
python3 -m pytest tests/test_backtest_api_contract.py -q
```

- HTTP E2E support bundle coverage:

```bash
python3 -m pytest tests/test_rule_backtest_support_bundle_e2e.py -q
```

- combined handoff sweep:

```bash
python3 -m pytest tests/test_rule_backtest_reopen_acceptance.py tests/test_rule_backtest_service.py tests/test_backtest_api_contract.py tests/test_rule_backtest_support_bundle_e2e.py -q
```

- minimal syntax check:

```bash
python3 -m py_compile tests/test_rule_backtest_reopen_acceptance.py
```

## 7. Read Order For Future Work

If a future reviewer or AI debugging session needs to reason about this surface, use this order:

1. this handoff snapshot
2. `docs/backtest-system.md`
3. `docs/backtest-system_EN.md`
4. `tests/test_rule_backtest_reopen_acceptance.py`
5. `tests/test_rule_backtest_service.py`
6. `tests/test_backtest_api_contract.py`
7. `tests/test_rule_backtest_support_bundle_e2e.py`

## 8. Out Of Scope

The following remain intentionally out of scope for this completed slice:

- frontend support bundle UX
- zip packaging or download bundle assembly
- additional artifact families beyond the four stable exports
- multi-run export surfaces
- broader backtest architecture cleanup
- PostgreSQL migration or storage-model redesign

## 9. Final Handoff Summary

The rule-backtest support bundle backend surface is now phase-complete at the contract level: service helpers, export-index discovery, compact manifests, heavy execution-trace exports, and HTTP endpoints all resolve to one coherent stored-first truth. Stored-first, live-storage-repair, and missing-trace scenarios are explicitly covered; compact manifests stay aligned with run-level diagnostics and authority metadata; export-index paths and availability flags match the real endpoints; and execution-trace JSON/CSV exports fail closed when no trace rows exist. Future work should treat this as the stable backend handoff baseline unless genuinely contradictory evidence appears.
