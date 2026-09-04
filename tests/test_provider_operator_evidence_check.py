# -*- coding: utf-8 -*-
"""Offline provider operator evidence validator tests."""

from __future__ import annotations

from pathlib import Path

from tests.helpers.cli_validator import make_cli_validator, stdout_json as _stdout_json


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "provider_operator_evidence_check.py"
_write_json, _run_validator = make_cli_validator(
    SCRIPT,
    cwd=REPO_ROOT,
    artifact_name="provider-evidence.json",
)


def _artifact(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "providerName": "tradier",
        "environment": "staging",
        "operator": "provider-ops",
        "observedAt": "2026-05-08T10:30:00Z",
        "probeMode": "manual_provider_probe",
        "networkCallsEnabled": False,
        "synthetic": False,
        "credentialPresence": "redacted",
        "circuitState": {"state": "closed", "summary": "No forced circuit override recorded."},
        "fallbackState": {"state": "unchanged", "summary": "Runtime fallback policy was observed only."},
        "qualificationStatus": "NOT_QUALIFIED",
        "outcome": "needs-review",
        "evidenceRedactionVersion": "provider_operator_redaction_v1",
        "notes": "Sanitized operator artifact for later review.",
    }
    payload.update(overrides)
    return payload


def _accepted_artifact(**overrides: object) -> dict[str, object]:
    source_state = overrides.pop("source_state", "primary")
    freshness = overrides.pop("freshness", "fresh")
    source_authority = overrides.pop("source_authority", "official")
    payload = _artifact(
        outcome="accepted",
        qualificationStatus="QUALIFIED",
        observationMatrix=[
            {
                "market": market,
                "providerLabel": "tradier",
                "sourceLabel": "market-data",
                "sourceState": source_state,
                "sourceAuthority": source_authority,
                "coverageState": "covered",
                "asOf": "2026-05-08T10:30:00Z",
                "freshness": freshness,
                "delivery": "realtime",
                "entitlement": "entitled",
                "displayRights": "permitted",
                "rateLimitState": "normal",
                "observationRef": f"provider-observation-{market.lower()}",
            }
            for market in ("CN", "HK", "US")
        ],
    )
    payload.update(overrides)
    return payload


def test_accepts_sanitized_operator_artifact(tmp_path: Path) -> None:
    path = _write_json(tmp_path, _artifact())

    result = _run_validator(path)

    assert result.returncode == 0
    payload = _stdout_json(result)
    assert payload["status"] == "pass"
    assert payload["advisoryOnly"] is True
    assert payload["networkCallsExecutedByValidator"] is False
    assert payload["artifact"]["providerName"] == "tradier"
    assert payload["artifact"]["outcome"] == "needs-review"


def test_missing_required_fields_are_rejected(tmp_path: Path) -> None:
    artifact = _artifact()
    artifact.pop("observedAt")
    path = _write_json(tmp_path, artifact)

    result = _run_validator(path)

    assert result.returncode == 1
    payload = _stdout_json(result)
    assert payload["status"] == "fail"
    assert {
        finding["field"]: finding["reasonCode"]
        for finding in payload["findings"]
        if finding["reasonCode"] == "missing_required_field"
    } == {"observedAt": "missing_required_field"}


def test_raw_credential_markers_are_rejected_without_echoing_values(tmp_path: Path) -> None:
    artifact = _artifact()
    artifact["api_key"] = "should-not-appear"
    artifact["headers"] = {"Authorization": "Bearer redacted"}
    path = _write_json(tmp_path, artifact)

    result = _run_validator(path)

    assert result.returncode == 1
    assert "should-not-appear" not in result.stdout
    assert "should-not-appear" not in result.stderr
    payload = _stdout_json(result)
    reason_codes = {finding["reasonCode"] for finding in payload["findings"]}
    assert "unsafe_marker" in reason_codes


def test_raw_response_request_and_debug_payloads_are_rejected(tmp_path: Path) -> None:
    artifact = _artifact(
        raw_response={"status": "ok"},
        raw_request_body={"symbol": "TEM"},
        debug_payload="Traceback stack trace redacted",
    )
    path = _write_json(tmp_path, artifact)

    result = _run_validator(path)

    assert result.returncode == 1
    payload = _stdout_json(result)
    unsafe_fields = {
        finding["field"]
        for finding in payload["findings"]
        if finding["reasonCode"] in {"unsafe_marker", "unsafe_debug_marker"}
    }
    assert {"raw_response", "raw_request_body", "debug_payload"}.issubset(unsafe_fields)


def test_outcome_cannot_claim_go_or_launch_approved(tmp_path: Path) -> None:
    path = _write_json(tmp_path, _artifact(outcome="GO", notes="launch-approved by operator"))

    result = _run_validator(path)

    assert result.returncode == 1
    payload = _stdout_json(result)
    reason_codes = {finding["reasonCode"] for finding in payload["findings"]}
    assert "invalid_outcome" in reason_codes
    assert "launch_approval_claim_forbidden" in reason_codes


def test_network_calls_enabled_requires_accepted_operator_outcome_but_remains_advisory(
    tmp_path: Path,
) -> None:
    needs_review_path = _write_json(
        tmp_path,
        _artifact(networkCallsEnabled=True, outcome="needs-review"),
    )

    needs_review_result = _run_validator(needs_review_path)

    assert needs_review_result.returncode == 1
    needs_review_payload = _stdout_json(needs_review_result)
    assert {
        finding["reasonCode"] for finding in needs_review_payload["findings"]
    } >= {"network_calls_enabled_requires_accepted_outcome"}

    qualified_offline_path = _write_json(tmp_path, _accepted_artifact())

    qualified_offline_result = _run_validator(qualified_offline_path)

    assert qualified_offline_result.returncode == 1
    assert "qualified_outcome_requires_network_evidence" in {
        finding["reasonCode"] for finding in _stdout_json(qualified_offline_result)["findings"]
    }

    accepted_path = _write_json(
        tmp_path,
        _accepted_artifact(networkCallsEnabled=True),
    )

    accepted_result = _run_validator(accepted_path)

    assert accepted_result.returncode == 0
    accepted_payload = _stdout_json(accepted_result)
    assert accepted_payload["status"] == "pass"
    assert accepted_payload["advisoryOnly"] is True
    assert accepted_payload["networkCallsExecutedByValidator"] is False
    assert accepted_payload["checks"]["networkCallsEnabledAcceptedOutcome"] is True


def test_accepted_provider_evidence_requires_distinct_cn_hk_us_observations(tmp_path: Path) -> None:
    path = _write_json(tmp_path, _accepted_artifact(observationMatrix=_accepted_artifact()["observationMatrix"][:2]))

    result = _run_validator(path)

    assert result.returncode == 1
    assert "accepted_outcome_requires_cn_hk_us" in {item["reasonCode"] for item in _stdout_json(result)["findings"]}


def test_stale_or_fallback_observations_remain_truthful_when_entitled_and_permitted(tmp_path: Path) -> None:
    path = _write_json(
        tmp_path,
        _accepted_artifact(
            source_state="fallback",
            freshness="stale",
            qualificationStatus="NOT_QUALIFIED",
        ),
    )

    result = _run_validator(path)

    assert result.returncode == 0, result.stderr
    payload = _stdout_json(result)
    assert payload["qualificationStatus"] == "NOT_QUALIFIED"
    assert payload["checks"]["releaseEligibleQualification"] is False


def test_qualified_provider_evidence_rejects_noneligible_observed_states(tmp_path: Path) -> None:
    artifact = _accepted_artifact(networkCallsEnabled=True, providerName="fixture-provider")
    matrix = artifact["observationMatrix"]
    assert isinstance(matrix, list)
    matrix[0]["sourceState"] = "fallback"
    matrix[1]["coverageState"] = "partial"
    matrix[2]["sourceAuthority"] = "proxy-or-unknown"
    matrix[2]["delivery"] = "unavailable"
    matrix[0]["providerLabel"] = "mock-provider"
    matrix[1]["sourceLabel"] = "fixture-data"
    matrix[2]["observationRef"] = "synthetic-run-42"
    artifact["synthetic"] = True
    artifact["probeMode"] = "fixture_provider_replay"
    path = _write_json(tmp_path, artifact)

    result = _run_validator(path)

    assert result.returncode == 1
    payload = _stdout_json(result)
    assert {
        "qualified_observation_matrix_not_release_eligible",
        "accepted_outcome_requires_non_synthetic_evidence",
        "accepted_outcome_requires_observed_probe",
        "qualified_provider_identity_contains_non_observed_marker",
        "qualified_observation_contains_non_observed_marker",
    } <= {
        item["reasonCode"] for item in payload["findings"]
    }

    delivery_only = _accepted_artifact(networkCallsEnabled=True)
    delivery_matrix = delivery_only["observationMatrix"]
    assert isinstance(delivery_matrix, list)
    delivery_matrix[0]["delivery"] = "unavailable"
    delivery_path = _write_json(tmp_path, delivery_only)
    delivery_result = _run_validator(delivery_path)
    assert delivery_result.returncode == 1
    assert "qualified_observation_matrix_not_release_eligible" in {
        item["reasonCode"] for item in _stdout_json(delivery_result)["findings"]
    }

    no_network = _accepted_artifact(networkCallsEnabled=True, providerName="provider-unavailable")
    no_network["probeMode"] = "no-network"
    no_network_matrix = no_network["observationMatrix"]
    assert isinstance(no_network_matrix, list)
    no_network_matrix[0]["sourceLabel"] = "provider-unavailable"
    no_network_path = _write_json(tmp_path, no_network)
    no_network_result = _run_validator(no_network_path)
    assert no_network_result.returncode == 1
    assert {
        "accepted_outcome_requires_observed_probe",
        "qualified_provider_identity_contains_non_observed_marker",
        "qualified_observation_contains_non_observed_marker",
    } <= {item["reasonCode"] for item in _stdout_json(no_network_result)["findings"]}


def test_accepted_provider_evidence_rejects_missing_entitlement_or_display_rights(tmp_path: Path) -> None:
    artifact = _accepted_artifact()
    matrix = artifact["observationMatrix"]
    assert isinstance(matrix, list)
    matrix[0]["entitlement"] = "not-qualified"
    matrix[1]["displayRights"] = "not-qualified"
    path = _write_json(tmp_path, artifact)

    result = _run_validator(path)

    assert result.returncode == 1
    reasons = {item["reasonCode"] for item in _stdout_json(result)["findings"]}
    assert {"accepted_outcome_requires_entitled", "accepted_outcome_requires_display_permitted"} <= reasons
