# Phase F Portfolio Cutover Prerequisite Analysis

## 1. Goal

Define the prerequisite categories that would need to be satisfied before any serious future cutover review for the currently validated Phase F portfolio lines could be credible.

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- canary or dark serving
- fallback-to-PG serving
- replay or snapshot expansion
- write-path migration
- broader cutover work

This is not a cutover plan.
This is not a serving implementation plan.
This is a prerequisite analysis only.

Its purpose is narrower:

- explain what the current evidence makes possible to review at the reviewer level
- explain what remains clearly premature today
- distinguish what has been partially strengthened from what remains largely open

## 2. Current Validated Lines Relevant To Future Cutover Discussion

The relevant lines are still the same three bounded comparison-only checkpoints.

### Trades-list

Current accepted status:

- Phase F trades-list comparison-only = non-empty bounded clean match

What this contributes:

- real non-empty parity evidence exists
- bounded request shapes matched cleanly
- the earlier PG-source-unavailable blocker was resolved

What this does not contribute:

- not serving approval
- not cutover approval

### Cash-ledger

Current accepted status:

- Phase F cash-ledger comparison-only = bounded non-empty real-PG evidence checkpoint complete

What this contributes:

- real comparison wiring exists
- request-local diagnostics exist
- compact evidence summary and collector support exist
- bounded non-empty real-PG evidence exists

What this does not contribute:

- not serving approval
- not cutover approval

### Corporate-actions

Current accepted status:

- Phase F corporate-actions comparison-only = bounded non-empty real-PG evidence checkpoint complete

What this contributes:

- real comparison wiring exists
- request-local diagnostics exist
- bounded non-empty real-PG evidence exists
- focused real-PG regression coverage exists

What this does not contribute:

- not serving approval
- not cutover approval

Across all three validated lines, the standing posture remains:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion

## 3. What Current Evidence Does Make Possible To Review

The current evidence makes it reasonable to discuss cutover prerequisites as reviewer questions.

What is now reasonable to review:

- whether these lines are materially stronger than scaffold-only or thin-evidence candidates
- which prerequisite categories have been partially strengthened by the current comparison-only checkpoints
- which prerequisite categories remain mostly unresolved despite the stronger evidence
- how any future cutover discussion would need to stay bounded line-by-line rather than jump to portfolio-wide conclusions

What is not reasonable to do from the current state:

- begin cutover work
- treat current evidence as implicit cutover approval
- collapse reviewer framing into implementation planning

So the correct move is:

- discuss prerequisites more clearly
- keep runtime behavior unchanged

## 4. What Is Still Clearly Premature

The following are still clearly premature:

- PG serving rollout
- canary or dark serving
- fallback-to-PG serving
- broader portfolio authority change
- replay or snapshot expansion
- write-path migration
- migration completion claims

It is also still premature to claim:

- portfolio-wide readiness
- cutover sequencing readiness
- operationally acceptable blast radius
- production-like assurance for these lines

So even though the evidence is stronger than before, serious cutover action remains premature.

## 5. Prerequisite Categories Before Serious Cutover Review

If future discussion ever moves toward serious cutover review, the following prerequisite categories would need explicit reviewer treatment first.

Relevant categories include:

- evidence breadth and representativeness
  - whether the current evidence covers enough account shapes, request shapes, and realistic data variation
- repeated evidence durability
  - whether the current parity confidence is durable rather than a small-window checkpoint
- rollback posture
  - what recovery path would exist if a served line had to revert quickly
- fallback posture
  - what safety behavior would apply if confidence degraded or failures appeared
- blast-radius analysis
  - what user-facing and system-facing consequences would follow from bad serving behavior on each line
- observability and diagnostics expectations
  - what reviewer-visible and operator-visible signals would be required if authority changed
- serving-authority boundary clarity
  - what "authority" would actually mean per line if legacy stopped being the only serving source
- cutover sequencing clarity
  - what order of review or dependency constraints would exist across lines and adjacent systems
- metadata-authority interaction clarity
  - how the event-history lines would relate to separate metadata-authority / drift-fallback surfaces
- operational risk framing
  - what unresolved risks would still be considered unacceptable for cutover discussion

These are reviewer prerequisite categories, not implementation steps.

## 6. Which Prerequisite Categories Are Partially Improved Vs Still Largely Open

The current validated lines have partially improved some prerequisite categories, but they have not closed them.

### Categories that are partially improved

- comparison-only evidence quality
  - materially stronger than feasibility-only, scaffolding-only, or empty-only states
- bounded non-empty parity confidence
  - now supported on the validated lines rather than inferred from structural matches alone
- reviewer artifact quality
  - accepted evidence docs, diagnostics, and comparison surfaces now exist and are usable
- local mismatch visibility
  - request-local mismatch, query-failure, and diagnostic framing is materially clearer than before

### Categories that remain largely open

- production-like serving assurance
  - still far beyond what the current bounded checkpoints prove
- rollback and fallback confidence
  - current comparison diagnostics are not the same as cutover-grade recovery posture
- blast-radius containment
  - not yet reviewed at cutover consequence level
- observability expectations after authority change
  - still requires separate explicit review
- cutover sequencing clarity
  - still open across broader migration dependencies
- interaction with metadata-authority and broader migration tracks
  - still not resolved by the three validated event-history lines

So the correct reviewer reading is:

- comparison-only confidence has improved materially
- cutover readiness remains largely open

## 7. What Should Explicitly Not Be Inferred From The Current State

The following inferences should be treated as incorrect:

- PG serving readiness has been earned
- cutover readiness has been earned
- portfolio-wide readiness has been earned
- metadata-authority completion has been earned
- replay or snapshot readiness has been earned
- write-path readiness has been earned
- database migration completion has been earned

The current state should also not be used to argue:

- that the validated lines can now bypass serving-boundary review
- that accounts-list should be reopened as a comparison implementation candidate
- that snapshot, risk, or other broader surfaces should now be pulled into cutover discussion without separate bounded review

The right interpretation is narrower:

- the validated lines are materially stronger comparison-only lines
- they are still not cutover-ready lines

## 8. Recommended Next Reviewer/Problem-Framing Categories

The best next work should remain reviewer/problem-framing work.

Conservative next categories include:

- rollback and fallback design review
  - explicit reviewer analysis of recovery behavior and failure containment
- observability and risk framing
  - what signals, diagnostics, and risk tolerances would be required before serious cutover review
- evidence-breadth review
  - clearer articulation of what additional breadth would still be needed beyond the current bounded checkpoints
- serving-authority clarification
  - sharper definition of what authority change would mean line-by-line
- cutover sequencing review
  - bounded reviewer treatment of ordering, dependencies, and preconditions across adjacent migration tracks

What should not be recommended here is:

- immediate PG serving
- immediate canary or dark serving
- replay/snapshot implementation work
- generic redesign justified only by the current comparison-only evidence

## 9. Reviewer Conclusion

The correct reviewer-facing conclusion is that the validated trades-list, cash-ledger, and corporate-actions lines have strengthened the evidence base enough to support a more explicit cutover-prerequisite discussion.

They have not strengthened it enough to support serious cutover action.

The correct posture is therefore:

- use the current validated lines to frame prerequisite questions more clearly
- treat many key cutover categories as still largely open
- keep current implementation legacy-served and comparison-only

The standing guardrails remain unchanged:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion
