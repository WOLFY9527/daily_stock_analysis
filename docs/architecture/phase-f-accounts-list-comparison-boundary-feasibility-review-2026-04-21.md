# Phase F Accounts-List Comparison-Only Boundary And Feasibility Review

## Goal

Determine whether `GET /api/v1/portfolio/accounts` is the next safe bounded portfolio read-path candidate for a docs-first Phase F review after the accepted trades-list, cash-ledger, and corporate-actions checkpoints, without implementing PostgreSQL serving or changing legacy runtime behavior.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL-backed runtime serving for `GET /api/v1/portfolio/accounts`.

## Status Of This Document

This review builds on the current accepted Phase F portfolio comparison-only baseline:

- [phase-f-portfolio-comparison-only-status-index-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-portfolio-comparison-only-status-index-2026-04-21.md)
- [phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)
- [phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md)
- [phase-f-corporate-actions-non-empty-acceptance-evidence-review-2026-04-21.md](/Users/yehengli/daily_stock_analysis/docs/architecture/phase-f-corporate-actions-non-empty-acceptance-evidence-review-2026-04-21.md)

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

- legacy remains the only serving source on the validated comparison-only list lines
- PostgreSQL remains comparison-only on those validated lines
- this is not PG serving readiness
- this is not broader cutover readiness
- overall database migration completion has not been reached

Within that posture:

- trades-list already has a non-empty bounded clean-match checkpoint
- cash-ledger already has a bounded non-empty real-PG evidence checkpoint
- corporate-actions already has a bounded non-empty real-PG evidence checkpoint

That means the next candidate should not reopen the event-history list lines, should not jump to snapshot or replay work, and should not broaden into serving-mode redesign.

## 2. Candidate Selected

The recommended next bounded Phase F portfolio read-path candidate is:

- `GET /api/v1/portfolio/accounts`

Exact current path:

- endpoint: `list_accounts(...)`
- service path: `PortfolioService.list_accounts(...)`
- current legacy read source: `PortfolioRepo.list_accounts(...)`
- response schema: `PortfolioAccountListResponse`

This remains a read-only account-metadata list boundary.

## 3. Why This Is The Best Next Bounded Move

### 3.1 Smallest remaining portfolio API read surface

Among the remaining portfolio API read paths, accounts-list is the smallest stable surface:

- flat list response
- no pagination
- one simple filter: `include_inactive`
- no nested positions, cash balances, or event payloads
- no replay semantics
- no valuation semantics

That makes it materially smaller than snapshot- or risk-adjacent work.

### 3.2 Cleaner evidence matrix than nearby alternatives

The bounded request matrix for accounts-list is naturally tiny:

- default active-only list
- `include_inactive=true`
- owner isolation over one user scope

That is more evidence-friendly than nearby alternatives:

- better than `GET /api/v1/portfolio/broker-connections`
  - broker-connections has more filters, more fields, account-name enrichment, and more metadata drift surface
- better than `PortfolioService.get_latest_broker_sync_state(...)`
  - latest-sync overlay has nested positions and cash balances plus freshness/overlay semantics
- better than `GET /api/v1/portfolio/snapshot`
  - snapshot is replay-, valuation-, and cache-adjacent
- better than `GET /api/v1/portfolio/risk`
  - risk depends on snapshot semantics and derived calculations

### 3.3 Still close enough to the core portfolio boundary to matter

Accounts-list is not an incidental utility endpoint. It is foundational portfolio metadata:

- account identity
- market/base currency
- active/inactive visibility
- owner scope

That means a reviewer can still learn something useful about the remaining bounded read-path surface without broadening into replay, snapshot, or serving work.

### 3.4 Important caveat: this is metadata-authority-adjacent, not another event-history list line

Accounts-list is not a clean copy of the trades-list / cash-ledger / corporate-actions comparison pattern.

Current tests already show that:

- trusted Phase F metadata can satisfy the read path without hitting the legacy repo
- the service falls back when metadata authority drifts

