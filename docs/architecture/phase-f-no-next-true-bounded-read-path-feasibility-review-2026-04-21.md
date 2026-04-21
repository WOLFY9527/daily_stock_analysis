# Phase F No-Next-True-Bounded Read-Path Feasibility Review

## Goal

Determine whether any remaining portfolio read-path surface should be selected as the next true bounded Phase F comparison-only candidate after:

- `GET /api/v1/portfolio/trades`
- `GET /api/v1/portfolio/cash-ledger`
- `GET /api/v1/portfolio/corporate-actions`
- the explicit exclusion of `GET /api/v1/portfolio/accounts` from new comparison implementation work

This document is docs-only and review-only. It does not authorize or implement PostgreSQL serving, replay expansion, snapshot expansion, or new comparison wiring.

## Current Phase F Baseline

The current accepted posture remains narrow:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on those lines
- this is not PG serving readiness
- this is not broader cutover readiness
- overall database migration is still not complete

The currently validated comparison-only lines are:

- `GET /api/v1/portfolio/trades`
- `GET /api/v1/portfolio/cash-ledger`
- `GET /api/v1/portfolio/corporate-actions`

The already-decided non-candidate is:

- `GET /api/v1/portfolio/accounts`
  - remain on the metadata-authority / drift-fallback track
  - do not proceed into new Phase F comparison implementation work

## Recommendation

No additional endpoint or service path should be selected in this pass as the next true bounded Phase F comparison-only candidate.

The conservative reviewer-facing conclusion is:

- there is no remaining true bounded portfolio read-path candidate that cleanly fits new comparison-only implementation work at this time

That conclusion is stronger and more accurate than forcing a weak selection from the remaining surfaces.

## Remaining Portfolio Read-Path Pool

After excluding the already-advanced and already-decided lines, the nearby remaining portfolio read surfaces are:

- `GET /api/v1/portfolio/broker-connections`
  - endpoint path: `api/v1/endpoints/portfolio.py`
  - service path: `PortfolioService.list_broker_connections(...)`
- latest broker sync overlay state
  - service path: `PortfolioService.get_latest_broker_sync_state(...)`
  - no separate dedicated portfolio GET endpoint in `api/v1/endpoints/portfolio.py`
- `GET /api/v1/portfolio/snapshot`
  - service path: `PortfolioService.get_portfolio_snapshot(...)`
- `GET /api/v1/portfolio/risk`
  - service path: `PortfolioRiskService.get_risk_report(...)`

None of these remaining surfaces is a clean continuation of the current bounded event-history comparison-only lane.

## Why No Remaining Surface Qualifies Cleanly

To qualify as the next true bounded candidate, the surface should satisfy most of the following:

- read-path only
- bounded surface area
- small payload surface
- limited filters
- stable contract
- comparison-only friendly
- evidence-friendly request matrix
- materially narrower than snapshot, replay, valuation, or risk work
- not a metadata-authority or trusted-overlay surface in disguise

The remaining surfaces break down into two disfavored groups:

- metadata-authority / trusted-overlay surfaces that already have a trust-and-fallback runtime posture
- broader snapshot-derived surfaces that exceed the current bounded-selection discipline

## Why `GET /api/v1/portfolio/broker-connections` Was Not Chosen

Exact current path:

- endpoint: `GET /api/v1/portfolio/broker-connections`
- service path: `PortfolioService.list_broker_connections(...)`
- legacy repo path: `PortfolioRepo.list_broker_connections(...)`

This surface was not chosen because it already behaves like a metadata-authority / trusted-PG bridge surface rather than a comparison-only event-history list surface:

- the service first attempts to read trusted Phase F broker-connection metadata rows
- the service falls back when broker-connection authority drifts
- focused tests already cover trusted metadata preference without legacy repo reads
- focused tests already cover fallback when authority drift is detected
- real-PG validation already exercises the trusted metadata-backed path

It is also not cleaner than accounts-list:

- broader metadata payload
- more enrichment behavior
- more drift surface
- more authority-state dependence

So broker-connections should remain on the metadata-authority / drift-fallback track, not be pulled into new comparison-only implementation work.

## Why Latest Sync Overlay Was Not Chosen

Exact current path:

- service path: `PortfolioService.get_latest_broker_sync_state(...)`
- legacy repo path: `PortfolioRepo.get_latest_broker_sync_state_for_account(...)` plus related sync-position and sync-cash reads

This surface was not chosen because it is even further from the validated comparison-only list pattern:

- it is an overlay surface, not an event-history list surface
- it carries nested sync-position and cash-balance structure
- it already sits inside the authority / overlay readiness model
- focused tests already cover trusted PG overlay reads without legacy repo access
- focused tests already cover controlled fallback when overlay authority drifts

This makes it an overlay-authority surface, not the next true bounded comparison-only candidate.

## Why `GET /api/v1/portfolio/snapshot` Was Not Chosen

Exact current path:

- endpoint: `GET /api/v1/portfolio/snapshot`
- service path: `PortfolioService.get_portfolio_snapshot(...)`

This surface was not chosen because it is too broad for the current Phase F lane:

- replay-adjacent
- valuation-adjacent
- cache/freshness-adjacent
- multi-account aggregation capable
- cost-method sensitive
- materially wider payload than the accepted list candidates

Selecting snapshot next would violate the current bounded comparison-only discipline and would pull the work toward replay/snapshot expansion, which is explicitly out of scope.

## Why `GET /api/v1/portfolio/risk` Was Not Chosen

Exact current path:

- endpoint: `GET /api/v1/portfolio/risk`
- service path: `PortfolioRiskService.get_risk_report(...)`

This surface was not chosen because it sits downstream of snapshot and valuation semantics:

- derived analytics rather than a direct persistence read boundary
- dependent on snapshot-like semantics
- broader than the current bounded comparison-only candidate class

Risk is therefore even less suitable than snapshot for the next conservative Phase F step.

## Fallback / Rollback Posture

The correct posture after this review is conservative:

- do not force any remaining metadata/overlay surface into new comparison scaffolding
- do not reinterpret existing authority/fallback behavior as PG serving approval
- do not promote snapshot or risk into the bounded comparison-only queue
- do not build generic infrastructure to compensate for the lack of a clean next candidate

If a future reviewer asks what should happen next, the answer should remain:

- keep current runtime behavior unchanged
- preserve the current validated comparison-only lines as the bounded Phase F evidence base
- wait for a genuinely bounded new surface before resuming comparison-only implementation work

## Smallest Realistic Docs-First Next Step

The smallest realistic next step after this review is not new implementation.

The smallest realistic next step is:

- a small coordination update, if needed, to record that no additional true bounded comparison-only candidate currently remains after the three validated event-history lines and the accounts-track decision

That is preferable to:

- forcing broker-connections into the comparison-only lane
- forcing latest-sync overlay into the comparison-only lane
- broadening into snapshot, replay, valuation, or risk work

## Reviewer Conclusion

For the current remaining portfolio read-path surface, no new true bounded comparison-only candidate should be selected in this pass.

The nearest remaining surfaces were reviewed and rejected for bounded-selection purposes:

- `GET /api/v1/portfolio/broker-connections`
  - metadata-authority / trusted-PG bridge surface
- `PortfolioService.get_latest_broker_sync_state(...)`
  - overlay-authority surface
- `GET /api/v1/portfolio/snapshot`
  - too broad and snapshot/replay-adjacent
- `GET /api/v1/portfolio/risk`
  - downstream and too broad

So the correct reviewer outcome is:

- no next true bounded comparison-only candidate is selected
- no new comparison implementation should follow from this pass
- legacy remains the only serving source on the validated lines
- PostgreSQL remains comparison-only on the validated lines
- this is not PG serving readiness
- this is not broader cutover readiness
