# Phase F Portfolio Comparison-Only Plateau Review

## 1. Goal

Formally record the correct reviewer-facing conclusion now that the bounded Phase F portfolio comparison-only expansion line has reached its current natural stopping point.

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- replay or snapshot expansion
- write-path migration
- broader cutover work
- new comparison wiring

Its purpose is narrower:

- summarize what the current portfolio comparison-only line has accomplished
- summarize what has been intentionally excluded
- explain why there is no fourth true bounded implementation candidate right now
- explain what kind of work should come next instead of forcing more endpoints into the same template

## 2. Current Validated Comparison-Only Lines

The current validated portfolio comparison-only line consists of three meaningful bounded checkpoints.

### Trades-list

Current accepted status:

- Phase F trades-list comparison-only = non-empty bounded clean match

What that means:

- real non-empty evidence was collected
- bounded request shapes matched cleanly
- the earlier PG comparison-source availability blocker was resolved
- the earlier `created_at` false mismatch was resolved with comparison-time normalization only

What it does not mean:

- not PG serving approval
- not broader cutover approval

### Cash-ledger

Current accepted status:

- Phase F cash-ledger comparison-only = bounded non-empty real-PG evidence checkpoint complete

What that means:

- comparison scaffolding and real comparison wiring exist
- request-local diagnostics and evidence summary surfaces exist
- bounded non-empty real-PG evidence was collected
- focused real-PG regression coverage exists

What it does not mean:

- not PG serving approval
- not replay or snapshot readiness

### Corporate-actions

Current accepted status:

- Phase F corporate-actions comparison-only = bounded non-empty real-PG evidence checkpoint complete

What that means:

- comparison scaffolding and real comparison wiring exist
- request-local diagnostics exist
- bounded non-empty real-PG evidence was collected
- focused real-PG regression coverage exists

What it does not mean:

- not PG serving approval
- not broader database migration completion

Across all three validated lines, the same posture still holds:

- legacy remains the only serving source on these validated lines
- PostgreSQL remains comparison-only on these validated lines
- this is not PG serving readiness
- this is not broader cutover readiness

## 3. What Was Intentionally Excluded From Further Comparison-Only Implementation

The current plateau is not an accident. It reflects explicit reviewer decisions about what should not be pulled into further comparison-only implementation work.

### Accounts-list

`GET /api/v1/portfolio/accounts` has already been explicitly reviewed and should remain on the metadata-authority / drift-fallback track.

That means:

- it should not proceed into new Phase F comparison implementation work
- it should not be reframed as the next event-history comparison-only candidate
- the meaningful runtime posture there is already authority selection plus legacy fallback, not new comparison wiring

### No remaining true bounded comparison-only candidate

A separate reviewer note already concluded that there is currently no next true bounded Phase F comparison-only portfolio read-path candidate.

That means no fourth endpoint or service path is currently selected to extend the same implementation pattern used for:

- trades-list
- cash-ledger
- corporate-actions

### Nearby surfaces reviewed but not selected

The remaining nearby portfolio surfaces were reviewed and intentionally not chosen:

- `GET /api/v1/portfolio/broker-connections`
  - metadata-authority / trusted-PG bridge surface
- `PortfolioService.get_latest_broker_sync_state(...)`
  - overlay-authority surface
- `GET /api/v1/portfolio/snapshot`
  - too broad and replay/snapshot/valuation-adjacent
- `GET /api/v1/portfolio/risk`
  - downstream of snapshot-derived semantics and too broad

So the current plateau includes intentional exclusion, not lack of effort.

## 4. Why The Portfolio Comparison-Only Expansion Line Has Reached A Natural Plateau

The current plateau exists because the obvious bounded portfolio comparison-only candidates have already been substantially exhausted.

The event-history list pattern has now been used successfully on the three most natural conservative candidates:

- trades-list
- cash-ledger
- corporate-actions

Those three lines were good fits for the same narrow template because they were all:

- read-path only
- list-oriented
- bounded enough for allowlist-based comparison
- evidence-friendly
- narrow enough to keep legacy serving unchanged

The nearby remaining surfaces no longer fit that same template cleanly.

The problem is not that more endpoints literally exist. The problem is that the remaining endpoints and service reads are weaker fits for the same conservative pattern:

- some are metadata-authority or trusted-overlay surfaces
- some are snapshot-derived or valuation-adjacent
- some are broad enough that forcing them into the same template would stop being conservative

So the correct reviewer conclusion is:

- the bounded portfolio comparison-only expansion line has reached a natural plateau
- continuing to force more endpoints into the same implementation template would no longer be conservative

## 5. What This Plateau Does And Does Not Mean

### What it does mean

This plateau means:

- the current bounded portfolio comparison-only line has produced meaningful reviewer-usable evidence
- the main obvious event-history list candidates have already been advanced
- the current pattern has delivered value without changing serving behavior
- the next useful work should no longer be framed as “find another endpoint that kind of looks similar”

### What it does not mean

This plateau does not mean:

- PG serving readiness
- broader cutover readiness
- replay readiness
- snapshot readiness
- metadata-authority completion
- write-path readiness
- overall database migration completion

This plateau should therefore not be cited as proof that:

- PostgreSQL can now serve these endpoints
- broader migration design is finished
- the repository is ready for Phase F cutover
- the database migration is complete

## 6. What Should Not Happen Next

The next move should not be:

- forcing another weak candidate into comparison-only implementation just to preserve momentum
- treating the current evidence as implicit PG serving approval
- broadening into replay, snapshot, or valuation work without a separate bounded review
- using this plateau as proof that the migration is done
- building generic comparison infrastructure to compensate for the lack of a clean next candidate
- reopening accounts-list as if it were still undecided

The reviewer posture after this document should remain conservative:

- keep the validated line narrow
- keep legacy serving unchanged
- keep PostgreSQL in comparison-only posture on the validated lines

## 7. Recommended Next Problem Types After This Plateau

The best next work should be framed by problem type, not by forcing another endpoint selection.

Conservative next problem types include:

- comparison-only evidence consolidation and reviewer coordination
  - for example, tightening how the current accepted evidence chain is presented and consumed
- promotion-readiness framing for already validated lines
  - not serving approval, but clearer articulation of what additional evidence would still be required before any serving discussion
- metadata-authority track clarification
  - especially for surfaces like accounts-list or broker-connections that already sit on trust-and-fallback logic rather than the event-history comparison pattern
- serving-mode boundary design review
  - scoped reviewer analysis of what a serving discussion would actually require, without enabling PG serving
- broader cutover prerequisite analysis
  - bounded prerequisite mapping for migration work that sits outside the current comparison-only lane

What should not be recommended here is:

- immediate PG serving
- replay/snapshot implementation expansion
- generic migration infrastructure work justified only by the current comparison-only evidence

## 8. Reviewer Conclusion

The correct reviewer-facing conclusion is that the current bounded portfolio comparison-only expansion line has reached a natural and defensible plateau.

What has been accomplished is meaningful:

- trades-list has non-empty bounded clean-match evidence
- cash-ledger has bounded non-empty real-PG evidence
- corporate-actions has bounded non-empty real-PG evidence

What has also been accomplished is clearer selection discipline:

- accounts-list was correctly kept on the metadata-authority / drift-fallback track
- no weak fourth candidate was forced into the same template
- nearby remaining surfaces were reviewed and intentionally not selected

So the correct closure posture is:

- preserve the current validated comparison-only evidence base
- do not overstate it as serving readiness or migration completion
- stop treating “find another endpoint” as the default next move
- redirect the next work into more appropriate bounded problem types

The standing guardrails remain unchanged:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion
