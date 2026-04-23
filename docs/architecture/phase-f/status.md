# Phase F Status

## Scope

This is the long-lived Phase F status entry point for the current PostgreSQL/SQLite coexistence posture.

Phase F remains:

- backend-only
- comparison-only
- legacy-served
- portfolio-read-path focused

This document is not evidence of:

- PostgreSQL serving readiness
- broader cutover readiness
- write-path migration
- replay or snapshot expansion
- migration completion

## Current Overall Posture

The accepted current posture is:

- legacy remains the only serving source
- PostgreSQL remains comparison-only on the validated lines
- PostgreSQL is still being validated primarily as a comparison source
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not migration completion

## Validated Comparison-Only Lines

### Trades-list

Accepted status:

- non-empty bounded clean match

What to carry forward:

- the old PG source-unavailable blocker is no longer active
- the old empty-only framing is no longer accurate
- bounded non-empty evidence exists
- legacy still serves every response

Primary historical references:

- [trades-list runbook](../archive/phase-f/phase-f-trades-list-evidence-collection-runbook-2026-04-20.md)
- [trades-list non-empty acceptance](../archive/phase-f/phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)

### Cash-ledger

Accepted status:

- bounded non-empty real-PG evidence checkpoint complete

What to carry forward:

- real comparison wiring exists
- bounded mismatch classification exists
- request-local diagnostics exist
- bounded non-empty real-PG evidence exists
- legacy still serves every response

Primary historical references:

- [cash-ledger boundary feasibility](../archive/phase-f/phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md)
- [cash-ledger non-empty evidence plan](../archive/phase-f/phase-f-cash-ledger-non-empty-evidence-collection-plan-2026-04-21.md)
- [cash-ledger non-empty acceptance](../archive/phase-f/phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md)

### Corporate-actions

Accepted status:

- bounded non-empty real-PG evidence checkpoint complete

What to carry forward:

- real comparison wiring exists
- bounded request-local diagnostics exist
- bounded non-empty real-PG evidence exists
- legacy still serves every response

Primary historical references:

- [corporate-actions boundary feasibility](../archive/phase-f/phase-f-corporate-actions-comparison-boundary-feasibility-review-2026-04-21.md)
- [corporate-actions non-empty evidence plan](../archive/phase-f/phase-f-corporate-actions-non-empty-evidence-collection-plan-2026-04-21.md)
- [corporate-actions non-empty acceptance](../archive/phase-f/phase-f-corporate-actions-non-empty-acceptance-evidence-review-2026-04-21.md)

## Separate-Track Surface

The most important excluded surface is:

- `GET /api/v1/portfolio/accounts`

Current boundary:

- remains on the metadata-authority / drift-fallback track
- should not proceed into new Phase F comparison implementation work

Primary historical references:

- [accounts-list track decision](../archive/phase-f/phase-f-accounts-list-track-decision-review-2026-04-21.md)
- [metadata-authority clarification](../archive/phase-f/phase-f-metadata-authority-track-clarification-review-2026-04-21.md)

## Plateau And Next-Step Boundary

Current accepted plateau boundary:

- there is currently no fourth true bounded comparison-only candidate worth selecting next inside the present portfolio surface

This means:

- do not force a weak next candidate
- do not treat current evidence as serving approval
- do not broaden into replay, snapshot, or write-path migration by default

Primary historical references:

- [no-next-bounded-read-path review](../archive/phase-f/phase-f-no-next-true-bounded-read-path-feasibility-review-2026-04-21.md)
- [comparison-only plateau review](../archive/phase-f/phase-f-portfolio-comparison-only-plateau-review-2026-04-21.md)

## Explicitly Not Done

The following are still not complete:

- PG serving for trades-list
- PG serving for cash-ledger
- PG serving for corporate-actions
- broader Phase F cutover
- replay or snapshot expansion
- write-path migration
- generic repo-wide comparison infrastructure
- overall migration completion

## Decision Documents

Use [decisions.md](./decisions.md) for the durable boundary set:

- serving boundary
- promotion-readiness framing
- cutover prerequisite framing
- accounts-list exclusion
- plateau conclusions

