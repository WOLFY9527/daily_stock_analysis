# Rule Backtest Reopen Trustworthiness P0 Status Index

## 1. Goal

Provide one concise backend handoff/index document for the completed P0 rule-backtest stored-first reopen trustworthiness line.

This document is closure-only and handoff-only. It does not authorize or implement:

- new reopen provenance slices
- P1 feature work
- database migration or PG cutover
- frontend changes
- strategy-runtime changes
- broad backtest redesign

Its purpose is narrower:

- summarize which reopen domains are already hardened
- define the intended authority states
- point future reviewers/agents to the acceptance entry points
- state what is intentionally still out of scope after P0 closure

## 2. Current P0 Posture

The P0 stored-first reopen trustworthiness line is now considered functionally complete enough for closure.

What this means:

- detail/history reopen paths now have a stable `result_authority` contract
- the major persisted rule-backtest domains now reopen with explicit provenance and completeness diagnostics
- integrated acceptance coverage now checks detail/history parity and summary/subdomain anti-drift
- future work should not casually reopen these P0 slices unless new contradictory evidence appears

What this does not mean:

- no claim of P1 analytics/product completeness
- no claim of engine/runtime redesign
- no claim of database or PG migration progress

## 3. Hardened Domains

The completed P0 reopen hardening line covers these domains:

- `result_authority`
  - versioned top-level contract via `contract_version` + `domains`
  - legacy flat authority fields preserved for compatibility
- `summary`
  - stored-first reopen with repaired/derived fallback diagnostics
- `parsed_strategy`
  - stored-first parsed/executable spec reopen with repaired/summary-only/unavailable handling
- `metrics`
  - stored `summary.metrics` preferred, explicit row-column fallback diagnostics
- `execution_model`
  - stored `summary.execution_model` preferred, then stored request snapshot, then derived fallback
- `execution_assumptions_snapshot`
  - persisted snapshot preferred over loose assumptions payload
- `comparison`
  - stored `summary.visualization.comparison` preferred with explicit missing-section repair states
- `replay/audit payload`
  - stored `audit_rows` / `daily_return_series` / `exposure_curve` preferred with explicit repair/legacy rebuild states
- `trade_rows`
  - persisted `rule_backtest_trades` preferred with compat-repair diagnostics
- `equity_curve`
  - persisted `equity_curve_json` preferred with explicit repair / derived / unavailable states
- `execution_trace`
  - persisted trace preferred with explicit rebuilt / repaired / unavailable states

### Reopen/Readback Contract Snapshot

The current phase-complete reopen/readback contract should be understood as:

- covered read surfaces
  - `status`
    - intentionally lighter than detail/history
    - carries the compact reopen summaries that are safe and useful for polling/reopen trust checks: `run_diagnostics`, `run_timing`, `artifact_availability`, `readback_integrity`
  - `detail`
    - carries the full stored-first reopen payload plus the same compact summaries
    - remains the authority surface for heavyweight persisted domains such as `execution_trace`, replay/audit payloads, and trade rows
  - `history`
    - carries the same shared compact summaries as `detail`/`status`
    - preserves parity for the shared stored-first reopen domains that are safe to list without performing a detail-only read

- supported reopen/readback scenarios
  - `stored-first`
    - modern stored summary/domain snapshots exist and reopen directly from persisted data
  - `stored-repaired`
    - stored snapshots exist but require bounded repair from other already-persisted artifacts
  - `legacy fallback`
    - modern stored summary blocks are absent and the service derives a compatibility view from older persisted row/storage data
  - `live-storage repair / summary-storage drift`
    - stored summary booleans or summary-level expectations no longer match current persisted artifacts, so the read path repairs the response from live stored facts and marks the drift explicitly

- summary domains that are now part of the stable reopen contract
  - `run_diagnostics`
  - `run_timing`
  - `artifact_availability`
  - `readback_integrity`

This snapshot is the intended backend handoff/readiness boundary for the current phase. Future work may consume these summaries, but should not add another parallel reopen summary layer without new contradictory evidence.

## 4. Authority States

The intended meanings of the main authority states are:

- `complete`
  - the reopened payload came directly from the persisted domain snapshot in the expected shape
- `stored_partial_repaired`
  - a persisted snapshot existed, but one or more fields/sections were missing and were repaired from other already-stored artifacts or row columns
- `legacy_row_columns`
  - no modern stored domain snapshot existed, and reopen fell back to legacy run-row columns
- `legacy_rebuilt`
  - no direct stored snapshot existed for that domain, but the payload was rebuilt from older stored artifacts that are still considered acceptable for legacy compatibility
- `legacy_derived`
  - no stored summary snapshot existed, and the top-level summary was derived from already-resolved stored domains and row columns
- `omitted`
  - the domain was intentionally not read on this surface, typically history/list endpoints
- `unavailable`
  - the service could not produce a trustworthy payload from persisted artifacts

The main source labels that future work should continue to preserve semantically are:

- persisted domain sources such as `row.summary_json`, `row.parsed_strategy_json`, `row.equity_curve_json`, `summary.execution_model`, `summary.visualization.comparison`
- repaired variants such as `+repaired_fields` and `+repaired_sections`
- intentional list/history omission via `omitted_without_detail_read`
- legacy derivation labels such as `row_columns_fallback`, `derived_from_stored_run_artifacts`, `derived_from_summary.visualization.audit_rows`, `derived_from_stored_domains+row_columns`
- hard failure state `unavailable`

## 5. Acceptance Entry Points

The key acceptance and contract entry points for this P0 line are:

- Integrated reopen acceptance:

```bash
python3 -m pytest tests/test_rule_backtest_reopen_acceptance.py -q
```

- Backend service reopen contract coverage:

```bash
python3 -m pytest tests/test_rule_backtest_service.py -q
```

- API contract coverage for detail/history authority serialization:

```bash
python3 -m pytest tests/test_backtest_api_contract.py -q
```

- Combined closure sweep:

```bash
python3 -m pytest tests/test_rule_backtest_service.py tests/test_rule_backtest_reopen_acceptance.py tests/test_backtest_api_contract.py -q
```

- Minimal syntax check for the touched Python surfaces:

```bash
python3 -m py_compile src/services/rule_backtest_service.py tests/test_rule_backtest_service.py tests/test_rule_backtest_reopen_acceptance.py tests/test_backtest_api_contract.py
```

## 6. What Is Intentionally Out Of Scope For P0

The following should still be treated as out of scope for this completed P0 line:

- new provenance domains beyond the completed list above
- UI/UX work on how the authority contract is displayed
- new analytics or debugging features layered on top of the contract
- engine or strategy-runtime rewrites
- broader backtest architecture cleanup
- database migration or PG cutover work
- scanner or other unrelated backend lines

## 7. Future-Conversation Guidance

A future reviewer or future AI-assisted debugging session should treat the following as already settled unless new evidence contradicts them:

- stored-first reopen is the default policy for the hardened rule-backtest domains
- detail/history authority semantics are intentional and tested
- `domains.<name>` is the normalized authority view that should be preferred for cross-domain reasoning
- history surfaces may intentionally omit detail-only domains while still preserving shared-domain parity
- reopened `summary` should stay aligned with the resolved subdomain payloads rather than echoing stale stored fragments

Recommended read order for a future bounded conversation:

1. this status index
2. `docs/backtest-system.md` or `docs/backtest-system_EN.md` for user/system-facing backtest context
3. `tests/test_rule_backtest_reopen_acceptance.py`
4. `tests/test_rule_backtest_service.py`
5. `tests/test_backtest_api_contract.py`

## 8. Final One-Paragraph Handoff Summary

The rule-backtest stored-first reopen trustworthiness P0 line is now closed at a practical backend-handoff level: `result_authority` is normalized and versioned, the main persisted rule-backtest domains reopen with explicit provenance/completeness semantics, detail/history parity is covered by integrated acceptance tests, and reopened `summary` is aligned to the resolved subdomain payloads rather than stale stored fragments. Future work should use this as a stable baseline for AI-assisted debugging and any later P1 work, without casually reopening these P0 slices unless genuinely new inconsistency is found.