That means this candidate should be treated as the smallest remaining portfolio read boundary for docs-first review, not as justification to reopen serving-mode discussion or build generic comparison infrastructure.

## 4. Exact In-Scope Comparison Boundary

### 4.1 Candidate boundary

The bounded candidate surface is:

- endpoint: `GET /api/v1/portfolio/accounts`
- service path: `PortfolioService.list_accounts(include_inactive=...)`
- current legacy read source: `PortfolioRepo.list_accounts(...)`
- current Phase F metadata shadow surface: `PhaseFPortfolioAccount` rows exercised through the existing service path and fallback behavior

### 4.2 What is inside scope

Inside this candidate boundary:

- owner-scoped account listing
- `include_inactive=false`
- `include_inactive=true`
- response envelope parity:
  - `accounts`
- ordered row membership parity
- account metadata field parity

### 4.3 What remains explicitly outside scope

Outside this candidate boundary:

- `create_account(...)`
- `update_account(...)`
- `deactivate_account(...)`
- broker-connections
- latest sync overlay
- trades-list / cash-ledger / corporate-actions
- snapshot / replay / valuation logic
- risk report calculations
- any PG serving rollout
- any repo-wide generic comparison framework

This keeps the candidate read-path only and tightly bounded.

## 5. Likely Parity Dimensions

### 5.1 Request-shape parity

The current list contract requires parity for:

- owner scope
- `include_inactive`

### 5.2 Response-shape parity

The current response payload requires parity for:

- `id`
- `owner_id`
- `name`
- `broker`
- `market`
- `base_currency`
- `is_active`
- `created_at`
- `updated_at`

### 5.3 Ordering and membership parity

The current legacy list contract requires:

- ordering by `id asc`
- exact row membership parity for active-only listing
- exact row membership parity when inactive accounts are included

## 6. Likely Mismatch Classes

If a bounded Phase F review is pursued later, the most likely mismatch classes are:

- `visibility_mismatch`
  - `include_inactive` behavior diverges between legacy and shadow-backed reads
- `count_mismatch`
  - total returned account rows diverge for the same owner scope
- `ordering_mismatch`
  - ascending id order diverges
- `payload_field_mismatch`
  - one or more account metadata fields diverge
- `owner_scope_mismatch`
  - rows from another owner scope leak into the result
- `authority_drift`
  - shadow-backed metadata is no longer trusted and the service must fall back

## 7. Fallback / Rollback Posture

The fallback posture for this candidate must stay conservative:

- preserve the current service-owned fallback to legacy behavior when metadata authority drifts
- do not add PG serving rollout controls in this pass
- do not redesign the current metadata-authority bridge
- do not generalize this into repo-wide comparison infrastructure

If future reviewer work finds that accounts-list does not fit the comparison-only framing cleanly, the correct rollback is:

- stop at the documentation boundary
- keep current runtime behavior unchanged
- record that this surface belongs to the metadata-authority track rather than the event-history comparison track

## 8. Smallest Realistic Docs-First Next Step

If this candidate is pursued later, the smallest realistic next step is:

- one narrow reviewer-facing boundary/design note for accounts-list that explicitly answers whether the line should be treated as:
  - a tiny metadata parity review surface
  - or a surface that should remain under the existing metadata-authority / drift-fallback track without new comparison work

That follow-up should stay bounded to:

- `include_inactive=false`
- `include_inactive=true`
- owner-scope isolation
- no runtime behavior changes

## 9. Final Feasibility Conclusion

For the remaining portfolio read-path surface, `GET /api/v1/portfolio/accounts` is the best next bounded candidate because it is:

- read-path only
- small payload
- limited filters
- stable contract
- evidence-friendly
- materially narrower than broker-connections, latest-sync overlay, snapshot, or risk

It is also a qualified candidate:

- it is metadata-authority-adjacent rather than another clean event-history comparison line
- it should therefore be approached as a docs-first reviewer checkpoint, not as PG serving work
- it should not be used to justify replay expansion, snapshot expansion, or broader cutover discussion
