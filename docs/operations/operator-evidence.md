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

The manual `Release Operator Evidence Producer` workflow is the only repository
producer for the `release-operator-evidence-<candidate-sha>` Actions artifact.
It packages evidence for the release workflow; it has no deployment or
promotion step.

Before dispatch, a repository administrator must protect the
`operator-evidence-staging` GitHub environment, attach an authorized
Linux `operator-evidence-staging` self-hosted runner, and configure its
`OPERATOR_EVIDENCE_DIR` environment variable to a staging-owned sanitized
evidence inbox. The workflow refuses to run when that boundary is unavailable.
Do not set this variable to a raw-evidence, credential, or log location.

An authorized staging operator prepares the twelve canonical files in that
inbox, including a `manual_release_approval_review_record.json` whose
`releaseCandidateSha` is the full candidate SHA. The operator must use the
sanitizer's `scan --fail-on-findings` path for every input before dispatch; the
workflow repeats that scan and copies only the filenames from the canonical
bundle specification. Missing, unsafe, invalid, or SHA-mismatched inputs stop
before upload. The generated manifest, bundle summary, and review report are
validation outputs, not target-environment evidence.

Dispatch the workflow from the default branch with the full candidate SHA that
is already on `origin/main`. After the protected staging job succeeds, copy its
`operator_evidence_run_id` from the Actions job summary into the
`operator_evidence_run_id` input of `Qualified Immutable Release Promotion`.
The release workflow downloads the exact SHA-bound artifact and independently
rechecks the bundle and candidate binding. A successful producer run remains
manual-review evidence only; absent real staging observations remains
EXTERNAL_NOT_QUALIFIED.

## Report Rendering

Render a human-review report from the sanitized bundle summary:

```bash
python3 scripts/operator_evidence_workflow_run.py report --bundle-summary <review-output-dir>/bundle-summary.json --output <review-output-dir>/release-review-report.md
```

The report preserves NO-GO or incomplete states and remains subject to manual
review. It is not durable architecture documentation.
