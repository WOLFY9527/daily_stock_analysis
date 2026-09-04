#!/usr/bin/env python3
"""Validate the sanitized candidate-binding record shape offline.

This checker intentionally validates only the record's bounded structure and
redaction-safe values. The workflow runner owns comparison with its generated
manifest and the expected candidate identity.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from evidence_safety import finding as _finding
    from evidence_safety import is_iso_timestamp as _is_iso_timestamp
except ModuleNotFoundError:  # pragma: no cover - package import fallback
    from scripts.evidence_safety import finding as _finding
    from scripts.evidence_safety import is_iso_timestamp as _is_iso_timestamp


SCHEMA_VERSION = "wolfystock_operator_evidence_candidate_binding_v1"
FILENAME = "candidate_binding_operator_evidence.json"
REQUIRED_FIELDS = (
    "schemaVersion",
    "candidateSha",
    "candidateTree",
    "observationRef",
    "capturedAt",
    "synthetic",
    "artifactDigests",
    "outcome",
)
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,159}$")
NON_OBSERVED_REF_RE = re.compile(
    r"(?:synthetic|simulat(?:ed|ion)|dry[-_ ]?run|fixture|replay|mock|no[-_ ]?network|unavailable)",
    re.IGNORECASE,
)
SAFE_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
PLACEHOLDER_RE = re.compile(r"^<[-a-z0-9_]+>$")
ALLOWED_OUTCOMES = {"accepted", "needs-review", "rejected"}


def _placeholder(value: Any) -> bool:
    return isinstance(value, str) and bool(PLACEHOLDER_RE.fullmatch(value.strip().lower()))


def _valid_or_placeholder(value: Any, pattern: re.Pattern[str]) -> bool:
    return isinstance(value, str) and (bool(pattern.fullmatch(value)) or _placeholder(value))


def validate_candidate_binding(artifact: Any) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    checks = {
        "requiredFieldsPresent": False,
        "identityShapeValid": False,
        "observationReferenceSafe": False,
        "capturedTimestampValid": False,
        "syntheticFalse": False,
        "artifactDigestShapeValid": False,
    }
    if not isinstance(artifact, dict):
        return {
            "schemaVersion": SCHEMA_VERSION,
            "status": "fail",
            "advisoryOnly": True,
            "runtimeBehaviorChanged": False,
            "networkCallsExecutedByValidator": False,
            "checks": checks,
            "findings": [_finding("$", "artifact_must_be_json_object")],
        }

    for field in REQUIRED_FIELDS:
        if field not in artifact:
            findings.append(_finding(field, "missing_required_field"))
    checks["requiredFieldsPresent"] = not findings

    outcome = artifact.get("outcome")
    if outcome not in ALLOWED_OUTCOMES:
        findings.append(_finding("outcome", "invalid_outcome"))
    if artifact.get("schemaVersion") != SCHEMA_VERSION:
        findings.append(_finding("schemaVersion", "invalid_schema_version"))

    identity_valid = _valid_or_placeholder(artifact.get("candidateSha"), FULL_SHA_RE) and _valid_or_placeholder(
        artifact.get("candidateTree"), FULL_SHA_RE
    )
    if not identity_valid:
        findings.append(_finding("candidateIdentity", "invalid_candidate_identity"))
    checks["identityShapeValid"] = identity_valid

    ref_valid = isinstance(artifact.get("observationRef"), str) and bool(
        SAFE_REF_RE.fullmatch(str(artifact.get("observationRef")))
    )
    if outcome == "accepted" and ref_valid and NON_OBSERVED_REF_RE.search(str(artifact.get("observationRef"))):
        ref_valid = False
        findings.append(_finding("observationRef", "accepted_outcome_requires_observed_reference"))
    if not ref_valid:
        findings.append(_finding("observationRef", "unsafe_observation_reference"))
    checks["observationReferenceSafe"] = ref_valid

    timestamp_valid = _is_iso_timestamp(artifact.get("capturedAt"))
    if not timestamp_valid:
        findings.append(_finding("capturedAt", "invalid_captured_timestamp"))
    checks["capturedTimestampValid"] = timestamp_valid

    synthetic_false = artifact.get("synthetic") is False
    if not synthetic_false:
        findings.append(_finding("synthetic", "synthetic_evidence_rejected"))
    checks["syntheticFalse"] = synthetic_false

    digests = artifact.get("artifactDigests")
    digest_shape_valid = isinstance(digests, dict) and FILENAME not in digests
    if isinstance(digests, dict):
        for filename, digest in digests.items():
            if not SAFE_FILE_RE.fullmatch(str(filename)):
                digest_shape_valid = False
            if not SHA256_RE.fullmatch(str(digest)) and not _placeholder(digest):
                digest_shape_valid = False
    if outcome == "accepted" and (not isinstance(digests, dict) or not digests):
        digest_shape_valid = False
    if outcome == "accepted" and (not FULL_SHA_RE.fullmatch(str(artifact.get("candidateSha"))) or not FULL_SHA_RE.fullmatch(str(artifact.get("candidateTree")))):
        identity_valid = False
        checks["identityShapeValid"] = False
        findings.append(_finding("candidateIdentity", "placeholder_candidate_binding"))
    if not digest_shape_valid:
        findings.append(_finding("artifactDigests", "invalid_artifact_digests"))
    checks["artifactDigestShapeValid"] = digest_shape_valid

    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": "pass" if not findings else "fail",
        "advisoryOnly": True,
        "runtimeBehaviorChanged": False,
        "networkCallsExecutedByValidator": False,
        "checks": checks,
        "findings": findings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", help="Path to sanitized candidate-binding operator evidence JSON.")
    args = parser.parse_args(argv)
    try:
        artifact = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("[FAIL] candidate binding artifact unreadable", file=sys.stderr)
        return 1
    result = validate_candidate_binding(artifact)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
