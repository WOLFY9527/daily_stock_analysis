# Phase F Metadata-Authority Track Clarification Review

## 1. Goal

Clarify which current portfolio surfaces belong on the metadata-authority / drift-fallback track, why they belong there, and how that track should be understood relative to the validated comparison-only portfolio lines.

This document is docs-only and review-only. It does not authorize or implement:

- PostgreSQL serving
- new comparison wiring
- replay or snapshot expansion
- write-path migration
- broader cutover work

Its purpose is narrower:

- explain which portfolio surfaces are metadata-authority-adjacent today
- explain why those surfaces should not be forced into the event-history comparison-only implementation template
- explain how future reviewers should distinguish this track from the validated comparison-only lines

## 2. What The Metadata-Authority / Drift-Fallback Track Means

The metadata-authority / drift-fallback track is the reviewer label for portfolio surfaces whose meaningful Phase F behavior is not "legacy-served event list plus PG comparison diagnostics."

Instead, the meaningful behavior on this track is:

- trusted Phase F metadata or trusted PG-backed overlay data may satisfy the read
- the service remains responsible for deciding whether that trusted surface is acceptable
- when authority drifts or trust conditions are not met, the service falls back to legacy-backed reads

That means this track is primarily about:

- authority selection
- trust state
- drift handling
- controlled fallback

It is not primarily about:

- event-history list parity collection
- request-local comparison-only diagnostics as the main feature
- extending the same implementation pattern used for trades-list, cash-ledger, and corporate-actions

## 3. Which Current Portfolio Surfaces Belong On This Track

The current portfolio surfaces that belong on this track are:

- `GET /api/v1/portfolio/accounts`
- `GET /api/v1/portfolio/broker-connections`
- `PortfolioService.get_latest_broker_sync_state(...)`

These surfaces are the clearest current examples of metadata-authority-adjacent or trusted-overlay behavior.

### Accounts-list

Current path:

- endpoint: `GET /api/v1/portfolio/accounts`
- service path: `PortfolioService.list_accounts(...)`

Current reviewer-grounded posture:

- the service first attempts to satisfy the read from trusted Phase F account metadata
- when metadata authority drifts, the service falls back to the legacy repo list path

### Broker-connections

Current path:

- endpoint: `GET /api/v1/portfolio/broker-connections`
- service path: `PortfolioService.list_broker_connections(...)`

Current reviewer-grounded posture:

- the service first attempts to read Phase F broker-connection metadata rows
- when broker-connection authority drifts, the service falls back to the legacy repo list path

### Latest broker sync state

Current path:

- service path: `PortfolioService.get_latest_broker_sync_state(...)`

Current reviewer-grounded posture:

- the service first attempts to read the Phase F latest sync overlay bundle
- when latest-sync overlay authority drifts, the service falls back to legacy sync-state reads

These three surfaces are therefore already better understood as authority/fallback surfaces than as new comparison-only implementation candidates.

## 4. Why These Surfaces Do Not Fit The Comparison-Only Implementation Template

The validated comparison-only lines share a narrower pattern:

- they are event-history list reads
- they stay legacy-served
- PG is used as a comparison source
- request-local parity diagnostics are the main Phase F mechanism

The metadata-authority track surfaces differ in important ways.

### Accounts-list differs because:

- it is metadata, not event-history payload
- it already sits near an authority decision
- its meaningful behavior is trusted metadata plus legacy fallback

### Broker-connections differs because:

- it is also metadata-oriented rather than event-history-oriented
- it already has trusted-PG metadata behavior
- it already has explicit authority-drift fallback semantics

### Latest broker sync state differs because:

- it is an overlay surface, not an event-history list surface
- it carries nested positions and cash-balance payloads
- it already lives inside trusted-overlay versus legacy-fallback behavior

So these surfaces should not be forced into the comparison-only template merely to keep the old implementation pattern moving.

## 5. What Current Runtime Posture Already Exists On This Track

The current runtime posture on this track is already materially defined in service behavior and tests.

What already exists:

- trusted metadata / trusted PG / trusted overlay reads can satisfy the surface when authority is acceptable
- legacy fallback still exists when authority drifts
- service ownership of the decision already exists
- focused tests already cover trust-and-fallback behavior on these surfaces

More concretely:

- accounts-list has focused tests for trusted metadata preference and drift-triggered fallback
- broker-connections has focused tests for trusted metadata preference and drift-triggered fallback
- latest broker sync state has focused tests for trusted overlay preference and drift-triggered fallback

This means the meaningful Phase F story on this track is already:

- authority state
- fallback safety
- trust versus drift

It is not:

- missing comparison-only scaffolding

This still does not imply:

- PG serving readiness
- broader migration completion
- portfolio-wide authority completion

## 6. What Reviewer Questions Are Still Reasonable On This Track

Reasonable reviewer questions on this track include:

- what exactly makes a surface trusted enough to prefer Phase F metadata or overlay reads
- how authority drift is detected and how clearly that drift is surfaced
- whether the fallback posture is conservative enough for the current scope
- whether the owner-scope and filter behavior are still clear and well-bounded
- whether future reviewer docs should further clarify authority-state interpretation on these surfaces

Reasonable reviewer questions do not include:

- how to force these surfaces into the event-history comparison-only pattern
- how to turn them into immediate PG serving candidates

## 7. What Should Explicitly Not Happen Next

The following should explicitly not happen next:

- do not reopen accounts-list as a new comparison-only implementation candidate
- do not force broker-connections into the event-history comparison-only template
- do not force latest broker sync state into the event-history comparison-only template
- do not treat trust-and-fallback behavior as PG serving approval
- do not use this track as justification for broader migration completion claims
- do not build generic infrastructure just to unify unlike surfaces under one Phase F pattern

The standing guardrails remain:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion

## 8. Relationship To The Validated Comparison-Only Lines

Future reviewers should keep these two tracks distinct.

### Validated comparison-only lines

- trades-list
- cash-ledger
- corporate-actions

These lines are best understood as:

- event-history list candidates
- legacy-served
- PG-compared
- bounded by request-local diagnostics and evidence collection

### Metadata-authority / drift-fallback track surfaces

- accounts-list
- broker-connections
- latest broker sync state

These surfaces are best understood as:

- authority or overlay surfaces
- trust-and-fallback driven
- already shaped around trusted metadata / trusted PG / overlay preference when acceptable
- still requiring conservative fallback semantics when drift appears

Mixing these two tracks creates reviewer confusion:

- comparison-only progress does not automatically say anything about metadata-authority completion
- metadata-authority trust/fallback behavior does not automatically make a surface the next comparison implementation candidate

## 9. Reviewer Conclusion

The correct reviewer conclusion is that accounts-list, broker-connections, and latest broker sync state currently belong on the metadata-authority / drift-fallback track, not on the next-comparison-only implementation queue.

They belong there because their meaningful Phase F behavior is already:

- trusted metadata or trusted overlay preference
- authority-state interpretation
- legacy fallback when drift appears

They should not be forced into the event-history comparison-only pattern used for trades-list, cash-ledger, and corporate-actions.

This clarification does not change the broader guardrails:

- legacy remains the only serving source on the validated comparison-only lines
- PostgreSQL remains comparison-only on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this is not database migration completion
