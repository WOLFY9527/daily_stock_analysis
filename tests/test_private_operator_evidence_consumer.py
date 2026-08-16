from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import Any

import pytest
import yaml

from scripts import private_operator_evidence_consumer as consumer


REPO_ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_SHA = "4a1ea901c31af160716cfb34bc1c651de64be694"
CANDIDATE_TREE = "60331321aa4c50ca463d7e743c1052963a0a796f"
RUN_ID = 31923336452
RUN_ATTEMPT = 1
ARTIFACT_ID = 9257055688
WORKFLOW_ID = 335320325


class FakeApi:
    def __init__(self, responses: dict[str, Any], archive: bytes) -> None:
        self.responses = responses
        self.archive = archive

    def get_json(self, endpoint: str) -> Any:
        return copy.deepcopy(self.responses[endpoint])

    def download_artifact(self, artifact_id: int) -> bytes:
        assert artifact_id == ARTIFACT_ID
        return self.archive


def _repository(*, repository_id: int = consumer.PRODUCER_REPOSITORY_ID) -> dict[str, Any]:
    return {
        "id": repository_id,
        "full_name": consumer.PRODUCER_REPOSITORY_NAME,
        "private": True,
        "visibility": "private",
    }


def _run_payload() -> dict[str, Any]:
    nested = {
        "id": consumer.PRODUCER_REPOSITORY_ID,
        "full_name": consumer.PRODUCER_REPOSITORY_NAME,
        "private": True,
    }
    return {
        "id": RUN_ID,
        "run_attempt": RUN_ATTEMPT,
        "status": "completed",
        "conclusion": "success",
        "event": "workflow_dispatch",
        "head_branch": "main",
        "head_sha": consumer.TRUSTED_PRODUCER_COMMIT,
        "path": consumer.PRODUCER_WORKFLOW_PATH,
        "workflow_id": WORKFLOW_ID,
        "repository": nested,
        "head_repository": dict(nested),
    }


def _artifact_payload(archive: bytes) -> dict[str, Any]:
    return {
        "id": ARTIFACT_ID,
        "name": consumer._expected_artifact_name(CANDIDATE_SHA, RUN_ID, RUN_ATTEMPT),
        "expired": False,
        "size_in_bytes": len(archive),
        "digest": "sha256:" + hashlib.sha256(archive).hexdigest(),
        "workflow_run": {
            "id": RUN_ID,
            "repository_id": consumer.PRODUCER_REPOSITORY_ID,
            "head_repository_id": consumer.PRODUCER_REPOSITORY_ID,
            "head_branch": "main",
            "head_sha": consumer.TRUSTED_PRODUCER_COMMIT,
        },
    }


def _responses(archive: bytes) -> dict[str, Any]:
    artifact = _artifact_payload(archive)
    return {
        f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}": _repository(),
        f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/runs/{RUN_ID}": _run_payload(),
        f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/workflows/{WORKFLOW_ID}": {
            "id": WORKFLOW_ID,
            "path": consumer.PRODUCER_WORKFLOW_PATH,
        },
        f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/artifacts/{ARTIFACT_ID}": artifact,
        (
            f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/runs/{RUN_ID}/artifacts"
            f"?per_page={consumer.ARTIFACTS_PER_PAGE}&page=1"
        ): {"total_count": 1, "artifacts": [artifact]},
    }


def _fetch(tmp_path: Path, responses: dict[str, Any], archive: bytes) -> Path:
    work_root = tmp_path / f"t707-operator-evidence-{RUN_ID}"
    consumer.fetch_handoff(
        api=FakeApi(responses, archive),
        candidate_sha=CANDIDATE_SHA,
        run_id=RUN_ID,
        artifact_id=ARTIFACT_ID,
        work_root=work_root,
        runner_temp=tmp_path,
    )
    return work_root


