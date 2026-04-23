# Phase F Corporate-Actions Comparison-Only Boundary And Feasibility Review

## Goal

Determine whether corporate-actions is the next safe bounded portfolio read-path candidate for Phase F comparison-only work after the accepted trades-list and cash-ledger checkpoints, without implementing PostgreSQL serving or changing legacy runtime behavior.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL-backed runtime reads for `GET /api/v1/portfolio/corporate-actions`.

## Status Of This Document

This review builds on the current accepted Phase F portfolio comparison-only baseline:

- [phase-f-portfolio-comparison-only-status-index-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-portfolio-comparison-only-status-index-2026-04-21.md)
- [phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)
- [phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md)
- [phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md)

Code anchors used for this review:

- [portfolio.py](/Users/yehengli/daily_stock_analysis/api/v1/endpoints/portfolio.py)
- [portfolio.py](/Users/yehengli/daily_stock_analysis/api/v1/schemas/portfolio.py)
- [portfolio_service.py](/Users/yehengli/daily_stock_analysis/src/services/portfolio_service.py)
- [portfolio_repo.py](/Users/yehengli/daily_stock_analysis/src/repositories/portfolio_repo.py)
- [storage.py](/Users/yehengli/daily_stock_analysis/src/storage.py)
- [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis/src/postgres_phase_f.py)
- [test_postgres_phase_f.py](/Users/yehengli/daily_stock_analysis/tests/test_postgres_phase_f.py)
- [test_postgres_phase_f_real_pg.py](/Users/yehengli/daily_stock_analysis/tests/test_postgres_phase_f_real_pg.py)

## 1. Current Phase F Baseline Relevant To This Choice

The current accepted reviewer posture is already narrow and should stay narrow:

- legacy remains the only serving source
- PostgreSQL remains comparison-only on the validated portfolio list lines
- this is not PG serving readiness
- this is not broader cutover readiness
- database migration completion has not been reached

Within that posture:

- trades-list already has a non-empty bounded clean-match checkpoint
- cash-ledger already has a bounded non-empty real-PG evidence checkpoint

That means the next candidate should not restart from first principles and should not jump to replay, snapshot, or serving work.

## 2. Candidate Selected

The recommended next bounded Phase F portfolio read-path candidate is:

- `GET /api/v1/portfolio/corporate-actions`

Exact current path:

- endpoint: `list_corporate_actions(...)`
- service path: `PortfolioService.list_corporate_action_events(...)`
- legacy read source: `PortfolioRepo.query_corporate_actions(...)`
- response schema: `PortfolioCorporateActionListResponse`

This remains a read-only list boundary.

## 3. Why This Is The Best Next Bounded Move

### 3.1 Same family as the two validated lines

Corporate-actions belongs to the same event-history list family as trades-list and cash-ledger:

- paginated list endpoint
- account-scoped read path
- request-local filters
- small response envelope
- no replay semantics required for the list contract

That makes it a natural continuation of the already-proven comparison-only pattern rather than a branch into a different Phase F lane.

### 3.2 Existing PG-side foundation already exists

Corporate-actions is not starting from zero on the Phase F side.

Current code already projects corporate-action rows into the Phase F ledger shadow through `entry_type="corporate_action"` in [postgres_phase_f.py](/Users/yehengli/daily_stock_analysis/src/postgres_phase_f.py), with payload fields including:

- legacy row id
- action type
- symbol
- market
- currency
- cash dividend per share
- split ratio
- note

That means the upstream PG shadow foundation already exists, even though there is not yet a dedicated comparison-only list candidate loader for this line.

### 3.3 Lower complexity than broader alternatives

Corporate-actions is still materially smaller than snapshot/replay work because it avoids:

- replay-time event folding
- position math
- valuation dependencies
- snapshot freshness semantics
- multi-account aggregate semantics

It is also more relevant than metadata surfaces such as accounts or broker-connections for this specific Phase F lane, because those paths already sit in a metadata authority / trusted-PG bridge track rather than the comparison-only event-history list track.

### 3.4 Better next move than alternatives

Relative to likely alternatives:

- better than `portfolio snapshot`
  - snapshot is replay- and cache-adjacent, so it violates the current bounded-selection discipline
- better than `accounts` or `broker-connections`
  - those are not the next comparison-only list candidate because they already have separate metadata-authority behavior and are not the same runtime migration shape as trades-list and cash-ledger
- better than generic event-history infrastructure
  - generic infrastructure would broaden scope without first proving the next concrete list line

## 4. Exact In-Scope Comparison Boundary

### 4.1 Candidate boundary

The bounded candidate surface is:

- endpoint: `GET /api/v1/portfolio/corporate-actions`
- service path: `PortfolioService.list_corporate_action_events(...)`
- current legacy read source: `PortfolioRepo.query_corporate_actions(...)`
- future comparison source shape: a PG-backed list candidate derived from Phase F ledger shadow rows where `entry_type="corporate_action"`

### 4.2 What is inside scope

Inside this candidate boundary:

- account-scoped paginated corporate-action listing
- `date_from` / `date_to` filtering on `effective_date`
- `symbol` filtering
- `action_type` filtering
- owner/account scoping
- response envelope parity:
  - `items`
  - `total`
  - `page`
  - `page_size`

### 4.3 What remains explicitly outside scope

Outside this candidate boundary:

- `record_corporate_action(...)`
- `delete_corporate_action_event(...)`
- replay-time corporate-action consumption
- `_replay_account(...)`
- position rebuild semantics
- snapshot-cache semantics
- replay-input authority
- any PG serving behavior
- any repo-wide generic comparison framework

This keeps the candidate comparison-only and read-path only.

## 5. Likely Parity Dimensions

### 5.1 Request-shape parity

The current list contract requires parity for:

- `account_id`
- `date_from`
- `date_to`
- normalized `symbol`
- normalized `action_type`
- `page`
- `page_size`

### 5.2 Response-shape parity

The current response payload requires parity for:

- `id`
- `account_id`
- `symbol`
- `market`
- `currency`
- `effective_date`
- `action_type`
- `cash_dividend_per_share`
- `split_ratio`
- `note`
- `created_at`
- `total`
- `page`
- `page_size`

### 5.3 Ordering and pagination parity

The current legacy list contract requires:

- ordering by `effective_date desc, id desc`
- page-local id sequence parity
- exact total-count parity
- exact page item count parity
- exact offset/limit semantics

### 5.4 Owner/account scope parity

The current service and repo path also require:

- `_require_active_account(account_id)` behavior to remain unchanged
- owner scoping through `PortfolioAccount.owner_id`
- no cross-account leakage
- no cross-owner leakage

## 6. Likely Mismatch Classes

If a bounded comparison-only implementation is pursued later, the most likely mismatch classes are:

- `request_shape_mismatch`
  - request context normalized differently between legacy and PG candidate paths
- `count_mismatch`
  - total rows diverge after filtering
- `pagination_mismatch`
  - page-local row count diverges
- `ordering_mismatch`
  - ordered legacy row ids diverge from ordered PG candidate row ids
- `payload_field_mismatch`
  - one or more contract-visible fields differ for the same logical row
- `query_failure`
  - PG comparison candidate source is unavailable or query construction fails

The most plausible field-level false-mismatch risks are:

- `created_at`
  - likely timezone/format normalization drift, similar to the already-settled trades-list false mismatch class
- `cash_dividend_per_share`
  - decimal serialization or nullability drift
- `split_ratio`
  - decimal serialization or nullability drift
- `action_type`
  - legacy-vs-shadow normalization drift if not kept byte-for-byte aligned

## 7. Fallback / Rollback Posture

The correct posture for this candidate remains conservative:

- legacy remains the only serving source
- PG remains comparison-only
- mismatch or query failure must stay diagnostic-only
- request-local fallback must remain legacy-served behavior
- there is no serving cutover in this pass

If comparison is eventually added, the safe rollout shape should match the established pattern from trades-list and cash-ledger:

- config-gated
- allowlist-bounded
- request-local diagnostics
- bounded evidence collection
- no public contract changes

This is still not PG serving readiness.

## 8. Why Not The Other Nearby Candidates

### 8.1 Not portfolio snapshot

`GET /api/v1/portfolio/snapshot` is not the best next move because it is replay- and snapshot-adjacent by design. It brings in:

- replay semantics
- valuation semantics
- snapshot freshness
- broader authority prerequisites already called out in current tests

That is outside the current conservative comparison-only lane.

### 8.2 Not accounts or broker-connections

`GET /api/v1/portfolio/accounts` and `GET /api/v1/portfolio/broker-connections` are not the best next move because they already live on a different Phase F path:

- they use metadata-authority/trusted-PG reads when authority is acceptable
- they are not the next unresolved comparison-only event-history list line

Those paths therefore do not provide the cleanest continuation of the current trades-list -> cash-ledger comparison-only progression.

### 8.3 Not broader event-history cutover work

A generic event-history layer or serving-mode move would overstep the current checkpoint because:

- it broadens scope before the next concrete list line is proven
- it weakens reviewer clarity
- it mixes candidate selection with architecture expansion

## 9. Smallest Realistic Docs-First Next Step

The smallest realistic next step after this review is:

- one bounded corporate-actions comparison-only scaffolding/design doc

That follow-up should stay narrow:

- define the exact request context and candidate payload shape
- define the minimum report/diagnostic vocabulary
- define the minimum allowlist/config boundary
- define the smallest useful evidence window

It should not:

- implement runtime behavior
- add PG serving
- broaden into replay or snapshot work
- invent repo-wide generic comparison infrastructure

## 10. Reviewer Conclusion

Corporate-actions is the best next bounded Phase F portfolio read-path candidate after trades-list and cash-ledger because:

- it is in the same event-history list family
- its public contract is stable and small
- its filter surface is limited and reviewable
- existing Phase F ledger shadow data already includes corporate-action rows
- it avoids replay/snapshot complexity
- it preserves the current conservative comparison-only posture

That makes it the strongest next docs-first comparison-only candidate.
