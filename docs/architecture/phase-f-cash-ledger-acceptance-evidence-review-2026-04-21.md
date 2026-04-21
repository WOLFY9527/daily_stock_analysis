# Phase F Cash-Ledger Acceptance-Evidence Review

## Goal

Document the current reviewer-facing acceptance posture for the cash-ledger comparison-only line after the comparison path, bounded diagnostics, collector, and compact evidence summary helper have already landed.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL serving for `GET /api/v1/portfolio/cash-ledger`.

## Status Of This Document

This review builds on the current cash-ledger and trades-list comparison-only baseline:

- [phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md)
- [phase-f-cash-ledger-guarded-comparison-design-scaffolding-plan-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-guarded-comparison-design-scaffolding-plan-2026-04-21.md)
- [phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md)
- [phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)

Code anchors used for this review:

- [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py)
- [storage.py](/Users/yehengli/daily_stock_analysis_backend/src/storage.py)
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/src/postgres_phase_f.py)
- [test_postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/tests/test_postgres_phase_f.py)

## 1. Current Implementation Maturity

### 1.1 Exact bounded candidate boundary

The current candidate remains strictly bounded to:

- endpoint: `GET /api/v1/portfolio/cash-ledger`
- service path: `PortfolioService.list_cash_ledger_events(...)`
- legacy serving source: `PortfolioRepository.query_cash_ledger(...)`
- PG comparison source: `DatabaseManager.get_phase_f_cash_ledger_comparison_candidate(...)`
- PG comparison query implementation: `PostgresPhaseFStore.query_cash_ledger_comparison_candidate(...)`

Everything else remains outside this review:

- PG serving
- replay-style cash semantics
- snapshot-cache work
- write-path migration
- repo-global evidence infrastructure

### 1.2 What is already implemented

Cash-ledger is materially past scaffold-only state.

The current implementation already has:

- a real PG-backed comparison candidate loader
- a service-owned comparison hook behind `ENABLE_PHASE_F_CASH_LEDGER_COMPARISON`
- bounded allowlist rollout through `PHASE_F_CASH_LEDGER_COMPARISON_ACCOUNT_IDS`
- request-local fallback with legacy always serving
- bounded mismatch classification
- comparison-time `created_at` normalization to suppress format-only false mismatches
- a structured per-request diagnostic report model
- a bounded in-process collector
- a compact evidence summary helper

### 1.3 What the current tests already prove

The cash-ledger test coverage in [test_postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/tests/test_postgres_phase_f.py) already exercises the key current states:

- comparison defaults disabled
- enabled but not allowlisted -> `skipped`
- allowlisted empty result -> `matched`
- allowlisted non-empty result -> `matched`
- PG source unavailable -> `query_failure`
- payload drift -> `mismatch`
- bounded report shape
- evidence summary aggregation and strength classification
- collector behavior and report filtering

That makes this line stronger than a design-only or scaffolding-only checkpoint.

## 2. Current Evidence Maturity

### 2.1 Why this line is stronger than scaffold-only

This line is stronger than scaffold-only for concrete reasons:

- the comparison path is not hypothetical
- the PG candidate query is not mocked into existence at architecture level only
- non-empty clean match behavior is explicitly covered
- mismatch and query-failure behavior are explicitly covered
- evidence-strength computation already exists in code
- the collector and summary helper already aggregate bounded repeated reports

Compared with a pure scaffolding checkpoint, reviewers are no longer guessing whether the comparison surface exists. They can inspect actual implemented report fields, summary fields, and covered outcome classes.

### 2.2 Current evidence maturity level

The current evidence maturity is best described as:

- structurally real
- comparison-only
- reviewer-usable
- stronger than empty scaffolding
- still bounded and intentionally conservative

The current line is strong enough for a bounded comparison-only acceptance checkpoint because it already supports:

- real matched outcomes
- real mismatch reporting
- real query-failure reporting
- real allowlist skip behavior
- real evidence summary interpretation

### 2.3 What the current evidence does not yet prove by itself

The current evidence does not, by itself, prove:

- broad real-world account coverage
- durable multi-process evidence history
- serving-mode readiness
- replay parity
- snapshot parity
- write-path migration readiness

## 3. Why This Is Still Not PG Serving Readiness

### 3.1 Legacy is still the only serving authority

Today:

- legacy always serves
- PG never serves
- mismatch and query failure are diagnostic only

That is the correct current posture. It should not be reframed as latent PG serving readiness.

### 3.2 The current controls are comparison-only controls

The current controls are:

- `ENABLE_PHASE_F_CASH_LEDGER_COMPARISON`
- `PHASE_F_CASH_LEDGER_COMPARISON_ACCOUNT_IDS`

These controls govern whether bounded comparison happens. They are not PG serving controls, and they do not provide a separate serving rollback switch because serving mode does not exist here.

### 3.3 The evidence surface is still narrow and in-process

The current collector is in-process only.

That means the current line still lacks:

- durable cross-process evidence history
- persisted reviewer snapshots
- longitudinal counters across restarts

Those are acceptable limitations for a comparison-only checkpoint. They are not compatible with overclaiming serving readiness.

### 3.4 The candidate boundary is intentionally small

This review covers only the user-facing list query.

It does not cover:

- replay-style `as_of` cash reads
- `_replay_account(...)`
- snapshot-cache semantics
- any broader event-history takeover

That boundary discipline is a strength for this phase, but it is also why this checkpoint cannot be described as broader PG readiness.

## 4. Acceptance Boundary For The Current Phase

### 4.1 What this phase can legitimately accept

The current phase can legitimately accept:

- that cash-ledger now has a real comparison-only path
- that the reviewer-facing evidence surface is no longer materially behind the implementation
- that bounded comparison evidence can now be collected and summarized with explicit status vocabulary
- that non-empty clean-match evidence is a valid target for the current phase

### 4.2 What counts as sufficient evidence for a bounded comparison-only checkpoint

Grounded in the current report and summary fields, a sufficient evidence set for the current phase should include:

- a tiny allowlisted account set
- actual comparison attempts, not only skips
- at least one non-empty matched sample
- no hard-blocking mismatch or query-failure outcomes in the reviewed sample window
- complete sampling coverage for the intended allowlisted review set
- legacy remaining the only serving source throughout

This is a reviewer conclusion derived from the existing evidence helper fields such as:

- `evidence_strength`
- `evidence_is_thin`
- `hard_blocking_issue_observed`
- `uncovered_allowlisted_account_ids`
- `matched_non_empty_reports`

### 4.3 What is not sufficient for this checkpoint

The following are not sufficient by themselves:

- `skipped` reports only
- `empty_only` evidence only
- one-off matched anecdotes without a bounded review set
- evidence windows that still include unresolved `query_failure`
- evidence windows that still include unresolved `mismatch`

## 5. Remaining Caveats

The current line still has explicit caveats:

- evidence is still bounded and local
- the collector is still in-process only
- coverage is still request-shape specific rather than broad operational coverage
- the acceptance surface is still list-query only
- no serving-specific control plane exists because serving mode remains out of scope

There is also a current discipline caveat:

- cash-ledger should not use this stronger evidence posture as justification for replay, snapshot, or broader event-history expansion in the same pass

## 6. Recommended Next Move

The next recommended move is:

- use the bounded runbook to collect a tiny real non-empty evidence window for allowlisted cash-ledger accounts, then review that evidence against the current acceptance boundary without broadening into serving discussion

This is the correct next move because the remaining gap is not missing comparison plumbing anymore. The remaining gap is reviewer-visible evidence breadth within the current bounded line.

This next step should remain:

- cash-ledger only
- comparison-only
- allowlist-bounded
- legacy-serving
- reviewer-facing

## 7. Final Verdict

Cash-ledger has now reached a reviewer-facing comparison-only checkpoint that is materially stronger than scaffold-only.

It is acceptable to treat the current line as ready for bounded evidence collection and bounded acceptance review.

It is not acceptable to treat the current line as PG serving readiness, replay readiness, snapshot readiness, or a justification for broader Phase F cutover discussion.