def _zip_bytes(entries: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, body in entries:
            archive.writestr(name, body)
    return buffer.getvalue()


def _provenance(bundle: bytes) -> dict[str, Any]:
    return {
        "publicRepositoryIdentity": {
            "nameWithOwner": consumer.PUBLIC_REPOSITORY_NAME,
            "repositoryId": consumer.PUBLIC_REPOSITORY_ID,
        },
        "candidateSha": CANDIDATE_SHA,
        "candidateTree": CANDIDATE_TREE,
        "producerRepositoryIdentity": {
            "nameWithOwner": consumer.PRODUCER_REPOSITORY_NAME,
            "repositoryId": consumer.PRODUCER_REPOSITORY_ID,
        },
        "producerWorkflowIdentity": consumer.EXPECTED_PRODUCER_WORKFLOW_IDENTITY,
        "runId": RUN_ID,
        "runAttempt": RUN_ATTEMPT,
        "event": "workflow_dispatch",
        "ref": "refs/heads/main",
        "sourceIngressAssetSha256": "1" * 64,
        "canonicalBundleSha256": hashlib.sha256(bundle).hexdigest(),
        "validatorResult": consumer.EXPECTED_VALIDATOR_RESULT,
        "generatedAt": "2026-08-16T00:00:00Z",
    }


def _transport(archive: bytes) -> dict[str, Any]:
    return consumer._transport_record(
        consumer.RunIdentity(RUN_ID, RUN_ATTEMPT, WORKFLOW_ID),
        consumer.ArtifactIdentity(
            ARTIFACT_ID,
            consumer._expected_artifact_name(CANDIDATE_SHA, RUN_ID, RUN_ATTEMPT),
            len(archive),
            "sha256:" + hashlib.sha256(archive).hexdigest(),
        ),
    )


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("id", consumer.PRODUCER_REPOSITORY_ID + 1),
        ("full_name", "WOLFY9527/not-the-producer"),
        ("private", False),
        ("visibility", "public"),
    ),
)
def test_fetch_rejects_wrong_producer_repository_identity_or_visibility(
    tmp_path: Path, field: str, value: Any
) -> None:
    archive = b"archive"
    responses = _responses(archive)
    responses[f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}"][field] = value

    with pytest.raises(consumer.ConsumerViolation, match="producer_repository_identity_mismatch"):
        _fetch(tmp_path, responses, archive)


