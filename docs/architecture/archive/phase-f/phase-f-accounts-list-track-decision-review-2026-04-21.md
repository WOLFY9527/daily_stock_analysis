# Phase F Accounts-List Track Decision Review

## Goal

Decide whether `GET /api/v1/portfolio/accounts` should proceed as:

1. a tiny metadata parity review surface, or
2. a surface that should remain under the existing metadata-authority / drift-fallback track without new Phase F comparison implementation work.

This document is docs-only and review-only. It does not authorize or implement PostgreSQL serving, new comparison scaffolding, or endpoint contract changes for `GET /api/v1/portfolio/accounts`.

## Current Accounts-List Runtime Posture

The current runtime shape is already materially different from the accepted Phase F comparison-only list lines.

Current path:

- endpoint: `GET /api/v1/portfolio/accounts`
- endpoint handler: `list_accounts(...)`
- service path: `PortfolioService.list_accounts(...)`
- legacy repo path: `PortfolioRepo.list_accounts(...)`
- response schema: `PortfolioAccountListResponse`

Current behavior, grounded in the service and tests, is:

- the service first attempts to satisfy the read from trusted Phase F account metadata
- when that trusted metadata is available, the service does not need the legacy repo list path
- when metadata authority drifts, the service falls back to the legacy repo list path
- owner scope is already enforced through the existing service/repo path
- `include_inactive` is already part of the current runtime contract

That means the current runtime posture is already:

- conservative
- service-owned
- trust-then-fallback
- metadata-oriented

It is not an empty comparison line waiting for new comparison wiring.

## Why This Surface Is Different From Event-History List Candidates

Accounts-list is not a clean continuation of:

- trades-list
- cash-ledger
- corporate-actions

Those accepted lines are all event-history list candidates with request-local comparison behavior over legacy-served event payloads.

Accounts-list differs in several important ways:

- it is metadata, not event-history payload
- it has no pagination contract
- it has only one simple filter: `include_inactive`
- it already sits near an authority / trust decision rather than an event-list comparison pass
- its current tests are framed around trusted metadata usage and legacy fallback, not around new comparison diagnostics

That makes it a qualified candidate at most, not a natural next implementation continuation of the existing comparison-only pattern.

## Evidence For Treating It As Metadata-Authority-Adjacent

The current code and tests already provide reviewer-visible evidence that accounts-list belongs to the metadata-authority / drift-fallback track:

- `PortfolioService.list_accounts(...)` first asks the database layer for Phase F account metadata rows
- only when that metadata surface is unavailable or untrusted does it fall back to `PortfolioRepo.list_accounts(...)`
- focused tests already prove that trusted metadata can satisfy the read path without hitting the legacy repo
- focused tests already prove that drift causes a controlled fallback back to legacy
- real-PG validation already proves that the trusted metadata-backed path can serve successfully in a real local PG setup

The most relevant reviewer takeaway is not “a new comparison-only implementation is missing.”

The more accurate takeaway is:

- the runtime already has a trust-and-fallback posture
- that posture is already the meaningful Phase F behavior for this surface

## What A Tiny Metadata Parity Review Would Mean

A tiny metadata parity review would be acceptable only if it stays review-only and explicitly avoids new runtime work.

That tiny review would mean:

- documenting the exact field surface of `PortfolioAccountItem`
- documenting the exact request surface:
  - owner scope
  - `include_inactive=false`
  - `include_inactive=true`
- documenting the current trusted-metadata success case
- documenting the current drift-triggered legacy fallback case
- documenting that this is still not PG serving readiness

What it would not mean:

- new comparison scaffolding
- new comparison config flags
- new request-local comparison diagnostics
- new PG-vs-legacy dual-read logic for accounts-list
- new serving-mode rollout logic

So the only acceptable “tiny review surface” here is a reviewer checkpoint that explains the current authority/fallback behavior more clearly.

## What Staying On The Metadata-Authority / Drift-Fallback Track Would Mean

Keeping accounts-list on the existing metadata-authority / drift-fallback track means:

- no new Phase F comparison implementation work for this endpoint
- no attempt to force accounts-list into the event-history comparison template
- no new comparison-only wiring owned beside `PortfolioService.list_accounts(...)`
- no new generic infrastructure to make metadata surfaces look like event-list comparison surfaces

It also means the current runtime posture remains the intended posture:

- trusted Phase F metadata may satisfy the read
- legacy fallback remains the safety mechanism when authority drifts
- legacy remains the only serving source for the already validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness

That is a tighter and more accurate fit for this endpoint than inventing another comparison-only implementation lane.

## Recommended Decision

The recommendation is:

- do not proceed with new Phase F comparison implementation work for `GET /api/v1/portfolio/accounts`
- keep this surface on the existing metadata-authority / drift-fallback track
- allow, at most, one very small reviewer-facing metadata parity note if additional clarification is needed later

This recommendation is grounded in the current code and tests:

- the runtime already has the important behavior
- the important behavior is authority selection plus legacy fallback
- the remaining reviewer value is clarification, not new comparison plumbing

So accounts-list should not be treated as a true new Phase F comparison-only implementation candidate in the same sense as trades-list, cash-ledger, or corporate-actions.

## What Should Explicitly Not Happen Next

The following should explicitly not happen next:

- no accounts-list comparison scaffolding
- no accounts-list PG comparison candidate loader
- no accounts-list request-local comparison diagnostics
- no PG serving for accounts-list
- no attempt to use this endpoint as justification for broader metadata cutover
- no replay or snapshot expansion from this decision
- no generic repo-wide comparison infrastructure
- no second master index document

If any future step is taken here, it should be documentation-only and narrowly bounded to explaining the existing authority/fallback posture.

## Reviewer Conclusion

Accounts-list is best understood as:

- a metadata-authority-adjacent surface
- already carrying the right conservative runtime posture
- not worth new Phase F comparison implementation work

The correct reviewer decision is therefore:

- keep `GET /api/v1/portfolio/accounts` under the existing metadata-authority / drift-fallback track
- do not proceed with new comparison implementation work
- allow only a very small reviewer/checkpoint note if future clarification is needed

This preserves the current guardrails:

- legacy remains the only serving source on the validated comparison-only lines
- this is not PG serving readiness
- this is not broader cutover readiness
- this should not be used to justify broader cutover or generic infrastructure work
