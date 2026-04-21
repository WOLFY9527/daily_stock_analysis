# Phase F Portfolio Serving-Mode Boundary Review

## 1. Goal

Define the correct reviewer-facing boundary for any future serving-mode discussion involving the currently validated Phase F portfolio comparison-only lines:

- `GET /api/v1/portfolio/trades`
- `GET /api/v1/portfolio/cash-ledger`
- `GET /api/v1/portfolio/corporate-actions`

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- canary serving
- fallback-to-PG serving
- replay or snapshot expansion
- write-path migration
- broader cutover work

Its purpose is narrower:

- explain what the current evidence makes reasonable to discuss at the reviewer level
- explain what the current evidence still does not justify
- define the boundary questions that would require explicit review before any serving-mode discussion could become credible

## 2. Current Validated Lines Relevant To Future Serving-Mode Discussion

The currently relevant lines are still the same three bounded comparison-only checkpoints.

### Trades-list

Current accepted status:

- Phase F trades-list comparison-only = non-empty bounded clean match

What is relevant for future serving-mode discussion:

- the PG comparison source is available
- bounded non-empty request shapes matched cleanly
- the earlier `created_at` false mismatch was resolved with comparison-time normalization only

What is not relevant to claim:

- this is not serving approval

### Cash-ledger

Current accepted status:

- Phase F cash-ledger comparison-only = bounded non-empty real-PG evidence checkpoint complete

What is relevant for future serving-mode discussion:

- real comparison wiring exists
- request-local diagnostics exist
- evidence summary and collector support exist
- bounded non-empty real-PG evidence was collected

What is not relevant to claim:

- this is not serving approval

### Corporate-actions

Current accepted status:

- Phase F corporate-actions comparison-only = bounded non-empty real-PG evidence checkpoint complete

What is relevant for future serving-mode discussion:

- real comparison wiring exists
- request-local diagnostics exist
- bounded non-empty real-PG evidence was collected
- focused real-PG regression coverage exists

What is not relevant to claim:

- this is not serving approval

Across all three validated lines, the standing guardrails remain:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion

## 3. What The Current Evidence Makes Reasonable To Discuss

The current evidence does justify a more serious reviewer discussion about serving-mode boundaries.

What is now reasonable to discuss:

- whether these three lines are strong enough to be treated as future serving-boundary candidates rather than scaffold-only slices
- what "serving authority" would even mean if legacy stopped being the only serving source on these lines
- what categories of additional evidence would have to exist before any serving trial were credible
- what invariants would need to hold before a reviewer could take serving-mode design seriously

What is not reasonable to do in this pass:

- move from discussion to implementation
- treat the current evidence as implicit approval

So the correct boundary is:

- reviewer discussion may become more explicit
- serving behavior must remain unchanged

## 4. What The Current Evidence Still Does Not Justify

The current evidence still does not justify any of the following:

- PG serving rollout
- canary serving
- fallback-to-PG serving
- broader Phase F cutover
- portfolio-wide authority change
- replay or snapshot expansion
- write-path migration

It also does not justify:

- changing endpoint/public schema
- changing source-selection behavior
- treating these lines as operationally proven beyond bounded comparison-only checkpoints

So even though the evidence is materially stronger than scaffold-only status, it still falls short of anything that should be called serving-mode readiness.

## 5. Serving-Mode Boundary Questions That Would Need Explicit Review

If future discussion ever moves toward serving-mode for these lines, the discussion boundary would have to stay explicit and reviewer-owned.

Questions that would require explicit review include:

- what exactly would "serving authority" mean on trades-list, cash-ledger, and corporate-actions
- what exact evidence breadth would be required beyond the current bounded non-empty checkpoints
- how serving-source selection would be reviewed before legacy stopped being the only serving source
- what invariants would need to hold for row membership, ordering, pagination, and supported filters
- what confidence threshold would distinguish "comparison-only evidence" from "credible serving-boundary candidate"
- how line-specific readiness would be separated from broader portfolio or repository-wide readiness

These are not implementation tasks. They are reviewer questions that would need their own bounded design treatment before any implementation discussion became responsible.

## 6. Fallback / Rollback / Blast-Radius Questions That Would Need Explicit Review

Any future serving-mode review would also require a separate and stricter examination of fallback, rollback, and blast radius.

Questions that would require explicit review include:

- what rollback posture would exist if serving authority ever changed on one of these lines
- what fallback posture would exist if parity confidence later degraded
- what the blast radius would be for bad ordering, membership, or filter behavior on a served line
- what observability and diagnostics expectations would apply once comparison became insufficient and serving authority changed
- what mismatch handling expectations would apply if mismatches were discovered after a serving change rather than before one
- how reviewer confidence would be maintained if the line moved from diagnostic-only mismatches into user-facing serving risk

This matters because the current diagnostics are good enough for comparison-only review, but serving-mode review would raise the consequence of any unresolved mismatch, drift, or query failure.

## 7. What Should Explicitly Remain Out Of Scope For Now

The following remain out of scope in the current state:

- serving implementation
- canary serving or dark serving
- fallback-to-PG serving behavior
- replay or snapshot work
- generic serving infrastructure
- metadata-authority cutover
- write-path cutover
- broader migration completion claims

The following surfaces also remain outside this specific serving-boundary discussion:

- `GET /api/v1/portfolio/accounts`
  - remains on the metadata-authority / drift-fallback track
- broker-connections
- latest broker sync state
- snapshot
- risk

Those surfaces should not be silently pulled into this document’s scope.

## 8. Recommended Next Review Categories Before Any Serving Implementation

The best next work should remain reviewer/problem-framing work, not serving implementation.

Conservative next review categories include:

- broader cutover prerequisite analysis
  - what surrounding migration conditions would have to be true before line-level serving discussion meant anything
- rollback and fallback design review
  - explicit reviewer treatment of recovery posture and failure containment
- evidence-breadth review
  - what additional evidence scope would be needed beyond the current bounded local checkpoints
- observability and risk framing
  - what operational signals and reviewer expectations would be needed if serving were ever discussed
- serving-authority boundary clarification
  - explicit articulation of how authority would be defined, limited, and reviewed on each validated line

What should not be recommended here is:

- immediate PG serving
- immediate canary or dark serving
- replay/snapshot implementation expansion
- generic redesign justified only by the current comparison-only evidence

## 9. Reviewer Conclusion

The correct reviewer-facing conclusion is that the current validated lines are strong enough to justify a more serious boundary discussion about what future serving-mode review would need to examine.

They are not strong enough to justify serving behavior changes now.

So the correct boundary is:

- future reviewer discussion may responsibly focus on authority, evidence breadth, rollback, fallback, blast radius, and observability questions
- current implementation must remain legacy-served and comparison-only

The standing guardrails remain unchanged:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion
