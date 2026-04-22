# Rule Backtest Support Bundle Backend Handoff Snapshot

## 1. Goal

Provide one narrow backend-only handoff snapshot for the completed rule-backtest support bundle contract.

This snapshot exists to keep future conversations grounded in the current implementation of:

- service helpers
- `export-index` discovery
- compact manifest endpoints
- heavy execution-trace exports
- HTTP acceptance/E2E coverage

It is intentionally not a feature-expansion document.

## 2. Scope Boundary

This handoff snapshot covers only the single-run backend support bundle surface for:

- `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest`
- `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-reproducibility-manifest`
- `GET /api/v1/backtest/rule/runs/{run_id}/export-index`
- `GET /api/v1/backtest/rule/runs/{run_id}/execution-trace.json`
- `GET /api/v1/backtest/rule/runs/{run_id}/execution-trace.csv`

Out of scope:

- frontend changes
- new artifact types
- packaging/export bundles on disk
- multi-run aggregation
- reopening the broader stored-first trustworthiness line

## 3. Stable Contract Snapshot

### Export Index

`GET /api/v1/backtest/rule/runs/{run_id}/export-index` is the backend discovery surface for the current support bundle contract.

The stable export set is:

| key | available when | format | media_type | delivery_mode | endpoint_path | payload_class |
| --- | --- | --- | --- | --- | --- | --- |
| `support_bundle_manifest_json` | run exists | `json` | `application/json` | `api` | `/api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest` | `compact` |
| `support_bundle_reproducibility_manifest_json` | run exists | `json` | `application/json` | `api` | `/api/v1/backtest/rule/runs/{run_id}/support-bundle-reproducibility-manifest` | `compact` |
| `execution_trace_json` | resolved `execution_trace.rows` is non-empty | `json` | `application/json` | `api` | `/api/v1/backtest/rule/runs/{run_id}/execution-trace.json` | `heavy` |
| `execution_trace_csv` | resolved `execution_trace.rows` is non-empty | `csv` | `text/csv` | `api` | `/api/v1/backtest/rule/runs/{run_id}/execution-trace.csv` | `heavy` |

Trace availability reasons are intentionally narrow:

- `execution_trace_rows_present`
- `execution_trace_rows_missing`

### Compact Manifests

`support-bundle-manifest` is the compact operational handoff artifact.

It must stay aligned with the resolved run payload for:

- `run`
- `run_timing`
- `run_diagnostics`
- `artifact_availability`
- `readback_integrity`
- `result_authority.domains`
- `artifact_counts`

`support-bundle-reproducibility-manifest` is the compact reproducibility/migration handoff artifact.

It must stay aligned with the same resolved run payload for:

- `run`
- `run_timing`
- `run_diagnostics`
- `artifact_availability`
- `readback_integrity`
- summarized `result_authority.domains`
- `execution_assumptions_fingerprint`

### Heavy Trace Exports

The execution-trace exports are intentionally the only heavy support-bundle artifacts exposed over HTTP in this phase.

- `execution-trace.json` returns structured trace rows and execution metadata for AI/debugging/automation consumers.
- `execution-trace.csv` returns spreadsheet/operator-friendly trace rows and sets `Content-Disposition` for download.
- When trace rows are unavailable, both endpoints return `409` with `error=export_unavailable` instead of fabricating an empty export.

## 4. Cross-Layer Integrity Rules

The current handoff contract is considered coherent only if the following stay true together:

- service helper payloads match the API endpoint payloads for the same run
- `export-index` keys, endpoint paths, delivery metadata, and availability reasons match the real HTTP surface
- manifest/reproducibility payloads share the same `run_timing`, `run_diagnostics`, `artifact_availability`, and `readback_integrity`
- trace availability flags match both manifest artifact counts and trace endpoint behavior
- missing-trace runs close both heavy exports truthfully with `409 export_unavailable`

## 5. Scenario Matrix

The acceptance surface is explicitly locked for three scenarios:

- stored-first happy path
  - manifests are available
  - both trace exports are available
  - trace row counts and authority source agree across service/API/HTTP
- live-storage-repair path
  - manifests remain available
  - trade-row drift is surfaced through `artifact_availability` and `readback_integrity`
  - trace exports remain available when trace rows still exist
- missing-trace path
  - manifests remain available
  - export index marks both trace exports unavailable
  - JSON/CSV trace endpoints both return `409 export_unavailable`

## 6. Acceptance Entry Points

The current backend contract evidence for this slice lives in:

- service helper contract coverage

```bash
python3 -m pytest tests/test_rule_backtest_service.py -q -k support_bundle_artifact_exports
```

- API contract coverage

```bash
python3 -m pytest tests/test_backtest_api_contract.py -q -k support_bundle_api_surface
```

- HTTP E2E coverage

```bash
python3 -m pytest tests/test_rule_backtest_support_bundle_e2e.py -q
```

- Syntax check for the touched Python tests

```bash
python3 -m py_compile tests/test_backtest_api_contract.py tests/test_rule_backtest_support_bundle_e2e.py
```

## 7. Handoff Guidance

Future backend work should treat this support bundle surface as phase-complete unless new contradictory evidence appears.

Do not reopen this slice just to:

- rename artifacts
- add packaging wrappers
- move compact data into heavy exports
- create parallel support bundle summaries
- broaden to multi-run exports without an explicit new scope decision

## 8. Final Summary

The rule-backtest support bundle backend contract is now intended to be consumed as one coherent surface: service helpers, `export-index`, compact manifests, and heavy execution-trace exports all describe the same single-run stored-first reality, with explicit behavior for live-storage-repair drift and missing-trace closure. This is the backend handoff baseline for AI-assisted debugging, operational support, reproducibility checks, and later migration work.
