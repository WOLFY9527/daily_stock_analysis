# Phase F Trades-List Non-Empty Acceptance-Evidence Review v2

## Goal

Document the now-verified non-empty comparison-only evidence for the bounded trades-list candidate and evaluate what it changes, and what it still does not change, for future serving-mode discussion.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL serving for `GET /api/v1/portfolio/trades`.

## Status Of This Document

This review builds on the existing bounded trades-list comparison chain:

- [phase-f-trades-list-acceptance-evidence-review-2026-04-20.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-acceptance-evidence-review-2026-04-20.md)
- [phase-f-trades-list-serving-mode-design-acceptance-plan-2026-04-20.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-serving-mode-design-acceptance-plan-2026-04-20.md)
- [phase-f-trades-list-manual-non-empty-seed-runbook-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-manual-non-empty-seed-runbook-2026-04-21.md)
- [phase-f-trades-list-non-empty-evidence-collection-plan-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-non-empty-evidence-collection-plan-2026-04-21.md)

Code anchors used for this review:

- [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py)
- [storage.py](/Users/yehengli/daily_stock_analysis_backend/src/storage.py)
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/src/postgres_phase_f.py)
- [portfolio_repo.py](/Users/yehengli/daily_stock_analysis_backend/src/repositories/portfolio_repo.py)
- [test_postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/tests/test_postgres_phase_f.py)

This review is grounded in the current implemented comparison-only path plus the newly verified local evidence state:

- local PostgreSQL is configured
- the Phase F PG-backed trades comparison source is available
- bounded manual seed data was created for `account_id=1`
- non-empty comparison-only sampling now produces `comparison_status = "matched"`
- earlier `query_failure` and `created_at` formatting drift blockers were resolved before this review

## 1. Current Bounded Comparison-Only Baseline

### 1.1 Exact candidate boundary

This review remains strictly bounded to:

- endpoint: `GET /api/v1/portfolio/trades`
- service path: `PortfolioService.list_trade_events(...)`
- legacy serving source: `PortfolioRepo.query_trades(...)`
- PG comparison source: `DatabaseManager.get_phase_f_trade_list_comparison_candidate(...)`
- PG comparison query implementation: `PostgresPhaseFStore.query_trade_list_comparison_candidate(...)`

Everything else remains outside this review boundary:

- PG serving
- cash-ledger
- corporate-actions
- replay-input
- snapshot-cache
- write-path migration

### 1.2 Current implemented comparison posture

The current implemented posture is unchanged:

- legacy remains the only serving source
- PG remains comparison-only
- comparison execution is owned by `PortfolioService.list_trade_events(...)`
- rollout remains bounded by `ENABLE_PHASE_F_TRADES_LIST_COMPARISON`
- account scoping remains bounded by `PHASE_F_TRADES_LIST_COMPARISON_ACCOUNT_IDS`
- mismatch or query failure remains request-local and diagnostic-only

### 1.3 Current evidence and review surfaces

The current code path can already produce:

- per-request comparison diagnostics
- bounded mismatch reports
- bounded evidence summary output
- bounded promotion-readiness review/checklist output
- bounded in-process evidence collection for repeated comparison reports

That means this review is no longer operating from a structurally empty comparison system. It is reviewing a real comparison-only path with a real PG-backed comparison source and non-empty local candidate data.

## 2. Earlier Blockers That Were Resolved

### 2.1 PG comparison source unavailable

The earlier blocker:

- `comparison_status = "query_failure"`
- `mismatch_class = "query_failure"`
- `query_failure_detail = "phase_f_trades_list_pg_source_unavailable"`

is no longer the current state.

This matters because the earlier review line was blocked partly by source unavailability. That blocker has now been cleared in the current local environment.

### 2.2 Empty-result-only evidence

The earlier evidence state also remained weak because successful matches were only over empty result sets:

- `total = 0`
- `ordered_ids = []`
- `page_item_count = 0`

That blocker is also no longer the current state.

The current review checkpoint is based on non-empty local seed data for `account_id=1`, which means the comparison path has now been exercised against real returned trade rows rather than only empty lists.

### 2.3 False created_at mismatch

The earlier payload mismatch:

- `comparison_status = "mismatch"`
- `mismatch_class = "payload_field_mismatch"`
- `first_mismatch_field = "created_at"`

was identified as a formatting-only drift between semantically equivalent values:

- legacy example: naive ISO string
- PG example: timezone-aware ISO string with offset

That blocker was resolved by bounded comparison normalization in the trades-list comparison path. The review state for this pass assumes that false formatting-only drift is no longer generating mismatches for semantically equivalent `created_at` values.

## 3. Current Non-Empty Evidence Snapshot

### 3.1 Request shapes successfully exercised

The current non-empty local evidence now includes clean matched outcomes for the following bounded request shapes:

- default non-empty list
- `page_size=1`
- `page=2&page_size=1`
- `symbol=AAPL`
- `side=buy`

This is materially stronger than the previous empty-result-only checkpoint because it exercises:

