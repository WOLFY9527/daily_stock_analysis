# Backtest System

## Service Ownership

- Standard historical-evaluation endpoints are owned by `src/services/backtest_service.py`:
  - `POST /api/v1/backtest/run`
  - `POST /api/v1/backtest/prepare-samples`
  - `GET /api/v1/backtest/results`
  - `GET /api/v1/backtest/sample-status`
  - `GET /api/v1/backtest/runs`
  - `GET /api/v1/backtest/performance`
  - `GET /api/v1/backtest/performance/{code}`
  - `POST /api/v1/backtest/samples/clear`
  - `POST /api/v1/backtest/results/clear`
- Rule-backtest endpoints are owned by `src/services/rule_backtest_service.py`:
  - `POST /api/v1/backtest/rule/parse`
  - `POST /api/v1/backtest/rule/run`
  - `POST /api/v1/backtest/rule/compare`
  - `GET /api/v1/backtest/rule/runs`
  - `GET /api/v1/backtest/rule/runs/{run_id}`
  - `GET /api/v1/backtest/rule/runs/{run_id}/status`
  - `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest`
  - `POST /api/v1/backtest/rule/runs/{run_id}/cancel`

## Async And Background Execution

- `POST /api/v1/backtest/rule/run` is asynchronous by default and returns one of `queued / parsing / running / summarizing / completed / failed / cancelled`.
- Pass `wait_for_completion=true` to run inline and return the full completed payload.
- `GET /api/v1/backtest/rule/runs/{run_id}/status` is the lightweight polling endpoint for background progress.
- `GET /api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest` returns the compact stored-first support bundle manifest for one rule-backtest run. It reuses the existing detail readback summaries for `run_timing`, `run_diagnostics`, `artifact_availability`, `readback_integrity`, and normalized `result_authority.domains`, then adds only lightweight `artifact_counts` for handoff, AI debugging, and automation scripts; it does not inline heavy payloads such as `trades`, `equity_curve`, `audit_rows`, or the full `execution_trace` by default.
- `POST /api/v1/backtest/rule/runs/{run_id}/cancel` is a best-effort cancel endpoint: unfinished runs are marked `cancelled`, while already-finished runs keep their final state.
- `POST /api/v1/backtest/rule/compare` is the stored-first compare-runs read path: it only reads already-persisted completed runs, does not re-execute backtests, and currently returns the smallest trustworthy comparison surface across metadata, `parsed_strategy`, core metrics, benchmark summary, `execution_model`, each run's `result_authority`, plus seven additive top-level summaries: `market_code_comparison`, `period_comparison`, `comparison_summary`, `parameter_comparison`, `robustness_summary`, `comparison_profile`, and `comparison_highlights`. `market_code_comparison` only consumes persisted `metadata.code` from the compare items, normalizes the code into a `cn / hk / us` market tag, and explicitly classifies `same_code / same_market_different_code / different_market / partial_metadata / unavailable_metadata`; only `same_code` is marked as `state=direct` with `directly_comparable=true`. `period_comparison` only reads persisted `metadata.period_start/period_end` bounds from the compare items, never re-runs the backtest, and explicitly classifies the period relationship as `identical / overlapping / disjoint / partial / unavailable`; `comparison_summary` always picks the first comparable run in request order as the baseline and emits deltas/comparability diagnostics for a narrow trusted metric set; `parameter_comparison` only uses persisted `parsed_strategy.strategy_spec` plus parsed-strategy authority diagnostics to answer whether the runs are comparable as the same normalized strategy family/type and which parameter keys are shared, different, or missing; `robustness_summary` only reuses those four already-computed compare layers and emits a compact overall `highly_comparable / partially_comparable / context_limited / insufficient_context` state plus per-dimension `aligned / partial / divergent / unavailable` summaries for `market_code / metrics_baseline / parameter_set / periods`; `comparison_profile` then classifies the compare request into one deterministic primary mode: `same_strategy_parameter_variants / same_code_different_periods / same_market_cross_code / cross_market_mixed / mixed_context / insufficient_context`; `comparison_highlights` finally reuses only trusted `comparison_summary.metric_deltas`, `robustness_summary`, and `comparison_profile` to emit compact per-metric `winner / tie / limited_context_winner / limited_context_tie / unavailable` highlights instead of silently ranking every visible number.
- `GET /api/v1/backtest/rule/runs/{run_id}` remains the full-detail endpoint and includes `execution_trace`, trades, and audit data.
- The `result_authority` object on detail/history payloads now also exposes replay/audit reopen diagnostics: `replay_payload_source` / `replay_payload_completeness` / `replay_payload_missing_sections` plus `audit_rows_source` / `daily_return_series_source` / `exposure_curve_source`. These fields distinguish between directly persisted payloads, sections repaired from persisted audit rows, legacy replay payload rebuilt from stored run artifacts, and omitted/unavailable states.
- `execution_model` reopen now follows the same stored-first rule: the service first reads `summary.execution_model`, then falls back to persisted `summary.request.execution_model`, and only derives from stored assumptions / row/request when neither snapshot exists. `result_authority` now also exposes `execution_model_source` / `execution_model_completeness` / `execution_model_missing_fields` so consumers can distinguish a directly persisted snapshot, a repaired stored snapshot, and a legacy-derived execution model.
- `trade_rows` reopen now follows the same stored-first rule: detail reads prefer persisted `rule_backtest_trades`, and `result_authority` now also exposes `trade_rows_source` / `trade_rows_completeness` / `trade_rows_missing_fields`. Older runs with partial trade-row helper JSON (`entry_rule_json` / `exit_rule_json` / `notes`) still return a stable `trades` payload, but are explicitly marked as `stored_rule_backtest_trades+compat_repair` / `stored_partial_repaired`; runs whose summary metrics indicate trades but whose persisted trade rows are missing are now explicitly marked `unavailable` instead of silently looking like a complete empty list.
- To keep reopen/debug flows from having to infer artifact presence from `result_authority` omissions or scattered null checks, the status/detail/history read paths now all expose a structured `artifact_availability` summary and mirror the same block into `summary.artifact_availability`. The summary answers only the narrow persisted-availability question: whether the run still has a reopenable stored summary, parsed strategy, metrics, execution model, comparison payload, trade rows, equity curve, execution trace, run diagnostics, and run timing. When older summaries do not contain this block, the service derives a compatibility view from current persisted storage; when the stored summary has drifted from live trade-row storage, the response is explicitly marked as a live-storage repair instead of replaying stale booleans.
- To make the trust level of a reopened response easier to evaluate directly, the status/detail/history read paths now also expose a compact `readback_integrity` summary. It does not duplicate payload contents; it only answers the integrity question for the current read path: whether legacy fallback was used, whether live-storage repair was used, whether summary/storage drift exists, which drift domains are affected, which key summary fields are still missing, and whether the current integrity level is `stored_complete`, `stored_repaired`, `legacy_fallback`, or `drift_repaired`. The summary is intentionally built on top of the existing `result_authority` and `artifact_availability` signals instead of creating a second parallel provenance system.
- To make the authority contract more uniform across detail/history surfaces, `result_authority` now also includes a versioned normalized view: `contract_version` plus `domains`. Each `domains.<name>` entry uses the same five keys: `source`, `completeness`, `state`, `missing`, and `missing_kind`. The older flat authority fields remain in place for compatibility.

