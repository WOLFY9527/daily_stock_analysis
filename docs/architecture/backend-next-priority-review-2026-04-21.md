# Backend Next-Priority Review

## 1. Goal

Decide what the backend team should focus on next, given the current PostgreSQL / Phase F progress and the other active backend problem areas visible in this repository.

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- replay or snapshot expansion
- a broad redesign
- new backend feature work

Its purpose is narrower:

- compare the most plausible backend next-priority areas
- choose one recommended next priority
- optionally name one secondary priority
- explain why the other areas should not be the immediate next focus

## 2. Current Backend State Relevant To Prioritization

The current backend state is mixed rather than empty.

What is already materially advanced:

- the Phase F portfolio comparison-only line has real reviewer value now
- trades-list has a non-empty bounded clean-match checkpoint
- cash-ledger has a bounded non-empty real-PG evidence checkpoint
- corporate-actions has a bounded non-empty real-PG evidence checkpoint
- accounts-list has already been reviewed and kept on the metadata-authority / drift-fallback track
- the bounded portfolio comparison-only expansion line has reached a natural plateau and currently has no fourth true bounded candidate

What this means for prioritization:

- the database / Phase F reviewer line is meaningful, but it is no longer the clearest place to spend the next bounded backend checkpoint just by adding more reviewer framing
- there are other backend areas with active runtime surfaces, real user/product implications, and clearer remaining credibility questions

The repository also shows meaningful non-Phase-F backend surfaces:

- backtest has service, repository, API, persistence-shadow, access-isolation, and real-PG test coverage
- scanner already has a substantial service and API contract surface rather than a blank prototype
- AI/provider/routing already has structured config parsing, normalized channel handling, and validation coverage
- engineering stability / ops already has readiness, health, task-queue topology, and bounded admin-maintenance primitives

## 3. Candidate Priority Areas Considered

The candidate areas considered in this review are:

### Database / Phase F reviewer line

Current posture:

- strong reviewer framing already exists for status/index, plateau, promotion-readiness, serving boundaries, cutover prerequisites, handoff, and metadata-authority clarification
- the validated portfolio comparison-only line is meaningful but currently plateaued

### Backtest backend credibility / result stability / stored-first trustworthiness

Current posture:

- `BacktestService` and `BacktestRepository` already back durable historical-evaluation flows
- rule backtest APIs and contracts already exist
- Phase E shadow persistence exists for backtest runs and artifacts
- focused Phase E tests and real-PG tests already cover round-trip persistence, artifacts, and reset behavior

### Scanner minimal backend contract and usable API shape

Current posture:

- scanner endpoints already expose run, history, watchlist, and operational-status contracts
- scanner service and operations service are already substantial
- scanner API contract tests already exist

### AI/provider/routing backend stability

Current posture:

- config parsing already supports normalized LLM channel handling
- provider credential normalization exists
- system config validation/update logic exists
- focused tests already cover many channel and credential edge cases

### Engineering stability / ops readiness / diagnostics

Current posture:

- app live/ready health endpoints exist
- readiness already checks storage and task-queue topology
- bounded runtime cache reset and factory-reset admin operations already exist

## 4. Evaluation Criteria

This review uses the following criteria:

- user and product impact
  - whether delays here most directly weaken user trust or product usefulness
- backend leverage
  - whether progress here improves confidence in a broad backend capability rather than only adding more reviewer text
- urgency
  - whether drift or ambiguity becomes more expensive if delayed
- clarity of the next bounded step
  - whether a conservative next checkpoint is easy to define without triggering a redesign
- current maturity state
  - whether the area is already plateaued in reviewer framing or still has a meaningful unresolved backend credibility question
- risk of overreach
  - whether the likely next step can stay narrow instead of turning into a large infrastructure effort

## 5. Recommended Next Priority

The recommended next backend priority is:

- backtest backend credibility / result stability / stored-first trustworthiness

Why this is the best next priority now:

- it has direct user/product credibility impact
  - backtest results are only useful if their stored runs, artifacts, and reported outcomes are treated as trustworthy and reviewable
- it already has enough backend surface area to justify a bounded review
  - this is not a speculative area; the repo already contains service, repository, API, contract tests, ownership handling, Phase E persistence shadowing, and real-PG validation anchors
- it is not plateaued in the same way as the current Phase F portfolio reviewer line
  - the Phase F portfolio comparison-only line has already reached a natural documentation plateau, while backtest still has a live trustworthiness question with clear backend stakes
- it has a clear conservative next step
  - the next checkpoint can stay bounded around stored-first authority, artifact trust, result durability, and reviewer-visible credibility framing without requiring serving cutover or product redesign
- delay here risks credibility drift
  - if backtest keeps growing in UI and workflow importance without a firmer reviewer-facing trustworthiness framing, the backend may accumulate more output surface than credibility discipline

The right shape of the next step is still conservative:

- a reviewer-facing backtest credibility / stored-first trustworthiness review
- not new runtime behavior by default
- not a broad backtest redesign

## 6. Secondary Priority If Applicable

The secondary priority should be:

- engineering stability / ops readiness / diagnostics

Why this is the best secondary priority:

- it has broad backend leverage across multiple surfaces
- it is already grounded by concrete runtime mechanisms such as readiness, task-queue topology checks, and bounded admin maintenance actions
- it is important, but broader and less product-specific than the backtest credibility question

So it should follow the recommended backtest review rather than replace it.

## 7. Why The Other Areas Are Not The Immediate Next Focus

### Database / Phase F reviewer line

Why not now:

- this line already has substantial reviewer framing
- the portfolio comparison-only expansion path is currently plateaued
- continuing there immediately would likely produce more coordination prose faster than it produces new backend leverage

This does not reduce its importance.
It means the next bounded backend checkpoint should come from a less-plateaued line.

### Scanner minimal backend contract

Why not now:

- scanner is not a blank or undefined backend contract anymore
- the repo already contains a substantial scanner service, operational workflow, and API contract coverage
- a “minimal backend contract” pass is still reasonable later, but it is less urgent than backtest trustworthiness because the scanner contract is already materially present

### AI/provider/routing backend stability

Why not now:

- this area is important but broad
- the repo already has meaningful config normalization and validation coverage, including LLM channels, provider credentials, and system-config validation behavior
- it is a better follow-on stability line than the single immediate next focus because it can expand quickly into cross-cutting infrastructure work if taken first

### Engineering stability / ops readiness / diagnostics

Why not as the primary next focus:

- it is broad and useful, but less sharply tied to a single user-facing credibility problem than backtest
- much of its current value comes from tightening operational framing rather than resolving the next most specific backend trust question
- it is better treated as the secondary line after the next bounded backtest review

## 8. Reviewer Conclusion

The correct next backend focus is not to keep extending the current Phase F portfolio reviewer chain by default. That line has earned a meaningful status, but it is presently plateaued at the reviewer level.

The next best bounded backend priority is backtest backend credibility / result stability / stored-first trustworthiness. It has stronger immediate product impact, a clearer remaining backend trust question, and a more defensible conservative next step than the other candidate areas.

If a secondary line is needed after that, it should be engineering stability / ops readiness / diagnostics. Scanner minimal contract work and AI/provider/routing stability both remain worthwhile, but neither is the best immediate next focus ahead of the backtest credibility line.
