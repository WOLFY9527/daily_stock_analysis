# Phase F Portfolio Promotion-Readiness Framing Review

## 1. Goal

Define what "promotion-readiness" means at the current stage for the validated Phase F portfolio comparison-only lines:

- `GET /api/v1/portfolio/trades`
- `GET /api/v1/portfolio/cash-ledger`
- `GET /api/v1/portfolio/corporate-actions`

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- replay or snapshot expansion
- write-path migration
- broader cutover work
- new comparison wiring

Its purpose is narrower:

- explain what the current evidence actually supports
- explain what the current evidence still does not support
- explain why these lines are materially stronger than thin or scaffold-only states
- explain what kinds of additional review would be needed before any serving-mode discussion could be taken seriously

## 2. Current Validated Lines Covered By This Framing

This framing is limited to the currently validated portfolio comparison-only lines.

### Trades-list

Current accepted status:

- Phase F trades-list comparison-only = non-empty bounded clean match

Current reviewer-grounded posture:

- the PG comparison-source availability blocker was resolved
- non-empty bounded request shapes matched cleanly
- the earlier `created_at` false mismatch was resolved with comparison-time normalization only
- comparison remains request-local and diagnostic-only

### Cash-ledger

Current accepted status:

- Phase F cash-ledger comparison-only = bounded non-empty real-PG evidence checkpoint complete

Current reviewer-grounded posture:

- real comparison wiring exists
- request-local diagnostics exist
- compact evidence summary and collector surfaces exist
- bounded non-empty real-PG evidence was collected

### Corporate-actions

Current accepted status:

- Phase F corporate-actions comparison-only = bounded non-empty real-PG evidence checkpoint complete

Current reviewer-grounded posture:

- real comparison wiring exists
- request-local diagnostics exist
- bounded non-empty real-PG evidence was collected
- focused real-PG regression coverage exists

Across all three lines, the shared posture remains:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion

## 3. What Has Already Been Earned By The Current Evidence

The current evidence has earned more than feasibility-only or scaffolding-only status.

At this stage, the validated lines have already earned the following reviewer-facing conclusions:

- the comparison-only path is real, not hypothetical
- the comparison-only path is reviewable and nontrivial on these lines
- legacy-served responses are being checked against PG-backed comparison candidates on bounded request shapes
- request-local diagnostics exist and are useful enough for reviewer interpretation
- the evidence chain now includes non-empty returned-row parity, not only structural empty-result validation

More specifically:

- trades-list has earned a non-empty bounded clean-match checkpoint over multiple bounded request shapes
- cash-ledger has earned bounded non-empty real-PG evidence with an explicit evidence summary surface
- corporate-actions has earned bounded non-empty real-PG evidence with request-local diagnostic reports

That means these lines have already moved materially beyond:

- feasibility review only
- config-only scaffolding
- source-unavailable comparison attempts
- empty-only evidence

So "promotion-readiness" at this stage can fairly mean:

- the lines are strong enough to justify more serious reviewer scrutiny than scaffold-only work
- the lines have earned a place in future serving-boundary discussions as evidence inputs
- the lines have not earned serving approval

## 4. What Has Explicitly Not Been Earned

The current evidence does not equal any of the following:

- PG serving readiness
- broader cutover readiness
- replay readiness
- snapshot readiness
- write-path readiness
- portfolio-wide readiness
- full database migration readiness
- broad production-like coverage

It also does not mean:

- fallback behavior is fully reviewed for serving-mode decisions
- serving authority has been reassigned away from legacy
- operational rollback posture has been fully proven for any cutover scenario
- the validated lines have enough breadth, duration, or environment diversity to support PG serving approval

So the correct reviewer reading is:

- meaningful progress has been earned
- serving approval has not been earned

## 5. Why The Current Lines Are Still Stronger Than Thin Or Scaffold-Only Candidates

These three validated lines should be treated as materially stronger than thin or scaffold-only candidates for several concrete reasons.

First, they are no longer feasibility-only:

- the code paths exist
- the comparison execution is real
- reviewer-facing artifacts exist

Second, they are no longer scaffolding-only:

- trades-list comparison attempts run against a PG-backed candidate source and produce bounded diagnostic outputs
- cash-ledger has real comparison wiring plus evidence-summary support
- corporate-actions has real comparison wiring plus request-local diagnostic reporting

Third, they are no longer empty-only:

- trades-list has bounded non-empty clean-match evidence
- cash-ledger has bounded non-empty real-PG evidence
- corporate-actions has bounded non-empty real-PG evidence

Fourth, they are no longer blocked by obvious source-availability framing:

- trades-list is no longer in a PG-source-unavailable state
- cash-ledger and corporate-actions already have real-PG-backed evidence checkpoints

So these lines deserve to be discussed as materially advanced comparison-only lines, not as early-stage exploratory slices.

That stronger status is important because it changes the quality of the next reviewer question:

- the question is no longer "does bounded comparison-only plumbing work at all?"
- the question becomes "what additional categories of evidence and boundary review would still be needed before serving-mode discussion could be credible?"

## 6. Readiness Categories That Would Be Needed Before Any Serving-Mode Review

This document does not recommend serving now. It only frames the categories of further review that would likely be needed before serious serving-mode review could even begin.

Relevant categories include:

- broader evidence breadth
  - more than one narrow account shape, more than one tiny local request window, and more than one tightly bounded sample family
- repeated evidence durability and collection quality
  - stronger confidence that the observed parity is not just a one-run or one-window checkpoint
- serving-authority boundary review
  - explicit review of what would have to change before legacy stopped being the only serving source
- fallback and rollback review
  - explicit analysis of how mismatch, drift, or runtime failures would be contained if serving were ever discussed
- operational risk framing
  - reviewer-facing articulation of failure modes, confidence gaps, and monitoring implications
- cutover prerequisite analysis
  - a clearer map of what other migration areas would have to be ready before endpoint-level serving discussion meant anything

These are framing categories, not an implementation plan.

The important reviewer takeaway is:

- the current evidence may justify more serious readiness framing
- it still does not justify skipping these categories

## 7. What Should Not Be Inferred From The Current Evidence

The following inferences should be treated as incorrect:

- the validated lines are implicitly approved for PG serving
- the portfolio surface is broadly ready
- metadata-authority work is complete
- the broader migration is complete
- the plateau reached by comparison-only expansion means the job is finished
- current bounded matches prove production-like robustness

The current evidence should also not be used to argue:

- that accounts-list should now be reopened as a comparison candidate
- that snapshot or risk work can be pulled into serving-mode discussion without separate bounded review
- that generic migration infrastructure should now be built because three lines matched in bounded comparison-only review

The right interpretation is narrower:

- these three lines are materially stronger than before
- they are still bounded comparison-only lines

## 8. Recommended Next Review/Problem Types

The best next work should stay reviewer-oriented and framing-oriented.

Conservative next problem types include:

- serving-mode boundary design review
  - explicit definition of what would have to be true before serving-mode review could even be credible
- cutover prerequisite analysis
  - broader mapping of dependencies and blockers outside the current comparison-only line
- evidence consolidation
  - tightening the reviewer story around the already validated lines and the accepted evidence chain
- promotion-readiness clarification
  - sharper articulation of what is earned now versus what remains missing
- metadata-authority track clarification
  - especially for surfaces that should not be forced into the comparison-only template

What should not be recommended here is:

- immediate PG serving
- replay/snapshot implementation work
- broad redesign justified only by the current comparison-only checkpoints

## 9. Reviewer Conclusion

The correct reviewer-facing conclusion is that the validated trades-list, cash-ledger, and corporate-actions lines have earned materially stronger comparison-only status than scaffold-only or thin-evidence candidates.

What has been earned:

- real comparison-only evidence
- bounded non-empty parity evidence on the validated lines
- reviewer-usable diagnostic and evidence artifacts
- a stronger basis for future readiness framing discussions

What has not been earned:

- PG serving readiness
- broader cutover readiness
- replay or snapshot readiness
- write-path readiness
- full migration readiness

So "promotion-readiness" at this stage should be interpreted as:

- these lines are strong enough to justify more serious readiness framing review
- these lines are not strong enough to justify serving approval

The standing guardrails remain unchanged:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion
