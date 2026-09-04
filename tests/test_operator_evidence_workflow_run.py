from __future__ import annotations

import json
import hashlib
import subprocess
import sys
from pathlib import Path

from tests.test_operator_evidence_bundle_check import _accepted_artifacts


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "operator_evidence_workflow_run.py"

EXPECTED_TEMPLATE_FILES = {
    "candidate_binding_operator_evidence.json",
    "api_abuse_safety_evidence.json",
    "provider_operator_evidence.json",
    "provider_sla_licensing_evidence.json",
    "notification_delivery_rehearsal_evidence.json",
    "restore_pitr_operator_evidence.json",
    "security_operator_acceptance.json",
    "quota_budget_operator_evidence.json",
    "staging_ingress_operator_evidence.json",
    "ws2_target_environment_evidence.json",
    "ws2_sse_operator_decision_evidence.json",
    "config_snapshot_evidence.json",
    "manual_release_approval_review_record.json",
}

FORBIDDEN_PHRASES = (
    "launch-approved",
    "production-ready",
    "automatic-go",
    "automatic go",
)


def _run(*args: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def _init_templates(path: Path) -> subprocess.CompletedProcess[str]:
    return _run("init", "--output-dir", path)


def _read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def _bind_candidate(artifact_dir: Path, candidate_sha: str, candidate_tree: str) -> None:
    binding_path = artifact_dir / "candidate_binding_operator_evidence.json"
    binding = _read_json(binding_path)
    binding.update(
        {
            "candidateSha": candidate_sha,
            "candidateTree": candidate_tree,
            "observationRef": "operator-run-123",
            "artifactDigests": {
                path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(artifact_dir.glob("*.json"))
                if path.name != binding_path.name
            },
            "outcome": "accepted",
        }
    )
    binding.pop("templatePlaceholders", None)
    binding_path.write_text(json.dumps(binding), encoding="utf-8")


def _write_accepted_bundle(artifact_dir: Path, candidate_sha: str, candidate_tree: str) -> None:
    artifact_dir.mkdir()
    artifacts = _accepted_artifacts()
    manual_review = artifacts["manual_release_approval_review_record.json"]
    assert isinstance(manual_review, dict)
    manual_review["releaseCandidateSha"] = candidate_sha
    for filename, payload in artifacts.items():
        if filename == "candidate_binding_operator_evidence.json":
            continue
        (artifact_dir / filename).write_text(json.dumps(payload), encoding="utf-8")
    (artifact_dir / "candidate_binding_operator_evidence.json").write_text(
        json.dumps(
            {
                "schemaVersion": "wolfystock_operator_evidence_candidate_binding_v1",
                "candidateSha": candidate_sha,
                "candidateTree": candidate_tree,
                "observationRef": "operator-run-123",
                "capturedAt": "2026-05-08T10:30:00Z",
                "synthetic": False,
                "artifactDigests": {
                    path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in sorted(artifact_dir.glob("*.json"))
                    if path.name != "candidate_binding_operator_evidence.json"
                },
                "outcome": "accepted",
            }
        ),
        encoding="utf-8",
    )


def _assert_forbidden_phrases_absent(text: str) -> None:
    lowered = text.lower()
    for phrase in FORBIDDEN_PHRASES:
        assert phrase not in lowered


def test_init_creates_all_templates(tmp_path: Path) -> None:
    output_dir = tmp_path / "templates"

    result = _init_templates(output_dir)

    assert result.returncode == 0, result.stderr
    assert {path.name for path in output_dir.glob("*.json")} == EXPECTED_TEMPLATE_FILES


def test_check_on_complete_sanitized_fixture_produces_review_required_report(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    assert _init_templates(artifact_dir).returncode == 0
    expected_candidate_sha = "a" * 40
    expected_candidate_tree = "c" * 40
    manual_review_path = artifact_dir / "manual_release_approval_review_record.json"
    manual_review = _read_json(manual_review_path)
    manual_review["releaseCandidateSha"] = expected_candidate_sha
    manual_review_path.write_text(json.dumps(manual_review), encoding="utf-8")
    output_dir = tmp_path / "workflow-output"

    result = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        output_dir,
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )

    assert result.returncode == 11
    bundle = _read_json(output_dir / "bundle-summary.json")
    assert bundle["candidateBinding"]["status"] == "fail"
    assert "candidate_binding_sha_mismatch" in bundle["candidateBinding"]["reasonCodes"]

    # A complete binding still rejects unresolved template artifacts.
    _bind_candidate(artifact_dir, expected_candidate_sha, expected_candidate_tree)
    template_rejected = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        output_dir,
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )

    assert template_rejected.returncode == 11
    template_bundle = _read_json(output_dir / "bundle-summary.json")
    assert "candidate_binding_template_artifact_present" in template_bundle["candidateBinding"]["reasonCodes"]

    artifact_dir = tmp_path / "accepted-artifacts"
    _write_accepted_bundle(artifact_dir, expected_candidate_sha, expected_candidate_tree)
    result = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        output_dir,
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )

    assert result.returncode == 0, result.stderr
    bundle = _read_json(output_dir / "bundle-summary.json")
    manifest = _read_json(output_dir / "evidence-manifest.json")
    report = (output_dir / "release-review-report.md").read_text(encoding="utf-8")
    assert bundle["bundleStatus"] == "complete-review-required"
    assert bundle["candidateBinding"]["status"] == "pass"
    assert manifest["schemaVersion"] == "wolfystock_operator_evidence_manifest_v1"
    assert "Manual operator review is required before any release decision." in report
    assert "complete-review-required" in report
    assert "rawArtifactBodiesIncluded" not in report

    binding_path = artifact_dir / "candidate_binding_operator_evidence.json"
    binding = _read_json(binding_path)
    binding["observationRef"] = "synthetic-run-123"
    binding_path.write_text(json.dumps(binding), encoding="utf-8")
    synthetic_binding = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        tmp_path / "synthetic-binding-output",
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )
    assert synthetic_binding.returncode == 11
    synthetic_bundle = _read_json(tmp_path / "synthetic-binding-output" / "bundle-summary.json")
    assert "candidate_binding_observation_ref_not_observed" in synthetic_bundle["candidateBinding"]["reasonCodes"]

    binding = _read_json(binding_path)
    binding["observationRef"] = "provider-unavailable"
    binding_path.write_text(json.dumps(binding), encoding="utf-8")
    unavailable_binding = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        tmp_path / "unavailable-binding-output",
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )
    assert unavailable_binding.returncode == 11
    unavailable_bundle = _read_json(tmp_path / "unavailable-binding-output" / "bundle-summary.json")
    assert "candidate_binding_observation_ref_not_observed" in unavailable_bundle["candidateBinding"]["reasonCodes"]

    binding = _read_json(binding_path)
    binding["observationRef"] = "operator-run-123"
    binding["candidateSha"] = "b" * 40
    binding_path.write_text(json.dumps(binding), encoding="utf-8")
    mismatch = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        tmp_path / "mismatch-output",
        "--expected-candidate-sha",
        expected_candidate_sha,
        "--expected-candidate-tree",
        expected_candidate_tree,
    )

    assert mismatch.returncode == 11
    assert "candidate_binding_sha_mismatch" in mismatch.stderr


def test_missing_artifact_exits_non_zero(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    assert _init_templates(artifact_dir).returncode == 0
    (artifact_dir / "quota_budget_operator_evidence.json").unlink()

    result = _run("check", "--artifact-dir", artifact_dir, "--output-dir", tmp_path / "output")

    assert result.returncode != 0
    bundle = _read_json(tmp_path / "output" / "bundle-summary.json")
    assert bundle["bundleStatus"] == "incomplete-no-go"
    assert "required_artifact_missing" in result.stderr


def test_candidate_binding_rejects_tree_and_manifest_digest_mismatches(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    assert _init_templates(artifact_dir).returncode == 0
    candidate_sha = "a" * 40
    candidate_tree = "c" * 40
    _bind_candidate(artifact_dir, candidate_sha, candidate_tree)
    binding_path = artifact_dir / "candidate_binding_operator_evidence.json"
    binding = _read_json(binding_path)
    binding["candidateTree"] = "d" * 40
    binding_path.write_text(json.dumps(binding), encoding="utf-8")

    tree_mismatch = _run(
        "check", "--artifact-dir", artifact_dir, "--output-dir", tmp_path / "tree-output",
        "--expected-candidate-sha", candidate_sha, "--expected-candidate-tree", candidate_tree,
    )

    assert tree_mismatch.returncode == 11
    assert "candidate_binding_tree_mismatch" in tree_mismatch.stderr

    _bind_candidate(artifact_dir, candidate_sha, candidate_tree)
    binding = _read_json(binding_path)
    digests = binding["artifactDigests"]
    assert isinstance(digests, dict)
    digests["provider_operator_evidence.json"] = "0" * 64
    binding_path.write_text(json.dumps(binding), encoding="utf-8")
    digest_mismatch = _run(
        "check", "--artifact-dir", artifact_dir, "--output-dir", tmp_path / "digest-output",
        "--expected-candidate-sha", candidate_sha, "--expected-candidate-tree", candidate_tree,
    )

    assert digest_mismatch.returncode == 11
    assert "candidate_binding_artifact_digests_mismatch" in digest_mismatch.stderr


def test_candidate_binding_rejects_embedded_unresolved_marker(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "accepted-artifacts"
    output_dir = tmp_path / "workflow-output"
    candidate_sha = "a" * 40
    candidate_tree = "c" * 40
    _write_accepted_bundle(artifact_dir, candidate_sha, candidate_tree)
    binding_path = artifact_dir / "candidate_binding_operator_evidence.json"
    binding = _read_json(binding_path)
    binding["observationRef"] = "operator-<pending-review>"
    binding_path.write_text(json.dumps(binding), encoding="utf-8")

    result = _run(
        "check",
        "--artifact-dir",
        artifact_dir,
        "--output-dir",
        output_dir,
        "--expected-candidate-sha",
        candidate_sha,
        "--expected-candidate-tree",
        candidate_tree,
    )

    assert result.returncode == 11
    bundle = _read_json(output_dir / "bundle-summary.json")
    assert "candidate_binding_placeholder_rejected" in bundle["candidateBinding"]["reasonCodes"]


def test_rejected_artifact_exits_non_zero(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    assert _init_templates(artifact_dir).returncode == 0
    provider_path = artifact_dir / "provider_operator_evidence.json"
    provider_path.write_text("{not json", encoding="utf-8")

    result = _run("check", "--artifact-dir", artifact_dir, "--output-dir", tmp_path / "output")

    assert result.returncode != 0
    bundle = _read_json(tmp_path / "output" / "bundle-summary.json")
    assert bundle["bundleStatus"] == "rejected-no-go"
    assert "artifact_read_failed" in result.stderr


def test_unsafe_marker_detection_exits_with_dedicated_code(tmp_path: Path) -> None:
    unsafe_value = "raw-secret-token=sk-live-should-not-leak"
    artifact_dir = tmp_path / "artifacts"
    assert _init_templates(artifact_dir).returncode == 0
    provider_path = artifact_dir / "provider_operator_evidence.json"
    provider = _read_json(provider_path)
    provider["api_key"] = unsafe_value
    provider_path.write_text(json.dumps(provider), encoding="utf-8")

    result = _run("check", "--artifact-dir", artifact_dir, "--output-dir", tmp_path / "output")

    assert result.returncode == 13
    combined = result.stdout + result.stderr + (tmp_path / "output" / "bundle-summary.json").read_text(
        encoding="utf-8"
    )
    assert "unsafe marker detection" in result.stderr
    assert "unsafe_marker" in combined
    assert unsafe_value not in combined


def test_report_output_contains_no_raw_unsafe_marker_values(tmp_path: Path) -> None:
    unsafe_value = "raw-secret-token=sk-live-should-not-leak"
    bundle_summary = tmp_path / "bundle-summary.json"
    bundle_summary.write_text(
        json.dumps(
            {
                "schemaVersion": "wolfystock_operator_evidence_bundle_summary_v1",
                "generatedAt": "2026-05-08T10:30:00+00:00",
                "artifactDirectoryLabel": "operator-bundle",
                "bundleStatus": "rejected-no-go",
                "runtimeBehaviorChanged": False,
                "networkCallsExecutedByValidator": False,
                "rawArtifactBodiesIncluded": False,
                "artifacts": [
                    {
                        "category": unsafe_value,
                        "pathLabel": "../session-cookie-dump.json",
                        "status": "rejected",
                        "validatorName": "traceback_secret_validator.py",
                        "blockingReasonSummaries": [unsafe_value, "stack trace contains password"],
                    }
                ],
                "advisories": [],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "release-review-report.md"

    result = _run("report", "--bundle-summary", bundle_summary, "--output", output)

    assert result.returncode != 0
    combined = result.stdout + result.stderr + output.read_text(encoding="utf-8")
    assert unsafe_value not in combined
    assert "session-cookie" not in combined
    assert "traceback" not in combined.lower()
    assert "password" not in combined.lower()
    assert "[redacted]" in combined


def test_runner_never_emits_approval_phrases(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts"
    output_dir = tmp_path / "workflow-output"
    init_result = _init_templates(artifact_dir)
    check_result = _run("check", "--artifact-dir", artifact_dir, "--output-dir", output_dir)
    report_result = _run(
        "report",
        "--bundle-summary",
        output_dir / "bundle-summary.json",
        "--output",
        tmp_path / "report-only.md",
    )

    combined = (
        init_result.stdout
        + init_result.stderr
        + check_result.stdout
        + check_result.stderr
        + report_result.stdout
        + report_result.stderr
        + (output_dir / "bundle-summary.json").read_text(encoding="utf-8")
        + (output_dir / "release-review-report.md").read_text(encoding="utf-8")
        + (tmp_path / "report-only.md").read_text(encoding="utf-8")
    )
    assert init_result.returncode == 0
    assert check_result.returncode == 0
    assert report_result.returncode == 0
    _assert_forbidden_phrases_absent(combined)