- non-empty list payload parity
- page-local ordering and id sequence parity
- pagination boundary behavior on a non-empty result set
- symbol filter parity on non-empty rows
- side filter parity on non-empty rows

### 3.2 Current observed outcome class

The current observed comparison outcome is:

- `comparison_attempted = true`
- `comparison_status = "matched"`

For this checkpoint, the important negative observations are also explicit:

- not `query_failure`
- not `mismatch`

That means the current local evidence is no longer merely structural. It now includes bounded successful parity outcomes over non-empty returned trade rows.

### 3.3 Ordering and id parity observations

The current matched request set gives bounded evidence that:

- ordered page-local id sequences matched
- legacy and PG comparison results agreed on non-empty page membership
- the current request shapes did not surface count drift
- the current request shapes did not surface ordering drift

This does not prove global ordering correctness for all future request shapes. It does prove that the currently sampled non-empty shapes did not expose ordering or id-sequence divergence.

### 3.4 Filter and pagination coverage gained at this checkpoint

This checkpoint now provides bounded non-empty evidence for:

- default list behavior
- first-page pagination reduction via `page_size=1`
- next-page pagination via `page=2&page_size=1`
- symbol filter behavior
- side filter behavior

This is the first clearly reviewable point in the trades-list line where non-empty parity evidence exists across multiple request-shape categories rather than only on empty-result responses.

## 4. Remaining Explicit Limitations

The current state is stronger than before, but it still remains bounded in several important ways.

### 4.1 Still trades-list only

This evidence says nothing about:

- cash-ledger list parity
- corporate-actions list parity
- replay-input semantics
- snapshot-cache semantics

### 4.2 Still comparison-only

The current evidence does not change the runtime posture:

- legacy still serves
- PG still does not serve
- mismatch or query failure handling remains diagnostic-only

### 4.3 Still not PG serving readiness by default

This checkpoint is stronger evidence for future discussion, not proof that PG serving should begin.

The current evidence remains bounded to:

- one local environment
- one allowlisted account
- one small manual seed dataset
- a limited non-empty request window

That is enough to strengthen trust. It is not enough to imply production-like serving confidence.

### 4.4 Still limited account scope

The current non-empty evidence is still bounded to `account_id=1`.

That means this checkpoint does not yet prove:

- broader allowlist coverage
- parity across varied account histories
- parity across more diverse real-world trade datasets

### 4.5 Still limited evidence window

The current review remains limited by the bounded evidence collection model:

- collection is in-process
- history is not durable
- the evidence window is still small
- the reviewed request set is intentionally narrow

This is acceptable for the current stage. It remains an explicit limitation for any later serving-mode discussion.

## 5. Review Conclusion Against The Current Acceptance Line

### 5.1 What now exists that did not exist before

Compared with the earlier acceptance-evidence review, the current line now has materially stronger evidence:

- the PG comparison source is available
- non-empty manual trade data exists
- comparison attempts now run over non-empty result sets
- multiple bounded request shapes now match cleanly
- the earlier false `created_at` drift no longer pollutes parity review

This is the first checkpoint where the bounded trades-list comparison-only candidate has both:

- real PG-backed comparison execution
- real non-empty matched evidence

### 5.2 What this changes

This checkpoint strengthens the candidate in two specific ways:

- it raises confidence that the bounded trades-list comparison path can compare real returned rows rather than only empty responses
- it reduces the likelihood that the current candidate is blocked by an obvious projection or formatting mismatch in the currently sampled request shapes

### 5.3 What this does not change

This checkpoint does not change the following conclusions:

- PG serving remains out of scope
- legacy remains the only serving authority
- the candidate remains bounded to trades-list only
- evidence remains intentionally narrow and locally sampled
- broader serving-mode discussion still requires more reviewable evidence than this checkpoint alone provides

## 6. Recommended Next Bounded Move

The single highest-ROI next move is:

- expand bounded comparison evidence collection from the current single-account, tiny-manual-seed checkpoint into a slightly wider but still allowlisted non-empty sampling window, then produce an updated evidence summary and promotion-readiness review from the collected reports

That is the correct next move because the current blocker is no longer structural plumbing or obvious payload drift. The current remaining gap is evidence breadth:

- more repeated non-empty samples
- more request repetition across the same bounded shapes
- ideally one or more additional allowlisted accounts when safely available

That remains conservative, keeps the line comparison-only, and avoids prematurely treating this checkpoint as implicit approval for PG serving.

## 7. Final Verdict

The bounded trades-list comparison-only candidate is now materially stronger than it was in the prior acceptance-evidence review.

The current checkpoint proves:

- real PG-backed comparison is working locally
- non-empty bounded request shapes can match cleanly
- earlier availability and formatting-drift blockers were real and are now resolved

The current checkpoint does not prove:

- PG serving readiness
- broad account coverage
- broad request-shape coverage
- broader Phase F cutover readiness

The correct conclusion is:

- the trades-list comparison-only line has now moved from thin structural evidence into bounded non-empty matched evidence
- the next step should still be additional bounded evidence collection and review, not PG serving