@pytest.mark.parametrize(
    ("field", "value", "reason"),
    (
        ("id", RUN_ID + 1, "producer_run_id_mismatch"),
        ("status", "in_progress", "producer_run_not_completed"),
        ("conclusion", "failure", "producer_run_not_successful"),
        ("event", "push", "producer_run_event_mismatch"),
        ("head_branch", "feature", "producer_run_ref_mismatch"),
        ("path", ".github/workflows/other.yml", "producer_workflow_path_mismatch"),
        ("head_sha", "f" * 40, "producer_commit_mismatch"),
        ("run_attempt", 0, "producer_run_attempt_invalid"),
    ),
)
def test_fetch_rejects_wrong_run_event_ref_conclusion_workflow_or_commit(
    tmp_path: Path, field: str, value: Any, reason: str
) -> None:
    archive = b"archive"
    responses = _responses(archive)
    responses[f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/runs/{RUN_ID}"][field] = value

    with pytest.raises(consumer.ConsumerViolation, match=reason):
        _fetch(tmp_path, responses, archive)


@pytest.mark.parametrize(
    ("mutation", "reason"),
    (
        (("id", ARTIFACT_ID + 1), "producer_artifact_id_mismatch"),
        (("expired", True), "producer_artifact_expired"),
        (("digest", None), "artifact_api_digest_invalid"),
        (("digest", "sha256:not-a-digest"), "artifact_api_digest_invalid"),
    ),
)
def test_fetch_rejects_wrong_expired_or_digestless_artifact(
    tmp_path: Path, mutation: tuple[str, Any], reason: str
) -> None:
    archive = b"archive"
    responses = _responses(archive)
    artifact = responses[f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/artifacts/{ARTIFACT_ID}"]
    artifact[mutation[0]] = mutation[1]

    with pytest.raises(consumer.ConsumerViolation, match=reason):
        _fetch(tmp_path, responses, archive)


def test_fetch_rejects_wrong_run_association_and_duplicate_production_name(tmp_path: Path) -> None:
    archive = b"archive"
    responses = _responses(archive)
    artifact_endpoint = f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/artifacts/{ARTIFACT_ID}"
    responses[artifact_endpoint]["workflow_run"]["id"] = RUN_ID + 1
    with pytest.raises(consumer.ConsumerViolation, match="artifact_run_association_invalid"):
        _fetch(tmp_path, responses, archive)

    responses = _responses(archive)
    listing_endpoint = next(endpoint for endpoint in responses if "?per_page=" in endpoint)
    duplicate = copy.deepcopy(responses[artifact_endpoint])
    duplicate["id"] = ARTIFACT_ID + 1
    responses[listing_endpoint] = {
        "total_count": 2,
        "artifacts": [responses[artifact_endpoint], duplicate],
    }
    with pytest.raises(consumer.ConsumerViolation, match="producer_artifact_association_not_unique"):
        _fetch(tmp_path, responses, archive)


def test_fetch_rejects_downloaded_digest_mismatch(tmp_path: Path) -> None:
    advertised = b"advertised"
    downloaded = b"downloaded"
    assert len(advertised) == len(downloaded)
    responses = _responses(advertised)

    with pytest.raises(consumer.ConsumerViolation, match="downloaded_artifact_digest_mismatch"):
        _fetch(tmp_path, responses, downloaded)


def test_fetch_rejects_synthetic_smoke_artifact_before_download(tmp_path: Path) -> None:
    archive = b"synthetic"
    responses = _responses(archive)
    artifact_endpoint = f"/repos/{consumer.PRODUCER_REPOSITORY_NAME}/actions/artifacts/{ARTIFACT_ID}"
    responses[artifact_endpoint]["name"] = (
        f"wolfystock-SYNTHETIC-boundary-smoke-{CANDIDATE_SHA}-{RUN_ID}-{RUN_ATTEMPT}"
    )

    with pytest.raises(consumer.ConsumerViolation, match="synthetic_artifact_rejected"):
        _fetch(tmp_path, responses, archive)


@pytest.mark.parametrize(
    "entries",
    (
        [("../provenance.json", b"{}"), (f"operator-evidence-{CANDIDATE_SHA}.tar", b"tar")],
        [("nested/provenance.json", b"{}"), (f"operator-evidence-{CANDIDATE_SHA}.tar", b"tar")],
        [("provenance.json", b"{}")],
        [
            ("provenance.json", b"{}"),
            (f"operator-evidence-{CANDIDATE_SHA}.tar", b"tar"),
            ("extra.json", b"{}"),
        ],
    ),
)
def test_handoff_zip_rejects_traversal_nested_missing_or_extra_members(
    entries: list[tuple[str, bytes]],
) -> None:
    with pytest.raises(consumer.ConsumerViolation):
        consumer._inspect_handoff_zip(_zip_bytes(entries), candidate_sha=CANDIDATE_SHA)


def test_handoff_zip_rejects_duplicate_members() -> None:
    entries = [
        ("provenance.json", b"{}"),
        ("provenance.json", b"{}"),
        (f"operator-evidence-{CANDIDATE_SHA}.tar", b"tar"),
    ]
    with pytest.warns(UserWarning, match="Duplicate name"):
        payload = _zip_bytes(entries)
    with pytest.raises(consumer.ConsumerViolation, match="handoff_zip_duplicate_member"):
        consumer._inspect_handoff_zip(payload, candidate_sha=CANDIDATE_SHA)


def test_production_provenance_requires_exact_allowlist_and_identity_agreement() -> None:
    bundle = b"canonical-bundle"
    provenance = _provenance(bundle)
    archive = _zip_bytes(
        [
            (f"operator-evidence-{CANDIDATE_SHA}.tar", bundle),
            ("provenance.json", json.dumps(provenance).encode()),
        ]
    )
    transport = _transport(archive)
    validated = consumer._validate_provenance(
        json.dumps(provenance).encode(),
        candidate_sha=CANDIDATE_SHA,
        candidate_tree=CANDIDATE_TREE,
        transport=transport,
        bundle=bundle,
    )
    assert validated["validatorResult"] == consumer.EXPECTED_VALIDATOR_RESULT

    for extra_or_missing in ({**provenance, "synthetic": True}, {k: v for k, v in provenance.items() if k != "generatedAt"}):
        with pytest.raises(consumer.ConsumerViolation, match="provenance_field_allowlist_mismatch"):
            consumer._validate_provenance(
                json.dumps(extra_or_missing).encode(),
                candidate_sha=CANDIDATE_SHA,
                candidate_tree=CANDIDATE_TREE,
                transport=transport,
                bundle=bundle,
            )


@pytest.mark.parametrize(
    ("field", "value", "reason"),
    (
        ("candidateSha", "f" * 40, "provenance_candidate_sha_mismatch"),
        ("candidateTree", "e" * 40, "provenance_candidate_tree_mismatch"),
        ("runId", RUN_ID + 1, "provenance_run_id_mismatch"),
        ("runAttempt", RUN_ATTEMPT + 1, "provenance_run_attempt_mismatch"),
        ("event", "push", "provenance_event_mismatch"),
        ("ref", "refs/heads/other", "provenance_ref_mismatch"),
        ("canonicalBundleSha256", "0" * 64, "provenance_bundle_digest_mismatch"),
        ("validatorResult", "synthetic-candidate-validators-pass", "provenance_validator_result_mismatch"),
    ),
)
def test_provenance_rejects_candidate_tree_run_bundle_and_validator_mismatches(
    field: str, value: Any, reason: str
) -> None:
    bundle = b"canonical-bundle"
    provenance = _provenance(bundle)
    provenance[field] = value
    archive = _zip_bytes(
        [
            (f"operator-evidence-{CANDIDATE_SHA}.tar", bundle),
            ("provenance.json", json.dumps(provenance).encode()),
        ]
    )
    with pytest.raises(consumer.ConsumerViolation, match=reason):
        consumer._validate_provenance(
            json.dumps(provenance).encode(),
            candidate_sha=CANDIDATE_SHA,
            candidate_tree=CANDIDATE_TREE,
            transport=_transport(archive),
            bundle=bundle,
        )


def test_candidate_subprocess_environment_excludes_private_read_token(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    observed: dict[str, str] = {}

    def fake_run(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        observed.update(kwargs["env"])
        return subprocess.CompletedProcess(args[0], 0, b"[]", b"")

    monkeypatch.setenv(consumer.PRIVATE_READ_TOKEN_ENV, "must-not-cross-boundary")
    monkeypatch.setattr(consumer.subprocess, "run", fake_run)
    consumer._run_candidate([sys.executable, "-c", "pass"], cwd=tmp_path)

    assert consumer.PRIVATE_READ_TOKEN_ENV not in observed
    assert set(observed) == {"PATH", "PYTHONDONTWRITEBYTECODE"}


def test_validate_handoff_preserves_strict_sanitizer_and_candidate_validator_ownership(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        consumer,
        "_candidate_git_value",
        lambda _root, expression: CANDIDATE_TREE if expression.endswith("^{tree}") else CANDIDATE_SHA,
    )
    fixture_root = REPO_ROOT / "tests/fixtures/operator_evidence/sanitized_complete"
    input_root = tmp_path / "bundle-input"
    input_root.mkdir()
    for source in fixture_root.glob("*.json"):
        payload = json.loads(source.read_text(encoding="utf-8"))
        if source.name == "manual_release_approval_review_record.json":
            payload["releaseCandidateSha"] = CANDIDATE_SHA
        (input_root / source.name).write_text(json.dumps(payload), encoding="utf-8")

    bundle_buffer = io.BytesIO()
    with tarfile.open(fileobj=bundle_buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for source in sorted(input_root.glob("*.json")):
            body = source.read_bytes()
            info = tarfile.TarInfo(source.name)
            info.size = len(body)
            archive.addfile(info, io.BytesIO(body))
    bundle = bundle_buffer.getvalue()
    provenance = _provenance(bundle)
    archive = _zip_bytes(
        [
            (f"operator-evidence-{CANDIDATE_SHA}.tar", bundle),
            ("provenance.json", json.dumps(provenance).encode()),
        ]
    )
    work_root = tmp_path / f"t707-operator-evidence-{RUN_ID}"
    work_root.mkdir()
    (work_root / consumer.WORK_ROOT_MARKER).write_text("marker", encoding="utf-8")
    (work_root / "handoff.zip").write_bytes(archive)
    (work_root / "transport.json").write_text(json.dumps(_transport(archive)), encoding="utf-8")

    consumer.validate_handoff(
        candidate_root=REPO_ROOT,
        candidate_sha=CANDIDATE_SHA,
        candidate_tree=CANDIDATE_TREE,
        run_id=RUN_ID,
        artifact_id=ARTIFACT_ID,
        work_root=work_root,
        runner_temp=tmp_path,
    )

    commands: list[list[str]] = []
    delegated_validation = tmp_path / "delegated-validation"

    def candidate_pass(
        arguments: list[str] | tuple[str, ...], *, cwd: Path, capture_output: bool = False
    ) -> subprocess.CompletedProcess[bytes]:
        command = list(arguments)
        commands.append(command)
        if any(value.endswith("operator_evidence_workflow_run.py") for value in command):
            (delegated_validation / "bundle-summary.json").write_text(
                json.dumps({"bundleStatus": "complete-review-required"}), encoding="utf-8"
            )
        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setattr(consumer, "_run_candidate", candidate_pass)
    names = frozenset(source.name for source in fixture_root.glob("*.json"))
    consumer._run_candidate_validators(
        candidate_root=REPO_ROOT,
        candidate_sha=CANDIDATE_SHA,
        input_directory=input_root,
        sanitized_directory=tmp_path / "delegated-sanitized",
        validation_directory=delegated_validation,
        expected_names=names,
    )

    flattened = "\n".join(" ".join(command) for command in commands)
    assert "evidence_artifact_sanitize.py" in flattened
    assert "--fail-on-findings" in flattened
    assert "operator_evidence_bundle_check.py" in flattened
    assert "operator_evidence_workflow_run.py" in flattened
    assert f"--expected-candidate-sha {CANDIDATE_SHA}" in flattened


def test_release_workflow_uses_least_privilege_bounded_fail_closed_handoff() -> None:
    workflow_path = REPO_ROOT / ".github/workflows/release.yml"
    workflow_text = workflow_path.read_text(encoding="utf-8")
    workflow = yaml.safe_load(workflow_text)
    inputs = workflow.get("on", workflow[True])["workflow_dispatch"]["inputs"]
    jobs = workflow["jobs"]
    job = jobs["operator-evidence-consumer"]

    assert set(inputs) == {
        "release_tag",
        "operator_evidence_run_id",
        "operator_evidence_artifact_id",
    }
    assert all(inputs[name]["required"] is True for name in inputs)
    assert job["permissions"] == {"actions": "read", "contents": "read"}
    assert job["environment"] == "release-approval"
    assert job["needs"] == ["identity", "build-candidate"]
    assert jobs["qualification"]["needs"] == [
        "release-authorization",
        "identity",
        "build-candidate",
        "operator-evidence-consumer",
    ]
    assert jobs["promotion-ready"]["needs"] == ["identity", "build-candidate", "qualification"]

    steps = job["steps"]
    fetch = next(step for step in steps if step.get("name") == "Fetch authenticated private operator-evidence handoff")
    validate = next(step for step in steps if step.get("name") == "Validate handoff with candidate-owned authorities")
    upload = next(step for step in steps if str(step.get("uses", "")).startswith("actions/upload-artifact@"))
    assert fetch["env"] == {
        consumer.PRIVATE_READ_TOKEN_ENV: "${{ secrets.OPERATOR_EVIDENCE_READ_TOKEN }}"
    }
    assert consumer.PRIVATE_READ_TOKEN_ENV not in validate.get("env", {})
    assert "${{ github.workflow_sha }}" in workflow_text
    assert upload["with"]["path"] == "output/operator-evidence-gate/operator-evidence.json"
    assert "handoff.zip" not in json.dumps(upload)
    assert "sanitized-evidence" not in json.dumps(upload)
    assert "operator-evidence-${CANDIDATE_SHA}.tar" not in workflow_text
    assert "latest run" not in json.dumps(job).lower()
    assert "newest artifact" not in json.dumps(job).lower()
    assert "actions: write" not in json.dumps(job)
    assert "contents: write" not in json.dumps(job)
    assert "packages: write" not in json.dumps(job)

    initialization = next(
        step for step in jobs["qualification"]["steps"] if step.get("name") == "Initialize all twelve gates as FAIL"
    )
    gate = next(
        step for step in jobs["qualification"]["steps"] if step.get("name") == "Gate - operator-evidence"
    )
    assert "operator-evidence" in initialization["run"]
    assert "operator-evidence-consumer.result" in json.dumps(gate)
    assert "release_gate_summary.py qualify" in workflow_text


def test_missing_credential_fails_before_api_or_candidate_execution(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv(consumer.PRIVATE_READ_TOKEN_ENV, raising=False)
    result = consumer.main(
        [
            "fetch",
            "--candidate-sha",
            CANDIDATE_SHA,
            "--run-id",
            str(RUN_ID),
            "--artifact-id",
            str(ARTIFACT_ID),
            "--work-root",
            str(tmp_path / f"t707-operator-evidence-{RUN_ID}"),
            "--runner-temp",
            str(tmp_path),
        ]
    )

    assert result == 1
    assert "private_read_credential_missing" in capsys.readouterr().err
    assert not (tmp_path / f"t707-operator-evidence-{RUN_ID}").exists()


def test_consumer_source_reuses_candidate_registry_and_validators_without_schema_copy() -> None:
    source = (REPO_ROOT / "scripts/private_operator_evidence_consumer.py").read_text(encoding="utf-8")
    assert "ARTIFACT_SPECS" in source
    assert "evidence_artifact_sanitize.py" in source
    assert "operator_evidence_bundle_check.py" in source
    assert "operator_evidence_workflow_run.py" in source
    fixture_names = {path.name for path in (REPO_ROOT / "tests/fixtures/operator_evidence/sanitized_complete").glob("*.json")}
    assert fixture_names
    assert all(name not in source for name in fixture_names)
