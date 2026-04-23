# Phase F Cash-Ledger Comparison-Only Boundary And Feasibility Review

## Goal

Determine whether cash-ledger is the next safe bounded comparison-only candidate after the current trades-list checkpoint, without implementing PostgreSQL serving or changing legacy runtime behavior.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL-backed runtime reads for `GET /api/v1/portfolio/cash-ledger`.

## Status Of This Document

This review builds on the current Phase F bounded event-history and trades-list baseline:

- [phase-f-event-history-cutover-boundary-design-2026-04-20.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-event-history-cutover-boundary-design-2026-04-20.md)
- [phase-f-event-history-consumer-parity-inventory-2026-04-20.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-event-history-consumer-parity-inventory-2026-04-20.md)
- [phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis_backend/docs/architecture/phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)

Code anchors used for this review:

- [portfolio.py](/Users/yehengli/daily_stock_analysis_backend/api/v1/endpoints/portfolio.py)
- [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py)
- [portfolio_repo.py](/Users/yehengli/daily_stock_analysis_backend/src/repositories/portfolio_repo.py)
- [portfolio.py](/Users/yehengli/daily_stock_analysis_backend/api/v1/schemas/portfolio.py)
- [storage.py](/Users/yehengli/daily_stock_analysis_backend/src/storage.py)
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/src/postgres_phase_f.py)
- [test_postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/tests/test_postgres_phase_f.py)

## 1. Current Trades-List Checkpoint Summary

The current trades-list line has already reached a materially stronger checkpoint:

- PG-backed comparison source is available
- bounded allowlist comparison works
- empty-result matches were verified
- non-empty bounded matches were verified
- false `created_at` formatting drift was fixed in comparison normalization
- the latest acceptance-evidence review is based on real non-empty matched request shapes

That matters for this review because it changes the decision standard.

The next candidate does not need to start from first principles anymore. It can be judged against a now-proven pattern:

- bounded list endpoint only
- service-owned comparison boundary
- legacy still serving
- PG comparison source only
- request-local fallback
- bounded diagnostics and evidence review

## 2. Exact Bounded Cash-Ledger Candidate Surface

### 2.1 Candidate boundary

The bounded cash-ledger candidate surface is:

- endpoint: `GET /api/v1/portfolio/cash-ledger`
- service path: `PortfolioService.list_cash_ledger_events(...)`
- current legacy read source: `PortfolioRepo.query_cash_ledger(...)`
- future comparison source shape: a PG-backed equivalent of `query_cash_ledger(...)`

This remains a read-only list boundary.

### 2.2 What is inside the candidate boundary

Inside the candidate boundary:

- account-scoped paginated cash-ledger listing
- `date_from` / `date_to` filtering
- `direction` filtering
- owner/account scoping
- response envelope parity:
  - `items`
  - `total`
  - `page`
  - `page_size`

### 2.3 What remains explicitly outside

Outside the candidate boundary:

- `record_cash_ledger(...)`
- `delete_cash_ledger_event(...)`
- replay-style `list_cash_ledger(account_id, as_of=...)`
- `_replay_account(...)`
- snapshot-cache semantics
- replay-input semantics
- all PG serving behavior

The same separation rule used for trades-list still applies: list-query comparison is not replay cutover.

## 3. Consumer Path Inventory

### 3.1 Production consumer path

The current production path is narrowly concentrated:

- endpoint: [portfolio.py](/Users/yehengli/daily_stock_analysis_backend/api/v1/endpoints/portfolio.py) `list_cash_ledger(...)`
- service: [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py) `list_cash_ledger_events(...)`
- repo: [portfolio_repo.py](/Users/yehengli/daily_stock_analysis_backend/src/repositories/portfolio_repo.py) `query_cash_ledger(...)`
- response schema: [portfolio.py](/Users/yehengli/daily_stock_analysis_backend/api/v1/schemas/portfolio.py) `PortfolioCashLedgerListResponse`

That is a good boundary shape because the runtime consumer surface is small and explicit.

### 3.2 Replay-adjacent path that must remain outside

The replay-adjacent cash path is separate in current code:

- [portfolio_repo.py](/Users/yehengli/daily_stock_analysis_backend/src/repositories/portfolio_repo.py) `list_cash_ledger(...)`
- `list_cash_ledger_in_session(...)`
- [portfolio_service.py](/Users/yehengli/daily_stock_analysis_backend/src/services/portfolio_service.py) `_replay_account(...)`

This path uses `as_of` semantics and ascending historical ordering:

- `event_date asc, id asc`

That is structurally different from the user-facing list query, which uses:

- `event_date desc, id desc`

This separation is important because it means a cash-ledger comparison-only candidate can stay bounded to the list query without pulling replay semantics into scope.

### 3.3 Existing Phase F PG-side foundation

Cash-ledger is not starting from zero on the Phase F side.

Current code already projects cash-ledger rows into the Phase F ledger shadow:

- [storage.py](/Users/yehengli/daily_stock_analysis_backend/src/storage.py) `_phase_f_projection_cash_ledger_row(...)`
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis_backend/src/postgres_phase_f.py) Phase F ledger shadow bootstrap for `entry_type="cash"`

Projected cash-ledger fields already include:

- legacy row id
- direction
- amount
- currency
- note
- created_at

This means the upstream data foundation for a bounded cash-ledger comparison source already exists in principle.

### 3.4 Important current implementation gap

What does not exist yet is the trades-like comparison path for cash-ledger.

Current code has trades-only comparison-specific wiring:

