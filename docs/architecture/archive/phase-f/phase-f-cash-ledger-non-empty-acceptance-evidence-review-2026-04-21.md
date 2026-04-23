# Phase F Cash-Ledger Non-Empty Acceptance-Evidence Review

## Goal

Document the bounded non-empty comparison-only evidence collected for cash-ledger on a real local PostgreSQL store and evaluate whether the current line is now past empty-only evidence.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL serving for `GET /api/v1/portfolio/cash-ledger`.

## Status Of This Document

This review builds on:

- [phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md)
- [phase-f-cash-ledger-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-acceptance-evidence-review-2026-04-21.md)
- [phase-f-cash-ledger-non-empty-evidence-collection-plan-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-non-empty-evidence-collection-plan-2026-04-21.md)

Code anchors used for this review:

- [tests/test_postgres_phase_f_real_pg.py](/Users/yehengli/daily_stock_analysis_backend/tests/test_postgres_phase_f_real_pg.py)
- [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py)
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/src/postgres_phase_f.py)

This review is grounded in the focused real-PG evidence pass captured by:

- `tests/test_postgres_phase_f_real_pg.py::PostgresPhaseFRealPgTestCase::test_real_postgres_phase_f_cash_ledger_comparison_collects_bounded_non_empty_evidence`

Executed local verification command:

```bash
POSTGRES_PHASE_A_REAL_DSN=postgresql://postgres@127.0.0.1:55432/postgres \
python3 -m pytest tests/test_postgres_phase_f_real_pg.py -k cash_ledger_comparison_collects_bounded_non_empty_evidence -q -p no:cacheprovider
```

## 1. Exact Request Shapes Sampled

The bounded non-empty request window is exactly:

1. default non-empty list
   - `account_id=1&page=1&page_size=20`
2. forced small page
   - `account_id=1&page=1&page_size=1`
3. second page
   - `account_id=1&page=2&page_size=1`
4. simple supported filter
   - `account_id=1&direction=in&page=1&page_size=20`

No broader request matrix was sampled.

## 2. Exact Non-Empty Evidence Observed

The focused real-PG run uses three seeded cash-ledger rows for allowlisted `account_id=1`.

Observed non-empty matched outcomes:

- default list matched with ordered ids `[3, 2, 1]`
- `page=1&page_size=1` matched with ordered ids `[3]`
- `page=2&page_size=1` matched with ordered ids `[2]`
- `direction=in&page=1&page_size=20` matched with ordered ids `[3, 1]`

Across all four sampled requests:

- `comparison_attempted = true`
- `comparison_status = "matched"`
- `comparison_decision = "legacy_served_after_match"`
- `fallback_decision = "legacy_served_after_match"`

Negative observations are equally important:

- no `mismatch`
- no `query_failure`
- no skip-only sampling

## 3. Exact Evidence Summary Outcome

The compact evidence summary for the bounded run is:

- `total_reports = 4`
- `total_attempted = 4`
- `total_skipped = 0`
- `total_matched = 4`
- `total_mismatched = 0`
- `total_query_failures = 0`
- `matched_empty_reports = 0`
- `matched_non_empty_reports = 4`
- `non_empty_match_observed = true`
- `hard_blocking_issue_observed = false`
- `hard_blocking_issue_classes = []`
- `allowlisted_account_ids = [1]`
- `uncovered_allowlisted_account_ids = []`
- `evidence_strength = "non_empty_sampled"`
- `evidence_is_thin = false`

## 4. What This Changes

This pass answers the current cash-ledger evidence question clearly:

- cash-ledger is no longer limited to empty-only comparison evidence
- the current line now has bounded real-PG non-empty comparison evidence
- the current evidence is strong enough for a bounded comparison-only checkpoint review

This specifically strengthens confidence in:

- non-empty page membership parity
- non-empty ordered id parity
- non-empty pagination parity
- one simple supported filter shape on real returned rows

## 5. What This Still Does Not Change

This pass does not change any of the existing guardrails:

- legacy remains the only serving source
- PG remains comparison-only
- no replay semantics are covered
- no snapshot semantics are covered
- no write-path migration is implied
- no broader cutover discussion is justified by this pass alone

## 6. Final Review Conclusion

For the bounded cash-ledger comparison-only line, the evidence state is now:

- backend-only
- conservative
- comparison-only
- allowlist-bounded
- non-empty sampled
- reviewer-usable

That is sufficient for the current bounded checkpoint.

It is not sufficient to claim:

- PG serving readiness
- replay readiness
- snapshot readiness
- broad operational coverage
