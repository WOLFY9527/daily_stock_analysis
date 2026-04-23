# Backtest Helper Maintenance Manual

## Scope

This manual covers the helper-maintenance work around:

- `src/services/backtest_service.py`
- `src/services/rule_backtest_service.py`
- `src/services/portfolio_service.py`
- `src/services/us_history_helper.py`

Primary goals:

- preserve a readable stored-first US history path after wrapper removal
- document the consolidated Phase F comparison helpers
- make validation and rollback repeatable for both human and AI-assisted operators

## Consolidated Helpers

### `PortfolioService._normalize_phase_f_compare_value`

- Purpose: normalize Phase F comparison values before equality checks so representation-only `created_at` drift does not create false blocking mismatches.
- Current contract:
  - all fields other than `created_at` are returned unchanged
  - `created_at` accepts `datetime`, ISO-like `str`, or `None`
  - timezone-only drift is normalized by dropping `tzinfo` while preserving the wall-clock representation
  - invalid datetime strings remain unchanged so real payload drift stays visible
- Current usage surfaces:
  - trade-list comparison
  - cash-ledger comparison
  - corporate-actions comparison

Example:

```python
normalized = PortfolioService._normalize_phase_f_compare_value(
    field_name="created_at",
    value="2026-04-21T00:49:23.107279+08:00",
)
assert normalized == "2026-04-21T00:49:23.107279"
```

### `PortfolioService._summarize_phase_f_result_view`

- Purpose: build a bounded diagnostic summary for comparison reports without embedding full row payloads in logs or evidence artifacts.
- Current contract:
  - input is a paginated response-like mapping with `total`, `page`, `page_size`, `items`
  - output contains `total`, `page`, `page_size`, `page_item_count`, `ordered_ids`
  - missing pagination values fall back to existing service defaults
- The helper is intentionally payload-light and safe for report collection.

Example:

```python
summary = PortfolioService._summarize_phase_f_result_view(
    {"total": 2, "page": 1, "page_size": 20, "items": [{"id": 21}, {"id": 20}]}
)
assert summary["ordered_ids"] == [21, 20]
```

## Wrapper-Removal Call Sites

### `BacktestService`

The removed wrapper previously forwarded to `fetch_daily_history_with_local_us_fallback(...)`. The active runtime call sites are now:

- the historical-evaluation fill path in `run_backtest()`
- the sample warmup path in `prepare_backtest_samples()`

Debug intent:

- if a US historical-evaluation run cannot resolve `start_daily` or enough forward bars, inspect whether `fetch_daily_history_with_local_us_fallback` was called with:
  - the symbol as the first positional argument
  - `log_context="[historical-eval fill]"`
- if sample preparation reports `missing_market_history`, inspect the warmup call with:
  - `log_context="[historical-eval warmup]"`

### `RuleBacktestService`

The removed wrapper previously forwarded to the same shared helper. The active runtime call sites are now:

- date-range warmup in `_ensure_market_history(..., start_date=..., end_date=...)`
- rolling-history warmup in `_ensure_market_history(...)`

Debug intent:

- date-range runs should call the shared helper with `log_context="[rule-backtest date-range history]"`
- rolling warmups should call the shared helper with `log_context="[rule-backtest history]"`

## Validation Workflow

Run these commands from the repo root:

```bash
pytest tests/test_backtest_service.py
pytest tests/test_portfolio_service.py
pytest tests/test_postgres_phase_e.py
pytest tests/test_rule_backtest_service.py -k "service_run_backtest_fetches_missing_us_history_via_shared_local_first_helper"
pytest tests/test_postgres_phase_f.py -k "created_at_timezone_format_only_drift or created_at_payload_mismatch or ordering_mismatch_after_created_at_normalization"
pytest tests/test_postgres_phase_e_real_pg.py -k "historical_eval_round_trip"
python3 -m py_compile $(rg --files src/services -g '*.py')
```

## Targeted Debug Recipes

### Recipe 1: `BacktestService` US history fill path

Use when `run_backtest(code="AAPL", ...)` reports `insufficient_data` unexpectedly.

1. Run:

```bash
pytest tests/test_backtest_service.py -k "run_backtest_fetches_missing_us_history_via_shared_local_first_helper"
```

2. Confirm the shared helper was called once with `log_context="[historical-eval fill]"`.
3. Inspect persisted `StockDaily` rows for the symbol if the fetch call succeeded but the evaluation still failed.

### Recipe 2: `RuleBacktestService` date-range warmup

Use when a rule run for a US symbol returns `insufficient_history`.

1. Run:

```bash
pytest tests/test_rule_backtest_service.py -k "service_run_backtest_fetches_missing_us_history_via_shared_local_first_helper"
```

2. Confirm the shared helper was called once with `log_context="[rule-backtest date-range history]"`.
3. If the fetch succeeds but the run still returns no result, inspect the saved `StockDaily` range and `lookback_bars`.

### Recipe 3: Phase F comparison drift triage

Use when comparison reports unexpectedly mark trade-list, cash-ledger, or corporate-actions payloads as mismatched.

1. Run:

```bash
pytest tests/test_portfolio_service.py -k "phase_f_compare_methods_"
pytest tests/test_postgres_phase_f.py -k "created_at_timezone_format_only_drift or created_at_payload_mismatch"
```

2. Interpret results:
  - timezone-only drift should match cleanly
  - real timestamp drift should still report `payload_field_mismatch`
3. If only one surface fails, inspect the corresponding `_compare_phase_f_*_results` contract fields before changing the shared helper.

## Real Postgres Validation

The targeted real Postgres check for this maintenance pass is:

```bash
pytest tests/test_postgres_phase_e_real_pg.py -k "historical_eval_round_trip"
```

Observed result in this pass:

- passed

This validates the Phase E historical-evaluation round trip with the shared local-first fetch path still intact.

## Hygiene Scan Findings

No clearly-unused helper function was identified as safe to delete outright in the touched `src/services` scope after this pass.

Follow-up consolidation candidates:

- `_owner_kwargs` is still duplicated across:
  - `BacktestService`
  - `RuleBacktestService`
  - `PortfolioService`
- `_default_currency_for_market` is still duplicated across:
  - `PortfolioService`
  - `PortfolioImportService`
  - `PortfolioIbkrSyncService`
- `RuleBacktestService._dedupe_compare_market_code_diagnostics` and `RuleBacktestService._dedupe_compare_period_diagnostics` still have identical bodies and could be merged in a later narrow refactor.

Deferred intentionally:

- Phase F report emit/collect helpers are still parallel but not identical enough to merge casually without expanding review scope.
- No API schema, frontend behavior, or deterministic engine semantics were changed in this maintenance pass.

## Residual Gaps

- The full `tests/test_postgres_phase_e_real_pg.py` module was not run; only the historical-evaluation path was validated.
- No broad refactor was attempted for service-level ownership helpers such as `_owner_kwargs`, because that would expand beyond the current helper-maintenance scope.
- The compare-surface consistency validation is intentionally centered on `created_at` normalization, which was the consolidated behavior under maintenance.

## Rollback

Recommended rollback path:

1. keep this maintenance work in a single commit
2. revert with:

```bash
git revert <commit_sha>
```

If the revert must be partial, revert in this order:

1. docs and audit artifacts
2. newly added tests
3. helper docstring edits
4. helper-consolidation code

## Documentation Placement

- This manual is maintenance-focused and intentionally lives under `docs/` instead of `README.md`.
- The broader system overview remains in `docs/backtest-system.md` and `docs/backtest-system_EN.md`.
