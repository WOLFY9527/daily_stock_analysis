# Operator Evidence

> Status: Canonical runbook
> Scope: sanitized, offline operator-evidence preparation and manual review
> Audience: operators, release reviewers, and maintainers of evidence tooling

Operator evidence supports manual review. It does not make a deployment,
release, or launch decision. Executable script help and validators define the
accepted command and artifact contracts.

## CLI Contract

Repository-owned offline helpers:

- `scripts/operator_evidence_preflight.py`
- `scripts/operator_evidence_workflow_smoke.py`
- `scripts/operator_evidence_workflow_run.py`
- `scripts/operator_evidence_schema_reference.py`
- `scripts/operator_evidence_archive_pack.py`
- `scripts/operator_evidence_gap_analyzer.py`
- `scripts/operator_evidence_bundle_diff.py`
- `scripts/evidence_artifact_sanitize.py`

Inspect a command before preparing evidence:

```bash
python3 scripts/operator_evidence_preflight.py --help
python3 scripts/operator_evidence_workflow_smoke.py --help
python3 scripts/operator_evidence_workflow_run.py --help
python3 scripts/operator_evidence_schema_reference.py --help
python3 scripts/operator_evidence_archive_pack.py --help
python3 scripts/operator_evidence_gap_analyzer.py --help
python3 scripts/operator_evidence_bundle_diff.py --help
python3 scripts/evidence_artifact_sanitize.py --help
```

## Dry-Run Handoff

Create blank local templates, then inspect them before any evidence is added:

```bash
python3 scripts/operator_evidence_workflow_run.py init --output-dir <templates-dir>
python3 scripts/operator_evidence_workflow_smoke.py --help
```

Synthetic or dry-run material remains synthetic. It cannot qualify a real
target environment.

## Redaction

Evidence inputs and reports must exclude credentials, cookies, sessions,
private URLs, private local paths, provider payloads, database bodies,
request/response bodies, and raw logs. Use presence states, hashes, bounded
summaries, and validator-produced reason codes.

Sanitize a task-owned artifact through the repository helper and inspect its
result before inclusion:

```bash
python3 scripts/evidence_artifact_sanitize.py --help
```

## Schema Reference

Render the repository-owned schema reference instead of inventing field names
in a hand-written report:

```bash
python3 scripts/operator_evidence_schema_reference.py --help
```

Missing fields, invalid fields, not-run checks, and rejected evidence remain
distinct states. A schema-valid artifact still requires the applicable
semantic and target-environment review.

## Review Package

Check a sanitized directory, compare bundles when required, and package only
the reviewed outputs:

```bash
python3 scripts/operator_evidence_workflow_run.py check --artifact-dir <sanitized-evidence-dir> --output-dir <review-output-dir>
python3 scripts/operator_evidence_bundle_diff.py --help
python3 scripts/operator_evidence_archive_pack.py --help
```

Archive packaging is an operator evidence bundle operation, not permission to
create a documentation archive lane. Temporary evidence retirement follows
[`docs/audits/README.md`](../audits/README.md) and the documentation manifest.

## Release Actions Handoff

The public repository has no repository-level self-hosted operator-evidence
producer. Do not register a self-hosted runner for this repository, including a
runner carrying the `operator-evidence-staging` label. A fork pull request can
propose workflow changes that select repository runner labels without using the
protected environment. Environment branch policy, manual workflow approval,
custom labels, and one-job registration do not isolate a staging inbox from
that repository-wide runner selection boundary.

Keep the protected `operator-evidence-staging` environment and its
`OPERATOR_EVIDENCE_DIR` variable in place, but leave the environment runnerless.
The variable must continue to identify only a staging-owned sanitized evidence
inbox, never raw evidence, credentials, provider payloads, or logs.

The qualified external producer trust anchor is intentionally immutable:

- private repository `WOLFY9527/wolfystock-operator-evidence`, numeric repository
  ID `1335331928`;
- workflow `.github/workflows/isolated-operator-evidence-producer.yml`;
- workflow/head commit `bc5b6af9d6038931a9df52f6f0a67887270c8b23`.

Any producer change requires explicit requalification and a public consumer
trust-anchor update. Dispatch accepts only the explicit immutable
`operator_evidence_run_id` and `operator_evidence_artifact_id`; it never searches
for a latest run, newest artifact, mutable branch result, or friendly artifact
name alone. Candidate identity still comes from the annotated release tag and
the release identity job.

The `release-approval` environment must provide one
`OPERATOR_EVIDENCE_READ_TOKEN` secret. Its credential must be scoped only to
`WOLFY9527/wolfystock-operator-evidence` with repository `Actions: read` and no
Contents, Actions write, release, deployment, package, administration, or
producer mutation authority. The native public-repository `GITHUB_TOKEN` has no
cross-repository authority and is not a substitute.

The credential is injected only into the authenticated fetch step. That step
verifies repository visibility and identity, run/workflow/head identity,
artifact association/name/expiry/size/API digest, and independently hashes the
downloaded ZIP. The following validation step has no private credential. It
safely inspects the two-member ZIP and canonical tar, validates the exact
production provenance allowlist and candidate/run/digest agreement, discovers
membership from the candidate's runtime `ARTIFACT_SPECS`, and reruns the
candidate sanitizer, bundle checker, and workflow checker with a projected
secret-free subprocess environment.

Raw ZIP, tar, provenance, and operator JSON remain only in the disposable job
work root and are removed after gate derivation. They are never uploaded by the
public workflow. Only the bounded canonical `operator-evidence.json` release
gate record crosses to the qualification job. Missing credential or inputs,
API failure, synthetic artifact, expiry, unsafe archive, provenance mismatch,
candidate mismatch, or validator rejection leaves the initialized gate at FAIL
and release at NO-GO. Producer success never supplies manual reviewer approval
and never determines release GO.

The synthetic qualification smoke run `31923336452` and artifact `9257055688`
are negative contract evidence only. Their synthetic artifact name and marker
must be rejected by the production consumer.

### Post-LAND live qualification

After this consumer is on the public default branch:

1. Configure `release-approval` as a main-only environment without required
   reviewers or `prevent_self_review`.
2. Add `OPERATOR_EVIDENCE_READ_TOKEN` as an environment secret using a
   single-repository, `Actions: read` credential for the private producer.
3. Produce a real production artifact from the pinned private producer commit
   for the exact annotated-tag candidate; do not use the synthetic smoke run.
4. Record the explicit successful producer run ID and exact production artifact
   ID, then have the repository owner explicitly dispatch the public release
   workflow from `main` for the annotated tag with those two IDs.
5. Verify the consumer job's first attempt, the bounded gate artifact, all
   twelve release gates, explicit maintainer authorization, final candidate and
   tree identity, and remote promotion identity before any release decision.

No real production handoff is qualified yet. The public candidate contract
permits exact structural safety metadata only when its value proves the stated
absence or redaction posture; nested values remain subject to recursive strict
sanitization. Safe labels remain distinct from endpoint URLs. This reconciled
local sanitizer/validator contract still requires a fresh candidate-bound real
producer artifact, credentialed consumer handoff, all release gates, and
explicit maintainer authorization before real release qualification.

## Report Rendering

Render a human-review report from the sanitized bundle summary:

```bash
python3 scripts/operator_evidence_workflow_run.py report --bundle-summary <review-output-dir>/bundle-summary.json --output <review-output-dir>/release-review-report.md
```

The report preserves NO-GO or incomplete states and remains subject to manual
review. It is not durable architecture documentation.