## P5 Web Usability Layer

- `/backtest` remains the configuration-and-launch page. This phase does not redesign the working standard or rule-backtest backend flow; it tightens input grouping, button wording, and state copy so users can understand the next step more easily.
- `/backtest/results/:runId` now keeps a dedicated run-status card above the result summary and chart workspace. While a rule run is active, the page polls `GET /api/v1/backtest/rule/runs/{run_id}/status`; once the run reaches `completed / failed / cancelled`, polling stops automatically.
- `/backtest/compare?runIds=...` now exists as the first minimal compare workbench route. It consumes the existing `POST /api/v1/backtest/rule/compare` stored-first response directly instead of reloading multiple result details and inventing frontend-only conclusions. The `History` tab on `/backtest/results/:runId` still pins the current run as the baseline, lets users select additional completed runs, and now exposes an `Open compare workbench` action that forwards those ordered run ids into the new page for compact compare-summary / robustness / profile / highlights / market / period / parameter sections.
- Active rule runs now surface the full lifecycle more clearly: `parsing / queued / running / summarizing / completed / cancelled / failed`. The UI also exposes a safe `Cancel run` action during cancellable stages and still reuses the existing `POST /api/v1/backtest/rule/runs/{run_id}/cancel` contract.
- The result page promotes user-facing summary metrics first: total return, relative benchmark or buy-and-hold comparison, max drawdown, trade count, win rate, and final equity. Raw parameters, execution assumptions, technical notes, and history remain available as secondary detail.
- `execution_trace` still comes from the existing detail payload, but the Web UI now defaults to a lighter “highlights” view that focuses on buy/sell actions, fallback notes, and exceptions. Users can still switch to the full trace and export CSV / JSON.
- Historical Evaluation now explains LocalParquet versus fallback in simpler product language. The raw diagnostics fields `requested_mode / resolved_source / fallback_used` remain available under a disclosure so the main flow stays readable.

## Local US Parquet Priority

- US daily history first reads `LOCAL_US_PARQUET_DIR`.
- If `LOCAL_US_PARQUET_DIR` is unset, the code falls back to `US_STOCK_PARQUET_DIR` for backward compatibility.
- A local parquet hit reports `resolved_source=LocalParquet` and skips online fetching.
- If local parquet is missing or invalid, the backtest flow follows the existing fetch fallback path and exposes `requested_mode / resolved_source / fallback_used` in responses.

## Run The API Locally

```bash
.venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000
```

Optional environment variables:

```bash
export LOCAL_US_PARQUET_DIR=/path/to/local/us/parquet
# Use only for legacy compatibility
export US_STOCK_PARQUET_DIR=/path/to/local/us/parquet
```

## Smoke Scripts

- The committed smoke scripts currently checked into the repo automatically:
  - boot a temporary uvicorn server
  - disable admin auth
  - create a temporary database
  - prepare a temporary `LOCAL_US_PARQUET_DIR` fixture
  - run assertions and clean everything up

- Standard backtest API smoke:

```bash
python3 scripts/smoke_backtest_standard.py
```

- Rule backtest API smoke:

```bash
python3 scripts/smoke_backtest_rule.py
```

- Run both:

```bash
python3 scripts/smoke_backtest_standard.py && python3 scripts/smoke_backtest_rule.py
```

## Known Assumptions And Limits

- Real local-parquet reads in production still require `pyarrow` or `fastparquet`; when a parquet engine is unavailable, the repo smoke scripts inject a test-only shim so the `LOCAL_US_PARQUET_DIR` priority path and async endpoints can still be validated.
- Synchronous rule backtests still depend on market data being available locally or through the existing data-source fallback chain.
- `execution_trace` detail and CSV / JSON exports treat persisted `audit_rows` as the source of truth; older runs that do not store it are rebuilt on read and marked with `trace_rebuilt`.
- The `execution_model` detail field is now normalized into a stable shape during reopen as well; older runs with only partial execution-model snapshots are marked as `stored_partial_repaired` with explicit missing-field diagnostics instead of returning a structurally incomplete payload.
- The `trade_rows` detail field is now normalized into a stable shape during reopen as well; older runs with partial persisted trade-row helper JSON are marked as `stored_partial_repaired` with explicit missing-field diagnostics, and runs whose run row still reports trades while persisted trade rows are absent are marked as `unavailable` instead of being mistaken for complete zero-trade results.
- Replay-visualization reopen now follows the same stored-first rule: non-empty persisted `summary.visualization.audit_rows` / `daily_return_series` / `exposure_curve` sections stay authoritative, while older runs with missing or empty replay sections are explicitly marked as `stored_partial_repaired`, `derived_from_stored_run_artifacts`, or `unavailable` instead of silently presenting regenerated payloads as fully persisted data.