- `DatabaseManager.get_phase_f_trade_list_comparison_candidate(...)`
- `PostgresPhaseFStore.query_trade_list_comparison_candidate(...)`
- service-owned comparison/reporting helpers in `PortfolioService`

There is no corresponding cash-ledger-specific comparison source or service-owned comparison path yet.

That is the main implementation gap, but it is not a feasibility blocker. It only means cash-ledger is a candidate for the next bounded comparison-only line, not a candidate ready for immediate serving discussion.

## 4. Likely Parity Dimensions

### 4.1 Request-shape parity

The current cash-ledger list contract requires parity for:

- `account_id`
- `date_from`
- `date_to`
- normalized `direction`
- `page`
- `page_size`

### 4.2 Response-shape parity

The current response payload requires parity for:

- `id`
- `account_id`
- `event_date`
- `direction`
- `amount`
- `currency`
- `note`
- `created_at`
- `total`
- `page`
- `page_size`

### 4.3 Ordering and pagination parity

The current legacy list contract requires:

- ordering by `event_date desc, id desc`
- page-local id sequence parity
- exact count parity
- exact page item count parity
- exact offset/limit semantics

### 4.4 Owner/account scope parity

The current service and repo path also require:

- `_require_active_account(account_id)` behavior to remain unchanged
- owner scoping via `PortfolioAccount.owner_id`
- no cross-account leakage
- no cross-owner leakage

## 5. Likely Blockers And Risks

### 5.1 Why cash-ledger is simpler than trades-list

Cash-ledger parity is likely simpler than trades-list parity for several concrete reasons:

- fewer filters
  - no `symbol`
  - no `market`
  - no `side` vs canonical symbol interaction
- smaller payload surface
  - no `trade_uid`
  - no quantity/price/fee/tax fields
- no trade-specific business shape around buy/sell semantics
- no contract-visible symbol canonicalization path

That makes cash-ledger a lower-complexity list-parity candidate than trades-list.

### 5.2 Why cash-ledger is not zero-risk

Cash-ledger still has several bounded risks:

- `created_at` can likely repeat the same timezone-format-only drift pattern already seen on trades-list
- `amount` may need careful normalization if SQLite vs PG serialization differs
- `direction` normalization must match the current service contract exactly
- `event_date` is projected into ledger `event_time`, so date-to-datetime conversion must not introduce ordering or filter drift

These are manageable comparison risks, not replay-grade semantic blockers.

### 5.3 Main practical blocker

The main blocker is not conceptual parity complexity.

The main blocker is missing cash-ledger-specific comparison scaffolding:

- no cash-ledger comparison enable/toggle shape
- no cash-ledger service-owned comparison hook
- no PG-backed `query_cash_ledger` comparison source
- no cash-ledger mismatch report builder
- no cash-ledger evidence summary/review layer

That means cash-ledger is feasible, but not yet on the same operational footing as the current trades-list line.

### 5.4 Additional scope-discipline risk

There is also a process risk:

- cash-ledger should not inherit broad generic comparison infrastructure too early

The successful trades-list pattern was deliberately narrow and service-owned. Cash-ledger should follow that same bounded pattern rather than triggering a repo-global or event-history-global redesign.

## 6. Whether Cash-Ledger Is The Right Next Bounded Candidate

### 6.1 Feasibility conclusion

Yes. Cash-ledger is the right next bounded comparison-only candidate after trades-list.

### 6.2 Why this is the right next candidate

Cash-ledger is the strongest next candidate because:

- the runtime surface is already narrow and explicit
- replay-adjacent reads are already separated from the list query path
- Phase F ledger projection for cash rows already exists
- the list payload and filter surface are simpler than trades-list
- the successful trades-list comparison-only pattern can be reused without widening into serving mode

### 6.3 Why not corporate-actions first

Corporate-actions is a weaker next candidate because it has more branchy contract shape:

- symbol/market fields
- action-type filtering
- nullable dividend vs split payload branches
- action-type-specific payload semantics

That makes it a less conservative next move than cash-ledger.

### 6.4 Important limit on this conclusion

This conclusion is intentionally narrow.

It does not mean:

- cash-ledger is ready for PG serving
- cash-ledger comparison should be implemented broadly
- the event-history boundary should now expand across all remaining endpoints at once

It only means cash-ledger is the next highest-ROI bounded comparison-only candidate.

## 7. Recommended Next Bounded Move

The single best next bounded move is:

- a docs-first cash-ledger guarded comparison design and scaffolding plan for `GET /api/v1/portfolio/cash-ledger` only

That next pass should define:

- exact comparison ownership in or adjacent to `PortfolioService.list_cash_ledger_events(...)`
- exact PG-backed comparison-source shape for `query_cash_ledger(...)`
- exact mismatch classes for counts, ordering, pagination, filters, owner scope, payload fields, and query failure
- exact fallback and rollback posture with legacy still serving
- the smallest implementation slice for cash-ledger comparison scaffolding, still comparison-only

That is the correct next move because the current question is no longer whether cash-ledger is a plausible candidate. The current question is how to start it conservatively without broadening beyond the pattern that worked for trades-list.

## 8. Final Verdict

Cash-ledger is the next safe bounded comparison-only candidate after the current trades-list checkpoint.

The main reasons are:

- bounded read surface
- clear separation from replay-style reads
- existing Phase F cash-ledger projection foundation
- simpler parity surface than trades-list

The main caution is:

- the comparison-specific wiring, diagnostics, and evidence path do not exist yet for cash-ledger

So the correct conclusion is:

- yes to cash-ledger as the next bounded candidate
- no to immediate implementation without a cash-ledger-specific comparison design/scaffolding pass
- no to any serving-mode implication from this review
