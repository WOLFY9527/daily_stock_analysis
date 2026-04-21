# Phase F Portfolio Comparison-Only Status Index

## 1. Scope Of This Index

This document is the single reviewer-facing entry point for the current Phase F portfolio comparison-only status as of 2026-04-21.

It is intentionally narrow:

- backend-only
- docs-first
- conservative
- comparison-only
- focused on portfolio read paths

It does not reopen serving-mode discussion, broaden Phase F scope, or imply that the PostgreSQL/database migration is complete.

## 2. Current Overall Phase F Posture

Phase F has made meaningful progress on portfolio read-path comparison validation, but the overall PostgreSQL/database migration is not complete.

The current accepted posture is:

- legacy remains the only serving source
- PostgreSQL is still being validated primarily as a comparison source on the portfolio lines covered here
- this is not PostgreSQL serving readiness
- this is not broader cutover readiness
- this is not evidence that the database migration is complete

Within that narrow posture, two lines already have meaningful reviewer-facing evidence:

- trades-list comparison-only has reached a non-empty bounded clean-match checkpoint
- cash-ledger comparison-only has reached a bounded non-empty real-PG evidence checkpoint

Those are useful Phase F checkpoints. They are not serving approvals.

## 3. Trades-List Current Status

Current accepted status:

- Phase F trades-list comparison-only = non-empty bounded clean match

What is already established:

- the earlier PG comparison source availability blocker was resolved
- local PG connection and comparison-source access were established successfully for the accepted evidence pass
- empty-result validation was completed earlier and is no longer the highest-value status checkpoint
- real non-empty evidence was collected
- bounded request shapes matched cleanly
- the earlier `created_at` false mismatch was resolved with comparison-time normalization only
- reviewer-facing evidence artifacts already exist

What this means now:

- trades-list is no longer at an empty-only checkpoint
- trades-list has useful comparison-only evidence over non-empty returned rows
- trades-list still serves from legacy only
- trades-list is still not PG serving ready

## 4. Cash-Ledger Current Status

Current accepted status:

- Phase F cash-ledger comparison-only = bounded non-empty real-PG evidence checkpoint complete

What is already established:

- docs-first bounded feasibility and design work already exists in the reviewer chain
- scaffolding slice 1 exists
- real comparison wiring slice 2 exists
- bounded mismatch classification exists
- request-local diagnostics exist
- a compact evidence summary exists
- an in-process evidence collector exists
- reviewer-facing docs already exist
- bounded non-empty real local PG evidence was collected
- focused real-PG regression coverage exists
- legacy remains the only serving source
- the endpoint and public contract remain unchanged

What this means now:

- cash-ledger is materially past a scaffolding-only framing
- cash-ledger has meaningful bounded comparison-only evidence
- cash-ledger is still comparison-only
- cash-ledger is still not PG serving ready

## 5. Artifact Index By Line

This index intentionally lists only currently relevant repository artifacts for the two portfolio read-path lines. It does not list speculative future docs.

### Trades-list

- [phase-f-trades-list-evidence-collection-runbook-2026-04-20.md](./phase-f-trades-list-evidence-collection-runbook-2026-04-20.md)
  - bounded reviewer/operator runbook for comparison evidence collection
- [phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md](./phase-f-trades-list-non-empty-acceptance-evidence-review-2026-04-21.md)
  - authoritative reviewer-facing status doc for the current non-empty bounded clean-match checkpoint

### Cash-ledger

- [phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md](./phase-f-cash-ledger-comparison-boundary-feasibility-review-2026-04-21.md)
  - bounded candidate boundary and feasibility framing
- [phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md](./phase-f-cash-ledger-evidence-collection-runbook-2026-04-21.md)
  - reviewer/operator runbook for bounded comparison evidence collection
- [phase-f-cash-ledger-acceptance-evidence-review-2026-04-21.md](./phase-f-cash-ledger-acceptance-evidence-review-2026-04-21.md)
  - reviewer-facing acceptance posture for the comparison-only line after diagnostics and evidence helpers landed
- [phase-f-cash-ledger-non-empty-evidence-collection-plan-2026-04-21.md](./phase-f-cash-ledger-non-empty-evidence-collection-plan-2026-04-21.md)
  - bounded real-PG non-empty evidence collection plan
- [phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md](./phase-f-cash-ledger-non-empty-acceptance-evidence-review-2026-04-21.md)
  - authoritative reviewer-facing status doc for the current bounded non-empty real-PG evidence checkpoint

Implementation grounding for the current posture should be read conservatively through the current Phase F comparison-focused tests and storage/service anchors, especially:

- `tests/test_postgres_phase_f.py`
- `tests/test_postgres_phase_f_real_pg.py`
- `src/services/portfolio_service.py`
- `src/postgres_phase_f.py`
- `src/storage.py`

## 6. Settled Issues That Should Not Be Reopened

The following points are already settled enough that they should not be casually reframed as open questions in the next pass:

- trades-list PG source unavailable as the active root problem
- trades-list as an empty-only evidence line
- trades-list `created_at` false mismatch investigation as if it were still an unresolved active blocker
- cash-ledger framed as scaffolding-only as if real comparison wiring, diagnostics, summary, collector, and reviewer evidence do not already exist
- any implication that cash-ledger is already PG serving ready
- any implication that trades-list clean comparison evidence equals serving approval

If one of these points is revisited later, it should only be because new contradictory evidence appears, not because the already-accepted reviewer checkpoint is being casually re-litigated.

## 7. What Is Explicitly Not Done Yet

The following are still not complete:

- PG serving for trades-list
- PG serving for cash-ledger
- broader Phase F cutover
- replay or snapshot expansion
- write-path cutover
- generic repo-wide comparison infrastructure
- overall database migration completion

This index should therefore not be cited as proof of:

- serving-mode readiness
- replay readiness
- snapshot readiness
- broad operational readiness
- cutover readiness

## 8. Recommended Next Move

The recommended next move is another small portfolio read-path comparison-only candidate, not PG serving.

Selection criteria for the next candidate should stay strict:

- read-path only
- bounded surface area
- small payload surface
- limited filters
- stable contract
- comparison-only first
- evidence-friendly request matrix

The preferred pattern is:

1. docs-first bounded feasibility review
2. narrow comparison-only wiring
3. request-local diagnostics and compact reviewer evidence
4. bounded non-empty evidence collection
5. reviewer-facing acceptance review

That keeps Phase F moving without broadening into replay, snapshot, serving, or generic infrastructure work.

## 9. Reviewer Guidance / How To Use This Index

Use this document first when you need to answer any of the following:

- what Phase F currently means in this repository
- which portfolio read-path lines already have meaningful evidence
- which documents are authoritative for trades-list and cash-ledger
- which old debates are already settled enough not to reopen casually
- what remains out of scope before any new endpoint work begins

Practical review sequence:

1. read Section 2 for the overall posture
2. read Section 3 or Section 4 for the specific portfolio line you care about
3. open the authoritative artifact for that line from Section 5
4. use Section 6 and Section 7 to avoid overstating readiness or reopening settled issues
5. use Section 8 to choose the next bounded comparison-only step

If a future change proposal claims PG serving readiness, broader cutover readiness, replay/snapshot readiness, or “migration complete,” this index should be treated as a quick contradiction check unless newer accepted evidence explicitly supersedes it.
