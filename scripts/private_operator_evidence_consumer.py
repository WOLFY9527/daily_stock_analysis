#!/usr/bin/env python3
"""Authenticate and validate the qualified private operator-evidence handoff."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence


PUBLIC_REPOSITORY_NAME = "WOLFY9527/wolfystock"
PUBLIC_REPOSITORY_ID = 1213182361
PRODUCER_REPOSITORY_NAME = "WOLFY9527/wolfystock-operator-evidence"
PRODUCER_REPOSITORY_ID = 1335331928
PRODUCER_WORKFLOW_PATH = ".github/workflows/isolated-operator-evidence-producer.yml"
TRUSTED_PRODUCER_COMMIT = "bc5b6af9d6038931a9df52f6f0a67887270c8b23"
EXPECTED_PRODUCER_WORKFLOW_IDENTITY = (
    f"{PRODUCER_REPOSITORY_NAME}/{PRODUCER_WORKFLOW_PATH}@{TRUSTED_PRODUCER_COMMIT}"
)
EXPECTED_VALIDATOR_RESULT = "candidate-validators-pass"
PRIVATE_READ_TOKEN_ENV = (
    "OPERATOR_EVIDENCE_READ_"
    "TOKEN"
)
TRANSPORT_SCHEMA = "wolfystock_private_operator_evidence_transport_v1"
WORK_ROOT_MARKER = ".t707-private-operator-evidence-work-root"
GITHUB_API_ROOT = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"

MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_ARTIFACT_ARCHIVE_BYTES = 40 * 1024 * 1024
MAX_ZIP_MEMBER_BYTES = 32 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 36 * 1024 * 1024
MAX_TAR_MEMBER_BYTES = 4 * 1024 * 1024
MAX_TAR_TOTAL_BYTES = 24 * 1024 * 1024
MAX_REGISTRY_MEMBERS = 100
MAX_ARTIFACT_PAGES = 10
ARTIFACTS_PER_PAGE = 100

FULL_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
API_DIGEST_PATTERN = re.compile(r"^sha256:([0-9a-f]{64})$")
GENERATED_AT_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SAFE_MEMBER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

PROVENANCE_FIELDS = frozenset(
    {
        "publicRepositoryIdentity",
        "candidateSha",
        "candidateTree",
        "producerRepositoryIdentity",
        "producerWorkflowIdentity",
        "runId",
        "runAttempt",
        "event",
        "ref",
        "sourceIngressAssetSha256",
        "canonicalBundleSha256",
        "validatorResult",
        "generatedAt",
    }
)
REPOSITORY_IDENTITY_FIELDS = frozenset({"nameWithOwner", "repositoryId"})
TRANSPORT_FIELDS = frozenset(
    {"schemaVersion", "producerRepositoryIdentity", "producerWorkflowIdentity", "run", "artifact"}
)
TRANSPORT_REPOSITORY_FIELDS = frozenset({"nameWithOwner", "repositoryId", "privateVisibility"})
TRANSPORT_WORKFLOW_FIELDS = frozenset({"path", "headSha", "workflowId"})
TRANSPORT_RUN_FIELDS = frozenset(
    {"id", "attempt", "event", "ref", "headBranch", "headSha", "status", "conclusion"}
)
TRANSPORT_ARTIFACT_FIELDS = frozenset({"id", "name", "sizeInBytes", "digest"})


class ConsumerViolation(RuntimeError):
    """A bounded fail-closed consumer rejection."""


@dataclass(frozen=True)
class RunIdentity:
    run_id: int
    attempt: int
    workflow_id: int


@dataclass(frozen=True)
class ArtifactIdentity:
    artifact_id: int
    name: str
    size: int
    digest: str


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):  # noqa: ANN001
        return None


class GitHubApi:
    def __init__(self, token: str) -> None:
        if not token:
            raise ConsumerViolation("private_read_credential_missing")
        self._token = token

    def _api_request(self, endpoint: str) -> urllib.request.Request:
        return urllib.request.Request(
            f"{GITHUB_API_ROOT}{endpoint}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self._token}",
                "User-Agent": "wolfystock-private-operator-evidence-consumer",
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
            },
            method="GET",
        )

    def get_json(self, endpoint: str) -> Any:
        try:
            with urllib.request.urlopen(self._api_request(endpoint), timeout=30) as response:
                body = response.read(MAX_API_RESPONSE_BYTES + 1)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            raise ConsumerViolation("github_api_request_failed") from exc
        if len(body) > MAX_API_RESPONSE_BYTES:
            raise ConsumerViolation("github_api_response_too_large")
        try:
            return json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConsumerViolation("github_api_response_invalid") from exc

    def download_artifact(self, artifact_id: int) -> bytes:
        endpoint = f"/repos/{PRODUCER_REPOSITORY_NAME}/actions/artifacts/{artifact_id}/zip"
        opener = urllib.request.build_opener(_NoRedirect())
        try:
            opener.open(self._api_request(endpoint), timeout=30)
        except urllib.error.HTTPError as exc:
            if exc.code not in {301, 302, 303, 307, 308}:
                raise ConsumerViolation("artifact_download_request_failed") from exc
            location = exc.headers.get("Location")
            exc.close()
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ConsumerViolation("artifact_download_request_failed") from exc
        else:
            raise ConsumerViolation("artifact_download_redirect_missing")
        if not isinstance(location, str):
            raise ConsumerViolation("artifact_download_redirect_missing")
        parsed = urllib.parse.urlsplit(location)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ConsumerViolation("artifact_download_redirect_invalid")
        request = urllib.request.Request(
            location,
            headers={"User-Agent": "wolfystock-private-operator-evidence-consumer"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read(MAX_ARTIFACT_ARCHIVE_BYTES + 1)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            raise ConsumerViolation("artifact_download_failed") from exc
        if not body:
            raise ConsumerViolation("artifact_download_empty")
        if len(body) > MAX_ARTIFACT_ARCHIVE_BYTES:
            raise ConsumerViolation("artifact_download_too_large")
        return body


def _require_object(value: Any, *, code: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ConsumerViolation(code)
    return value


def _require_exact_fields(value: Mapping[str, Any], fields: frozenset[str], *, code: str) -> None:
    if frozenset(value) != fields:
        raise ConsumerViolation(code)


def _require_positive_integer(value: Any, *, code: str) -> int:
    if type(value) is not int or value <= 0:
        raise ConsumerViolation(code)
    return value


def _parse_positive_cli_integer(value: str, *, code: str) -> int:
    if not value.isdigit() or value.startswith("0"):
        raise ConsumerViolation(code)
    return _require_positive_integer(int(value), code=code)


def _require_full_sha(value: Any, *, code: str) -> str:
    if not isinstance(value, str) or not FULL_SHA_PATTERN.fullmatch(value):
        raise ConsumerViolation(code)
    return value


def _require_sha256(value: Any, *, code: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ConsumerViolation(code)
    return value


def _require_api_digest(value: Any) -> str:
    if not isinstance(value, str) or not API_DIGEST_PATTERN.fullmatch(value):
        raise ConsumerViolation("artifact_api_digest_invalid")
    return value


def _expected_artifact_name(candidate_sha: str, run_id: int, run_attempt: int) -> str:
    return f"wolfystock-operator-evidence-handoff-{candidate_sha}-{run_id}-{run_attempt}"


def _validate_repository_metadata(payload: Any) -> None:
    repository = _require_object(payload, code="producer_repository_metadata_invalid")
    if (
        repository.get("id") != PRODUCER_REPOSITORY_ID
        or repository.get("full_name") != PRODUCER_REPOSITORY_NAME
        or repository.get("private") is not True
        or repository.get("visibility") != "private"
    ):
        raise ConsumerViolation("producer_repository_identity_mismatch")


def _validate_nested_repository(payload: Any, *, code: str) -> None:
    repository = _require_object(payload, code=code)
    if (
        repository.get("id") != PRODUCER_REPOSITORY_ID
        or repository.get("full_name") != PRODUCER_REPOSITORY_NAME
        or repository.get("private") is not True
    ):
        raise ConsumerViolation(code)


def _validate_run_metadata(payload: Any, *, expected_run_id: int) -> RunIdentity:
    run = _require_object(payload, code="producer_run_metadata_invalid")
    if run.get("id") != expected_run_id:
        raise ConsumerViolation("producer_run_id_mismatch")
    _validate_nested_repository(run.get("repository"), code="producer_run_repository_mismatch")
    _validate_nested_repository(run.get("head_repository"), code="producer_head_repository_mismatch")
    if run.get("status") != "completed":
        raise ConsumerViolation("producer_run_not_completed")
    if run.get("conclusion") != "success":
        raise ConsumerViolation("producer_run_not_successful")
    if run.get("event") != "workflow_dispatch":
        raise ConsumerViolation("producer_run_event_mismatch")
    if run.get("head_branch") != "main":
        raise ConsumerViolation("producer_run_ref_mismatch")
    if run.get("path") != PRODUCER_WORKFLOW_PATH:
        raise ConsumerViolation("producer_workflow_path_mismatch")
    if run.get("head_sha") != TRUSTED_PRODUCER_COMMIT:
        raise ConsumerViolation("producer_commit_mismatch")
    attempt = _require_positive_integer(run.get("run_attempt"), code="producer_run_attempt_invalid")
    workflow_id = _require_positive_integer(run.get("workflow_id"), code="producer_workflow_id_invalid")
    return RunIdentity(run_id=expected_run_id, attempt=attempt, workflow_id=workflow_id)


def _validate_workflow_metadata(payload: Any, *, run: RunIdentity) -> None:
    workflow = _require_object(payload, code="producer_workflow_metadata_invalid")
    if workflow.get("id") != run.workflow_id or workflow.get("path") != PRODUCER_WORKFLOW_PATH:
        raise ConsumerViolation("producer_workflow_identity_mismatch")


def _validate_artifact_metadata(
    payload: Any,
    *,
    run: RunIdentity,
    expected_artifact_id: int,
    candidate_sha: str,
) -> ArtifactIdentity:
    artifact = _require_object(payload, code="producer_artifact_metadata_invalid")
    if artifact.get("id") != expected_artifact_id:
        raise ConsumerViolation("producer_artifact_id_mismatch")
    name = artifact.get("name")
    if not isinstance(name, str):
        raise ConsumerViolation("producer_artifact_name_invalid")
    if "synthetic" in name.lower() or "smoke" in name.lower():
        raise ConsumerViolation("synthetic_artifact_rejected")
    expected_name = _expected_artifact_name(candidate_sha, run.run_id, run.attempt)
    if name != expected_name:
        raise ConsumerViolation("producer_artifact_name_mismatch")
    if artifact.get("expired") is not False:
        raise ConsumerViolation("producer_artifact_expired")
    size = _require_positive_integer(artifact.get("size_in_bytes"), code="producer_artifact_size_invalid")
    if size > MAX_ARTIFACT_ARCHIVE_BYTES:
        raise ConsumerViolation("producer_artifact_too_large")
    digest = _require_api_digest(artifact.get("digest"))
    workflow_run = _require_object(artifact.get("workflow_run"), code="artifact_run_association_invalid")
    if (
        workflow_run.get("id") != run.run_id
        or workflow_run.get("repository_id") != PRODUCER_REPOSITORY_ID
        or workflow_run.get("head_repository_id") != PRODUCER_REPOSITORY_ID
        or workflow_run.get("head_branch") != "main"
        or workflow_run.get("head_sha") != TRUSTED_PRODUCER_COMMIT
    ):
        raise ConsumerViolation("artifact_run_association_invalid")
    return ArtifactIdentity(artifact_id=expected_artifact_id, name=name, size=size, digest=digest)


def _list_run_artifacts(api: GitHubApi, run_id: int) -> list[Mapping[str, Any]]:
    artifacts: list[Mapping[str, Any]] = []
    expected_total: int | None = None
    for page in range(1, MAX_ARTIFACT_PAGES + 1):
        payload = _require_object(
            api.get_json(
                f"/repos/{PRODUCER_REPOSITORY_NAME}/actions/runs/{run_id}/artifacts"
                f"?per_page={ARTIFACTS_PER_PAGE}&page={page}"
            ),
            code="producer_artifact_list_invalid",
        )
        total = payload.get("total_count")
        if type(total) is not int or total < 0:
            raise ConsumerViolation("producer_artifact_list_invalid")
        if expected_total is None:
            expected_total = total
        elif total != expected_total:
            raise ConsumerViolation("producer_artifact_list_changed")
        page_artifacts = payload.get("artifacts")
        if not isinstance(page_artifacts, list) or any(not isinstance(item, dict) for item in page_artifacts):
            raise ConsumerViolation("producer_artifact_list_invalid")
        artifacts.extend(page_artifacts)
        if len(artifacts) >= total:
            if len(artifacts) != total:
                raise ConsumerViolation("producer_artifact_list_count_mismatch")
            return artifacts
        if len(page_artifacts) != ARTIFACTS_PER_PAGE:
            raise ConsumerViolation("producer_artifact_list_count_mismatch")
    raise ConsumerViolation("producer_artifact_list_too_large")


def _require_unique_artifact_association(
    artifacts: Sequence[Mapping[str, Any]], *, artifact: ArtifactIdentity
) -> None:
    matches = [item for item in artifacts if item.get("name") == artifact.name]
    if len(matches) != 1 or matches[0].get("id") != artifact.artifact_id:
        raise ConsumerViolation("producer_artifact_association_not_unique")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_exclusive(path: Path, payload: bytes) -> None:
    try:
        with path.open("xb") as handle:
            handle.write(payload)
        path.chmod(0o600)
    except OSError as exc:
        raise ConsumerViolation("consumer_output_write_failed") from exc


def _validate_work_root_location(work_root: Path, runner_temp: Path) -> None:
    resolved_root = work_root.resolve()
    resolved_temp = runner_temp.resolve()
    if (
        resolved_root.parent != resolved_temp
        or not re.fullmatch(r"t707-operator-evidence-[1-9][0-9]*", resolved_root.name)
    ):
        raise ConsumerViolation("consumer_work_root_invalid")


def _initialize_work_root(work_root: Path, runner_temp: Path) -> None:
    _validate_work_root_location(work_root, runner_temp)
    try:
        work_root.mkdir(mode=0o700)
    except OSError as exc:
        raise ConsumerViolation("consumer_work_root_create_failed") from exc
    _write_exclusive(work_root / WORK_ROOT_MARKER, b"t707-private-operator-evidence\n")


def _transport_record(run: RunIdentity, artifact: ArtifactIdentity) -> dict[str, Any]:
    return {
        "schemaVersion": TRANSPORT_SCHEMA,
        "producerRepositoryIdentity": {
            "nameWithOwner": PRODUCER_REPOSITORY_NAME,
            "repositoryId": PRODUCER_REPOSITORY_ID,
            "privateVisibility": True,
        },
        "producerWorkflowIdentity": {
            "path": PRODUCER_WORKFLOW_PATH,
            "headSha": TRUSTED_PRODUCER_COMMIT,
            "workflowId": run.workflow_id,
        },
        "run": {
            "id": run.run_id,
            "attempt": run.attempt,
            "event": "workflow_dispatch",
            "ref": "refs/heads/main",
            "headBranch": "main",
            "headSha": TRUSTED_PRODUCER_COMMIT,
            "status": "completed",
            "conclusion": "success",
        },
        "artifact": {
            "id": artifact.artifact_id,
            "name": artifact.name,
            "sizeInBytes": artifact.size,
            "digest": artifact.digest,
        },
    }


def fetch_handoff(
    *,
    api: GitHubApi,
    candidate_sha: str,
    run_id: int,
    artifact_id: int,
    work_root: Path,
    runner_temp: Path,
) -> None:
    candidate = _require_full_sha(candidate_sha, code="candidate_sha_invalid")
    _validate_repository_metadata(api.get_json(f"/repos/{PRODUCER_REPOSITORY_NAME}"))
    run_payload = api.get_json(f"/repos/{PRODUCER_REPOSITORY_NAME}/actions/runs/{run_id}")
    run = _validate_run_metadata(run_payload, expected_run_id=run_id)
    workflow_payload = api.get_json(
        f"/repos/{PRODUCER_REPOSITORY_NAME}/actions/workflows/{run.workflow_id}"
    )
    _validate_workflow_metadata(workflow_payload, run=run)
    artifact_payload = api.get_json(
        f"/repos/{PRODUCER_REPOSITORY_NAME}/actions/artifacts/{artifact_id}"
    )
    artifact = _validate_artifact_metadata(
        artifact_payload,
        run=run,
        expected_artifact_id=artifact_id,
        candidate_sha=candidate,
    )
    _require_unique_artifact_association(_list_run_artifacts(api, run_id), artifact=artifact)
    archive = api.download_artifact(artifact_id)
    if len(archive) != artifact.size:
        raise ConsumerViolation("downloaded_artifact_size_mismatch")
    if f"sha256:{_sha256(archive)}" != artifact.digest:
        raise ConsumerViolation("downloaded_artifact_digest_mismatch")
    _initialize_work_root(work_root, runner_temp)
    _write_exclusive(work_root / "handoff.zip", archive)
    record = (json.dumps(_transport_record(run, artifact), indent=2, sort_keys=True) + "\n").encode()
    _write_exclusive(work_root / "transport.json", record)


def _load_transport_record(path: Path, *, candidate_sha: str, run_id: int, artifact_id: int) -> Mapping[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConsumerViolation("transport_record_invalid") from exc
    record = _require_object(payload, code="transport_record_invalid")
    _require_exact_fields(record, TRANSPORT_FIELDS, code="transport_record_fields_invalid")
    if record.get("schemaVersion") != TRANSPORT_SCHEMA:
        raise ConsumerViolation("transport_record_schema_mismatch")
    repository = _require_object(record.get("producerRepositoryIdentity"), code="transport_repository_invalid")
    _require_exact_fields(repository, TRANSPORT_REPOSITORY_FIELDS, code="transport_repository_fields_invalid")
    if repository != {
        "nameWithOwner": PRODUCER_REPOSITORY_NAME,
        "repositoryId": PRODUCER_REPOSITORY_ID,
        "privateVisibility": True,
    }:
        raise ConsumerViolation("transport_repository_mismatch")
    workflow = _require_object(record.get("producerWorkflowIdentity"), code="transport_workflow_invalid")
    _require_exact_fields(workflow, TRANSPORT_WORKFLOW_FIELDS, code="transport_workflow_fields_invalid")
    if (
        workflow.get("path") != PRODUCER_WORKFLOW_PATH
        or workflow.get("headSha") != TRUSTED_PRODUCER_COMMIT
    ):
        raise ConsumerViolation("transport_workflow_mismatch")
    _require_positive_integer(workflow.get("workflowId"), code="transport_workflow_id_invalid")
    run = _require_object(record.get("run"), code="transport_run_invalid")
    _require_exact_fields(run, TRANSPORT_RUN_FIELDS, code="transport_run_fields_invalid")
    if run != {
        "id": run_id,
        "attempt": run.get("attempt"),
        "event": "workflow_dispatch",
        "ref": "refs/heads/main",
        "headBranch": "main",
        "headSha": TRUSTED_PRODUCER_COMMIT,
        "status": "completed",
        "conclusion": "success",
    }:
        raise ConsumerViolation("transport_run_mismatch")
    attempt = _require_positive_integer(run.get("attempt"), code="transport_run_attempt_invalid")
    artifact = _require_object(record.get("artifact"), code="transport_artifact_invalid")
    _require_exact_fields(artifact, TRANSPORT_ARTIFACT_FIELDS, code="transport_artifact_fields_invalid")
    if (
        artifact.get("id") != artifact_id
        or artifact.get("name") != _expected_artifact_name(candidate_sha, run_id, attempt)
    ):
        raise ConsumerViolation("transport_artifact_mismatch")
    size = _require_positive_integer(artifact.get("sizeInBytes"), code="transport_artifact_size_invalid")
    if size > MAX_ARTIFACT_ARCHIVE_BYTES:
        raise ConsumerViolation("transport_artifact_too_large")
    _require_api_digest(artifact.get("digest"))
    return record


def _safe_member_name(name: str, *, suffix: str | None = None) -> str:
    path = PurePosixPath(name)
    if (
        not name
        or name in {".", ".."}
        or name.startswith("/")
        or "\\" in name
        or path.is_absolute()
        or len(path.parts) != 1
        or path.name != name
        or not SAFE_MEMBER_PATTERN.fullmatch(name)
        or (suffix is not None and not name.endswith(suffix))
    ):
        raise ConsumerViolation("archive_member_path_unsafe")
    return name


def _inspect_handoff_zip(payload: bytes, *, candidate_sha: str) -> dict[str, bytes]:
    expected = {f"operator-evidence-{candidate_sha}.tar", "provenance.json"}
    members: dict[str, bytes] = {}
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            for info in archive.infolist():
                name = _safe_member_name(info.filename)
                if name not in expected:
                    raise ConsumerViolation("handoff_zip_extra_member")
                if name in members:
                    raise ConsumerViolation("handoff_zip_duplicate_member")
                mode = (info.external_attr >> 16) & 0xFFFF
                if (
                    info.is_dir()
                    or info.flag_bits & 0x1
                    or stat.S_IFMT(mode) not in {0, stat.S_IFREG}
                    or info.file_size <= 0
                    or info.file_size > MAX_ZIP_MEMBER_BYTES
                ):
                    raise ConsumerViolation("handoff_zip_member_invalid")
                total += info.file_size
                if total > MAX_ZIP_TOTAL_BYTES:
                    raise ConsumerViolation("handoff_zip_total_size_exceeded")
                body = archive.read(info)
                if len(body) != info.file_size:
                    raise ConsumerViolation("handoff_zip_member_size_mismatch")
                members[name] = body
    except ConsumerViolation:
        raise
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise ConsumerViolation("handoff_zip_malformed") from exc
    actual = set(members)
    if actual != expected:
        raise ConsumerViolation("handoff_zip_missing_member")
    return members


def _validate_repository_identity(
    payload: Any, *, expected_name: str, expected_id: int, code: str
) -> None:
    identity = _require_object(payload, code=code)
    _require_exact_fields(identity, REPOSITORY_IDENTITY_FIELDS, code=code)
    if identity != {"nameWithOwner": expected_name, "repositoryId": expected_id}:
        raise ConsumerViolation(code)


def _validate_generated_at(value: Any) -> None:
    if not isinstance(value, str) or not GENERATED_AT_PATTERN.fullmatch(value):
        raise ConsumerViolation("provenance_generated_at_invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ConsumerViolation("provenance_generated_at_invalid") from exc
    if parsed.tzinfo != timezone.utc:
        raise ConsumerViolation("provenance_generated_at_invalid")


def _validate_provenance(
    payload: bytes,
    *,
    candidate_sha: str,
    candidate_tree: str,
    transport: Mapping[str, Any],
    bundle: bytes,
) -> Mapping[str, Any]:
    try:
        decoded = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConsumerViolation("provenance_json_invalid") from exc
    provenance = _require_object(decoded, code="provenance_not_object")
    _require_exact_fields(provenance, PROVENANCE_FIELDS, code="provenance_field_allowlist_mismatch")
    _validate_repository_identity(
        provenance.get("publicRepositoryIdentity"),
        expected_name=PUBLIC_REPOSITORY_NAME,
        expected_id=PUBLIC_REPOSITORY_ID,
        code="provenance_public_repository_mismatch",
    )
    _validate_repository_identity(
        provenance.get("producerRepositoryIdentity"),
        expected_name=PRODUCER_REPOSITORY_NAME,
        expected_id=PRODUCER_REPOSITORY_ID,
        code="provenance_producer_repository_mismatch",
    )
    run = _require_object(transport.get("run"), code="transport_run_invalid")
    if provenance.get("candidateSha") != candidate_sha:
        raise ConsumerViolation("provenance_candidate_sha_mismatch")
    if provenance.get("candidateTree") != candidate_tree:
        raise ConsumerViolation("provenance_candidate_tree_mismatch")
    if provenance.get("producerWorkflowIdentity") != EXPECTED_PRODUCER_WORKFLOW_IDENTITY:
        raise ConsumerViolation("provenance_workflow_identity_mismatch")
    if provenance.get("runId") != run.get("id"):
        raise ConsumerViolation("provenance_run_id_mismatch")
    if provenance.get("runAttempt") != run.get("attempt"):
        raise ConsumerViolation("provenance_run_attempt_mismatch")
    if provenance.get("event") != run.get("event"):
        raise ConsumerViolation("provenance_event_mismatch")
    if provenance.get("ref") != run.get("ref"):
        raise ConsumerViolation("provenance_ref_mismatch")
    _require_sha256(
        provenance.get("sourceIngressAssetSha256"), code="provenance_source_ingress_digest_invalid"
    )
    bundle_digest = _require_sha256(
        provenance.get("canonicalBundleSha256"), code="provenance_bundle_digest_invalid"
    )
    if bundle_digest != _sha256(bundle):
        raise ConsumerViolation("provenance_bundle_digest_mismatch")
    if provenance.get("validatorResult") != EXPECTED_VALIDATOR_RESULT:
        raise ConsumerViolation("provenance_validator_result_mismatch")
    _validate_generated_at(provenance.get("generatedAt"))
    return provenance


def _candidate_environment() -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "PYTHONDONTWRITEBYTECODE": "1",
    }


def _run_candidate(
    arguments: Sequence[str], *, cwd: Path, capture_output: bool = False
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        list(arguments),
        cwd=cwd,
        env=_candidate_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture_output else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def _candidate_git_value(candidate_root: Path, expression: str) -> str:
    result = _run_candidate(
        ["git", "-C", str(candidate_root), "rev-parse", expression],
        cwd=candidate_root,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ConsumerViolation("candidate_git_identity_unavailable")
    try:
        value = result.stdout.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ConsumerViolation("candidate_git_identity_unavailable") from exc
    return _require_full_sha(value, code="candidate_git_identity_invalid")


def _discover_candidate_registry(candidate_root: Path) -> frozenset[str]:
    program = (
        "import json; from operator_evidence_bundle_check import ARTIFACT_SPECS; "
        "print(json.dumps([spec.filename for spec in ARTIFACT_SPECS]))"
    )
    result = _run_candidate(
        [sys.executable, "-c", program],
        cwd=candidate_root / "scripts",
        capture_output=True,
    )
    if result.returncode != 0:
        raise ConsumerViolation("candidate_registry_discovery_failed")
    try:
        values = json.loads(result.stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConsumerViolation("candidate_registry_invalid") from exc
    if (
        not isinstance(values, list)
        or not values
        or len(values) > MAX_REGISTRY_MEMBERS
        or any(not isinstance(value, str) for value in values)
        or len(values) != len(set(values))
    ):
        raise ConsumerViolation("candidate_registry_invalid")
    names = frozenset(_safe_member_name(value, suffix=".json") for value in values)
    if len(names) != len(values):
        raise ConsumerViolation("candidate_registry_invalid")
    return names


def _inspect_canonical_tar(payload: bytes, *, expected_names: frozenset[str]) -> dict[str, bytes]:
    members: dict[str, bytes] = {}
    total = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
            for member in archive:
                name = _safe_member_name(member.name, suffix=".json")
                if name not in expected_names:
                    raise ConsumerViolation("canonical_tar_extra_member")
                if name in members:
                    raise ConsumerViolation("canonical_tar_duplicate_member")
                if (
                    member.type not in {tarfile.REGTYPE, tarfile.AREGTYPE}
                    or member.sparse is not None
                    or member.size <= 0
                    or member.size > MAX_TAR_MEMBER_BYTES
                ):
                    raise ConsumerViolation("canonical_tar_member_invalid")
                total += member.size
                if total > MAX_TAR_TOTAL_BYTES:
                    raise ConsumerViolation("canonical_tar_total_size_exceeded")
                source = archive.extractfile(member)
                if source is None:
                    raise ConsumerViolation("canonical_tar_member_unreadable")
                body = source.read(MAX_TAR_MEMBER_BYTES + 1)
                if len(body) != member.size:
                    raise ConsumerViolation("canonical_tar_member_size_mismatch")
                try:
                    decoded = json.loads(body)
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ConsumerViolation("canonical_tar_json_invalid") from exc
                if not isinstance(decoded, dict):
                    raise ConsumerViolation("canonical_tar_json_not_object")
                members[name] = body
    except ConsumerViolation:
        raise
    except (tarfile.TarError, OSError) as exc:
        raise ConsumerViolation("canonical_tar_malformed") from exc
    if frozenset(members) != expected_names:
        raise ConsumerViolation("canonical_tar_missing_member")
    return members


def _create_private_directory(path: Path) -> None:
    try:
        path.mkdir(mode=0o700)
    except OSError as exc:
        raise ConsumerViolation("consumer_validation_directory_create_failed") from exc


def _write_members(directory: Path, members: Mapping[str, bytes]) -> None:
    _create_private_directory(directory)
    for name, body in members.items():
        _write_exclusive(directory / _safe_member_name(name, suffix=".json"), body)


def _run_candidate_validators(
    *,
    candidate_root: Path,
    candidate_sha: str,
    input_directory: Path,
    sanitized_directory: Path,
    validation_directory: Path,
    expected_names: frozenset[str],
) -> None:
    _create_private_directory(sanitized_directory)
    _create_private_directory(validation_directory)
    for name in sorted(expected_names):
        result = _run_candidate(
            [
                sys.executable,
                str(candidate_root / "scripts/evidence_artifact_sanitize.py"),
                "sanitize",
                "--input",
                str(input_directory / name),
                "--output",
                str(sanitized_directory / name),
                "--fail-on-findings",
            ],
            cwd=candidate_root,
        )
        if result.returncode != 0:
            raise ConsumerViolation("candidate_sanitizer_rejected")
    bundle = _run_candidate(
        [
            sys.executable,
            str(candidate_root / "scripts/operator_evidence_bundle_check.py"),
            str(sanitized_directory),
        ],
        cwd=candidate_root,
    )
    if bundle.returncode != 0:
        raise ConsumerViolation("candidate_bundle_validator_rejected")
    workflow = _run_candidate(
        [
            sys.executable,
            str(candidate_root / "scripts/operator_evidence_workflow_run.py"),
            "check",
            "--artifact-dir",
            str(sanitized_directory),
            "--output-dir",
            str(validation_directory),
            "--expected-candidate-sha",
            candidate_sha,
        ],
        cwd=candidate_root,
    )
    if workflow.returncode != 0:
        raise ConsumerViolation("candidate_workflow_validator_rejected")
    try:
        summary = json.loads((validation_directory / "bundle-summary.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConsumerViolation("candidate_bundle_summary_invalid") from exc
    if not isinstance(summary, dict) or summary.get("bundleStatus") != "complete-review-required":
        raise ConsumerViolation("candidate_bundle_summary_not_complete")


def validate_handoff(
    *,
    candidate_root: Path,
    candidate_sha: str,
    candidate_tree: str,
    run_id: int,
    artifact_id: int,
    work_root: Path,
    runner_temp: Path,
) -> None:
    candidate = _require_full_sha(candidate_sha, code="candidate_sha_invalid")
    tree = _require_full_sha(candidate_tree, code="candidate_tree_invalid")
    _validate_work_root_location(work_root, runner_temp)
    if not (work_root / WORK_ROOT_MARKER).is_file():
        raise ConsumerViolation("consumer_work_root_marker_missing")
    transport = _load_transport_record(
        work_root / "transport.json",
        candidate_sha=candidate,
        run_id=run_id,
        artifact_id=artifact_id,
    )
    try:
        archive = (work_root / "handoff.zip").read_bytes()
    except OSError as exc:
        raise ConsumerViolation("handoff_zip_read_failed") from exc
    artifact = _require_object(transport.get("artifact"), code="transport_artifact_invalid")
    if len(archive) != artifact.get("sizeInBytes"):
        raise ConsumerViolation("handoff_zip_size_mismatch")
    if f"sha256:{_sha256(archive)}" != artifact.get("digest"):
        raise ConsumerViolation("handoff_zip_digest_mismatch")
    if _candidate_git_value(candidate_root, "HEAD^{commit}") != candidate:
        raise ConsumerViolation("candidate_checkout_sha_mismatch")
    if _candidate_git_value(candidate_root, "HEAD^{tree}") != tree:
        raise ConsumerViolation("candidate_checkout_tree_mismatch")
    zip_members = _inspect_handoff_zip(archive, candidate_sha=candidate)
    bundle_name = f"operator-evidence-{candidate}.tar"
    bundle = zip_members[bundle_name]
    _validate_provenance(
        zip_members["provenance.json"],
        candidate_sha=candidate,
        candidate_tree=tree,
        transport=transport,
        bundle=bundle,
    )
    expected_names = _discover_candidate_registry(candidate_root)
    members = _inspect_canonical_tar(bundle, expected_names=expected_names)
    input_directory = work_root / "raw-evidence"
    sanitized_directory = work_root / "sanitized-evidence"
    validation_directory = work_root / "validation-output"
    _write_members(input_directory, members)
    _run_candidate_validators(
        candidate_root=candidate_root,
        candidate_sha=candidate,
        input_directory=input_directory,
        sanitized_directory=sanitized_directory,
        validation_directory=validation_directory,
        expected_names=expected_names,
    )


def cleanup_work_root(*, work_root: Path, runner_temp: Path) -> None:
    _validate_work_root_location(work_root, runner_temp)
    if not work_root.exists():
        return
    marker = work_root / WORK_ROOT_MARKER
    if marker.is_symlink() or not marker.is_file():
        raise ConsumerViolation("consumer_work_root_marker_missing")
    try:
        shutil.rmtree(work_root)
    except OSError as exc:
        raise ConsumerViolation("consumer_work_root_cleanup_failed") from exc


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    fetch = subparsers.add_parser("fetch")
    fetch.add_argument("--candidate-sha", required=True)
    fetch.add_argument("--run-id", required=True)
    fetch.add_argument("--artifact-id", required=True)
    fetch.add_argument("--work-root", type=Path, required=True)
    fetch.add_argument("--runner-temp", type=Path, required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--candidate-root", type=Path, required=True)
    validate.add_argument("--candidate-sha", required=True)
    validate.add_argument("--candidate-tree", required=True)
    validate.add_argument("--run-id", required=True)
    validate.add_argument("--artifact-id", required=True)
    validate.add_argument("--work-root", type=Path, required=True)
    validate.add_argument("--runner-temp", type=Path, required=True)
    cleanup = subparsers.add_parser("cleanup")
    cleanup.add_argument("--work-root", type=Path, required=True)
    cleanup.add_argument("--runner-temp", type=Path, required=True)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.command == "fetch":
            token = os.environ.pop(PRIVATE_READ_TOKEN_ENV, "")
            fetch_handoff(
                api=GitHubApi(token),
                candidate_sha=args.candidate_sha,
                run_id=_parse_positive_cli_integer(args.run_id, code="producer_run_id_invalid"),
                artifact_id=_parse_positive_cli_integer(
                    args.artifact_id, code="producer_artifact_id_invalid"
                ),
                work_root=args.work_root,
                runner_temp=args.runner_temp,
            )
        elif args.command == "validate":
            if PRIVATE_READ_TOKEN_ENV in os.environ:
                raise ConsumerViolation("private_read_credential_exposed_to_validation")
            validate_handoff(
                candidate_root=args.candidate_root,
                candidate_sha=args.candidate_sha,
                candidate_tree=args.candidate_tree,
                run_id=_parse_positive_cli_integer(args.run_id, code="producer_run_id_invalid"),
                artifact_id=_parse_positive_cli_integer(
                    args.artifact_id, code="producer_artifact_id_invalid"
                ),
                work_root=args.work_root,
                runner_temp=args.runner_temp,
            )
        else:
            cleanup_work_root(work_root=args.work_root, runner_temp=args.runner_temp)
    except ConsumerViolation as exc:
        print(f"[NO-GO] {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "PASS", "command": args.command}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
