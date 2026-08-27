# -*- coding: utf-8 -*-
"""Bounded research queue aggregation from already-projected research signals."""

from __future__ import annotations

import copy
import re
from collections import Counter
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote


RESEARCH_QUEUE_SCHEMA_VERSION = "research_queue_v1"
RESEARCH_QUEUE_LIMIT = 10
RESEARCH_QUEUE_NO_ADVICE_DISCLOSURE = (
    "Research-only queue; verify evidence gaps before further review."
)

_SOURCE_SURFACES = ("scanner", "watchlist", "market")
_CANONICAL_SOURCE_SURFACES = _SOURCE_SURFACES
_PRIORITY_TIERS = ("urgent_review", "follow_up", "monitor")
_FORBIDDEN_TEXT_RE = re.compile(
    r"\b("
    r"buy|sell|hold|recommendation|trade recommendation|trading advice|investment advice|"
    r"target price|stop loss|take profit|position sizing|place order|submit order"
    r")\b|买入|卖出|持有|交易建议|投资建议|目标价|止损|止盈|仓位",
    re.IGNORECASE,
)
_RAW_DIAGNOSTIC_RE = re.compile(
    r"\b("
    r"request\s*id|trace\s*id|provider|cache|runtime|debug|diagnostic|"
    r"raw\s*(?:payload|diagnostics|result|response)|schema\s*version|marketcache"
    r")\b|[a-z][a-z0-9]*_[a-z0-9_]+",
    re.IGNORECASE,
)


class ResearchQueueAggregatorService:
    """Build a read-only queue without changing upstream rankings or memberships."""

    def build_queue(
        self,
        *,
        scanner_payload: Mapping[str, Any] | None = None,
        watchlist_overlay: Mapping[str, Any] | None = None,
        market_payload: Mapping[str, Any] | None = None,
        limit: int = RESEARCH_QUEUE_LIMIT,
    ) -> dict[str, Any]:
        bounded_limit = _bounded_limit(limit)
        scanner_source = copy.deepcopy(_mapping(scanner_payload))
        watchlist_source = copy.deepcopy(_mapping(watchlist_overlay))
        market_source = copy.deepcopy(_mapping(market_payload))
        source_states = {
            "scanner": _scanner_source_state(scanner_payload),
            "watchlist": _watchlist_source_state(watchlist_overlay),
            "market": _market_source_state(market_payload),
        }
        items = _dedupe_items([
            *self._watchlist_items(watchlist_source),
            *self._scanner_items(scanner_source),
            *self._market_items(market_source),
        ])
        _apply_contradiction_guard(items)
        items = items[:bounded_limit]
        evidence_gaps = _dedupe(
            gap
            for item in items
            for gap in list(item.get("evidenceGaps") or [])
        )
        source_surfaces = _dedupe(item.get("sourceSurface") for item in items)
        available_sources = [
            source
            for source in _CANONICAL_SOURCE_SURFACES
            if source_states[source] != "unavailable"
        ]
        unavailable_sources = [
            source
            for source in _CANONICAL_SOURCE_SURFACES
            if source_states[source] == "unavailable"
        ]
        state = _queue_data_quality_state(items, source_states)
        return {
            "schemaVersion": RESEARCH_QUEUE_SCHEMA_VERSION,
            "researchQueue": items,
            "aggregateSummary": {
                "itemCount": len(items),
                "limit": bounded_limit,
                "bounded": len(items) >= bounded_limit,
                "bySourceSurface": dict(Counter(item.get("sourceSurface") for item in items)),
                "byPriorityTier": {
                    tier: sum(1 for item in items if item.get("priorityTier") == tier)
                    for tier in _PRIORITY_TIERS
                },
            },
            "sourceSurfacesAggregated": source_surfaces,
            "evidenceGaps": evidence_gaps,
            "dataQuality": {
                "state": state,
                "itemCount": len(items),
                "sourceSurfacesAvailable": available_sources,
                "sourceSurfacesExpected": list(_SOURCE_SURFACES),
                "sourceSurfacesUnavailable": unavailable_sources,
                "failClosed": True,
            },
            "noAdviceDisclosure": RESEARCH_QUEUE_NO_ADVICE_DISCLOSURE,
            "observationOnly": True,
            "decisionGrade": False,
        }

    @classmethod
    def _watchlist_items(cls, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for entry in list(payload.get("researchPriorityQueue") or []):
            source = _mapping(entry)
            symbol = _symbol(source.get("symbol"))
            if not symbol:
                continue
            reason = _first_safe_text(source.get("priorityReasonSafeLabel")) or (
                "Watchlist research priority needs review."
            )
            evidence_age = _mapping(source.get("evidenceAge"))
            result.append(
                {
                    "queueItemId": _queue_item_id("watchlist", source.get("id") or symbol),
                    "sourceSurface": "watchlist",
                    "symbol": symbol,
                    "title": f"{symbol} watchlist research priority",
                    "priorityTier": _watchlist_priority_tier(source.get("priorityTier")),
                    "whyQueued": [reason],
                    "evidenceUsed": [reason],
                    "evidenceGaps": _safe_text_list(source.get("missingEvidence")),
                    "readiness": _watchlist_readiness(source),
                    "provenance": _provenance("watchlist", source),
                    "dataAsOf": _optional_safe_public_text(
                        source.get("dataAsOf")
                        or source.get("asOf")
                        or evidence_age.get("asOf")
                        or evidence_age.get("dataAsOf")
                    ),
                    "freshness": {
                        "state": _freshness_state(evidence_age.get("state")),
                        "lastReviewedAt": _optional_safe_public_text(evidence_age.get("lastReviewedAt")),
                    },
                    "materialChange": _material_change(source),
                    "suggestedResearchPath": _safe_research_path(source.get("suggestedResearchPath")),
                    "observationOnly": True,
                }
            )
        return result

    @classmethod
    def _scanner_items(cls, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        if _scanner_payload_failed(payload):
            return result
        run_id = _safe_public_token(payload.get("id") or payload.get("runId"))
        candidates = payload.get("shortlist") if isinstance(payload.get("shortlist"), list) else None
        if not candidates:
            candidates = payload.get("selected") if isinstance(payload.get("selected"), list) else []

        for candidate_value in candidates:
            candidate = _mapping(candidate_value)
            if _scanner_candidate_failed(candidate):
                continue
            symbol = _symbol(candidate.get("symbol") or candidate.get("ticker"))
            if not symbol:
                continue
            packet = _mapping(candidate.get("candidateResearchPacket"))
            evidence_gaps = _safe_text_list(
                packet.get("limitingEvidence")
                or _mapping(candidate.get("candidateResearchReadiness")).get("missingEvidence")
                or _mapping(candidate.get("consumerDiagnostics")).get("missingEvidence")
            )
            why_queued = _safe_text_list(
                [
                    packet.get("whySurfaced"),
                    candidate.get("reason_summary"),
                ],
                limit=3,
            )
            if not why_queued:
                why_queued = ["Scanner candidate is available for follow-up research review."]
            next_step = _first_safe_text(packet.get("researchNextStep")) or (
                "Open structure detail for evidence review."
            )
            readiness = _scanner_readiness(candidate, packet)
            result.append(
                {
                    "queueItemId": _queue_item_id("scanner", candidate.get("id") or symbol, run_id=run_id),
                    "sourceSurface": "scanner",
                    "symbol": symbol,
                    "title": f"{symbol} scanner candidate",
                    "priorityTier": _scanner_priority_tier(evidence_gaps, readiness),
                    "whyQueued": why_queued,
                    "evidenceUsed": _safe_text_list(packet.get("primaryEvidence"), limit=4),
                    "evidenceGaps": evidence_gaps,
                    "readiness": readiness,
                    "provenance": _provenance("scanner", candidate, _mapping(candidate.get("consumerDiagnostics")), payload),
                    "dataAsOf": _optional_safe_public_text(
                        candidate.get("dataAsOf")
                        or candidate.get("data_as_of")
                        or candidate.get("asOf")
                        or candidate.get("observedAt")
                        or payload.get("dataAsOf")
                        or payload.get("data_as_of")
                        or payload.get("asOf")
                    ),
                    "freshness": {
                        "state": _freshness_state(
                            _mapping(candidate.get("consumerDiagnostics")).get("freshnessState")
                            or _freshness_from_notes(packet.get("dataQualityNotes"))
                        ),
                        "lastReviewedAt": _safe_public_text(
                            candidate.get("scan_timestamp")
                            or payload.get("completed_at")
                            or payload.get("completedAt")
                            or payload.get("run_at")
                            or payload.get("runAt")
                        )
                        or None,
                    },
                    "materialChange": _material_change(candidate),
                    "suggestedResearchPath": [
                        {
                            "label": "Stock Structure",
                            "route": f"/stocks/{quote(symbol, safe='')}/structure-decision",
                            "section": "researchQueue",
                            "reason": next_step,
                        }
                    ],
                    "observationOnly": True,
                }
            )
        return result

    @classmethod
    def _market_items(cls, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        if not _authentic_current_projection(payload):
            return []
        preview = _mapping(payload.get("researchQueuePreview"))
        candidates = preview.get("topCandidates")
        if not isinstance(candidates, list):
            candidates = payload.get("researchQueue") if isinstance(payload.get("researchQueue"), list) else None
        if not isinstance(candidates, list):
            benchmark = _symbol(payload.get("benchmarkSymbol"))
            candidates = [{
                "symbol": benchmark,
                "whyQueued": [payload.get("productSummary")],
                "evidenceGaps": _safe_text_list(payload.get("missingDataFamilies")),
                "readiness": {"state": "research_ready"},
                "provenanceState": "current",
                "asOf": _market_as_of(payload),
                "freshnessState": _market_freshness(payload),
            }] if benchmark else []
        result: list[dict[str, Any]] = []
        for candidate_value in candidates:
            candidate = _mapping(candidate_value)
            symbol = _symbol(candidate.get("symbol") or candidate.get("ticker"))
            if not symbol:
                continue
            gaps = _safe_text_list(candidate.get("evidenceGaps"))
            why = _safe_text_list(
                [
                    candidate.get("whyQueued"),
                    candidate.get("whyOnRadar"),
                    candidate.get("researchBias"),
                ],
                limit=3,
            ) or ["Market context surfaced this item for research review."]
            result.append(
                {
                    "queueItemId": _queue_item_id("market", candidate.get("id") or symbol),
                    "sourceSurface": "market",
                    "symbol": symbol,
                    "title": f"{symbol} market research context",
                    "priorityTier": "urgent_review" if gaps else "follow_up",
                    "whyQueued": why,
                    "evidenceUsed": _safe_text_list(candidate.get("evidenceUsed"), limit=4),
                    "evidenceGaps": gaps,
                    "readiness": _market_readiness(candidate),
                    "provenance": _provenance("market", candidate, payload),
                    "dataAsOf": _optional_safe_public_text(candidate.get("asOf") or payload.get("asOf")),
                    "freshness": {
                        "state": _freshness_state(
                            candidate.get("freshnessState")
                            or _mapping(candidate.get("freshness")).get("state")
                            or payload.get("freshnessState")
                            or _mapping(payload.get("freshness")).get("state")
                        ),
                        "lastReviewedAt": _optional_safe_public_text(
                            candidate.get("lastReviewedAt")
                            or _mapping(candidate.get("freshness")).get("lastReviewedAt")
                        ),
                    },
                    "materialChange": _material_change(candidate),
                    "suggestedResearchPath": _safe_research_path(candidate.get("suggestedResearchPath")),
                    "observationOnly": True,
                }
            )
        return result

def _watchlist_priority_tier(value: Any) -> str:
    normalized = _text(value)
    if normalized == "attention":
        return "urgent_review"
    if normalized == "follow_up":
        return "follow_up"
    return "monitor"


def _queue_data_quality_state(items: Sequence[Mapping[str, Any]], source_states: Mapping[str, str]) -> str:
    canonical_states = [source_states[source] for source in _CANONICAL_SOURCE_SURFACES]
    if all(state == "unavailable" for state in canonical_states):
        return "unavailable"
    if not items:
        return "no_evidence" if all(state != "unavailable" for state in canonical_states) else "partial"
    if any(state == "unavailable" for state in canonical_states):
        return "partial"
    if any(item.get("readiness", {}).get("state") != "research_ready" for item in items):
        return "partial"
    return "ready"


def _dedupe_items(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        item_id = _text(item.get("queueItemId"))
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        result.append(dict(item))
    return result


def _scanner_candidate_failed(candidate: Mapping[str, Any]) -> bool:
    status = _text(candidate.get("status") or candidate.get("candidateStatus")).lower()
    return status in {"failed", "data_failed", "error", "skipped"}


def _scanner_payload_failed(payload: Mapping[str, Any]) -> bool:
    status = _text(payload.get("status") or payload.get("runStatus") or payload.get("run_status")).lower()
    return status in {"failed", "data_failed", "error", "skipped"}


def _scanner_source_state(payload: Mapping[str, Any] | None) -> str:
    if payload is None:
        return "unavailable"
    source = _mapping(payload)
    if _scanner_payload_failed(source) or _text(source.get("sourceState")).lower() in {"unavailable", "failed", "data_failed", "error"}:
        return "unavailable"
    if not source:
        return "no_evidence"
    candidates = source.get("shortlist") if isinstance(source.get("shortlist"), list) else source.get("selected")
    if isinstance(candidates, list) and candidates and all(_scanner_candidate_failed(_mapping(candidate)) for candidate in candidates):
        return "unavailable"
    return "available"


def _watchlist_source_state(payload: Mapping[str, Any] | None) -> str:
    if payload is None:
        return "unavailable"
    source = _mapping(payload)
    overlay_state = _text(source.get("overlayState") or _mapping(source.get("dataQuality")).get("state")).lower()
    if overlay_state in {"unavailable", "failed", "data_failed", "error"} or _text(source.get("sourceState")).lower() in {"unavailable", "failed", "data_failed", "error"}:
        return "unavailable"
    if not source:
        return "no_evidence"
    return "available"


def _market_source_state(payload: Mapping[str, Any] | None) -> str:
    if payload is None:
        return "unavailable"
    source = _mapping(payload)
    if not source:
        return "no_evidence"
    if _text(source.get("sourceState")).lower() in {"unavailable", "failed", "data_failed", "error"}:
        return "unavailable"
    if source.get("currentReadProjection") is True:
        return "available" if _authentic_current_projection(source) else "unavailable"
    if _text(source.get("status")).lower() in {"ok", "ready"}:
        return "available"
    if not _authentic_current_projection(source):
        return "unavailable"
    return "available"


def _evidence_state(value: Any) -> str:
    state = _text(value).lower()
    if state in {"ready", "available", "complete", "current"}:
        return "available"
    if state in {"unavailable", "blocked", "failed", "data_failed", "error"}:
        return "unavailable"
    if state in {"partial", "limited", "stale", "fallback", "fixture", "simulated"}:
        return "partial"
    return "no_evidence"


def _scanner_readiness(candidate: Mapping[str, Any], packet: Mapping[str, Any]) -> dict[str, str]:
    readiness = _mapping(candidate.get("candidateResearchReadiness"))
    backtest = _first_backtest_mapping(candidate, readiness)
    state = _text(readiness.get("state") or readiness.get("readinessState")).lower()
    backtest_status = _text(backtest.get("status") or backtest.get("state")).lower()
    contract_available = _first_present(backtest, "result_contract_available", "resultContractAvailable", "result_contract_available_state")
    if (
        backtest_status in {"blocked", "unavailable", "failed", "data_failed", "error"}
        or contract_available is False
        or (backtest_status in {"completed", "complete", "succeeded", "success"} and contract_available is not True)
    ):
        return {"state": "blocked", "evidenceState": "unavailable"}
    if state in {"blocked", "unavailable", "failed", "data_failed"}:
        return {"state": "blocked" if state == "blocked" else "unavailable", "evidenceState": _evidence_state(state)}
    if state in {"ready", "research_ready"} and packet.get("observationOnly") is True:
        return {"state": "research_ready", "evidenceState": "available"}
    return {"state": "needs_evidence", "evidenceState": _evidence_state(state or "no_evidence")}


def _watchlist_readiness(source: Mapping[str, Any]) -> dict[str, str]:
    readiness = _mapping(
        source.get("readiness")
        or source.get("researchReadiness")
        or source.get("research_readiness")
    )
    state = _text(readiness.get("state") or source.get("readinessState")).lower()
    if not state:
        state = _text(_mapping(source.get("evidenceAge")).get("state")).lower()
    if state in {"ready", "available", "research_ready"}:
        return {"state": "research_ready", "evidenceState": "available"}
    if state in {"blocked", "unavailable", "failed"}:
        return {"state": "blocked" if state == "blocked" else "unavailable", "evidenceState": _evidence_state(state)}
    return {"state": "needs_evidence", "evidenceState": _evidence_state(state or "no_evidence")}


def _market_readiness(candidate: Mapping[str, Any]) -> dict[str, str]:
    state = _text(_mapping(candidate.get("readiness")).get("state") or candidate.get("readinessState")).lower()
    if state in {"ready", "research_ready"}:
        return {"state": "research_ready", "evidenceState": "available"}
    if state in {"blocked", "unavailable"}:
        return {"state": "blocked" if state == "blocked" else "unavailable", "evidenceState": _evidence_state(state)}
    return {"state": "needs_evidence", "evidenceState": _evidence_state(state or "no_evidence")}


def _provenance(surface: str, *values: Mapping[str, Any]) -> dict[str, str]:
    states: set[str] = set()
    for value in values:
        for key in ("provenanceState", "sourceState", "state", "freshnessState"):
            raw = _text(value.get(key)).lower()
            states.update(token for token in re.split(r"[^a-z]+", raw) if token)
    non_current_states = {"fixture", "simulated", "fallback", "unavailable", "partial"}
    if "current" in states and states & non_current_states:
        return {"sourceSurface": surface, "state": "unavailable"}
    for state in ("fixture", "simulated", "fallback", "unavailable", "partial", "current"):
        if state in states:
            return {"sourceSurface": surface, "state": state}
    return {"sourceSurface": surface, "state": "unknown"}


def _first_backtest_mapping(candidate: Mapping[str, Any], readiness: Mapping[str, Any]) -> dict[str, Any]:
    for value in (
        candidate.get("backtest"),
        candidate.get("backtestReadiness"),
        candidate.get("backtest_readiness"),
        candidate.get("backtestResult"),
        candidate.get("backtest_result"),
        readiness.get("backtest"),
        readiness.get("backtestReadiness"),
        readiness.get("backtest_readiness"),
        readiness.get("backtestResult"),
        readiness.get("backtest_result"),
    ):
        mapped = _mapping(value)
        if mapped:
            execution = _mapping(mapped.get("execution_readiness") or mapped.get("executionReadiness"))
            if execution:
                return {**mapped, **execution}
            return mapped
    return {}


def _first_present(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _apply_contradiction_guard(items: list[dict[str, Any]]) -> None:
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        by_symbol.setdefault(_text(item.get("symbol")), []).append(item)
    for symbol_items in by_symbol.values():
        if len(symbol_items) < 2:
            continue
        if not _has_contradictory_evidence(symbol_items):
            continue
        for item in symbol_items:
            readiness = _mapping(item.get("readiness"))
            if readiness.get("state") == "research_ready":
                readiness = {"state": "needs_evidence", "evidenceState": "partial"}
                item["readiness"] = readiness
            item["evidenceGaps"] = _dedupe([
                *list(item.get("evidenceGaps") or []),
                "Contradictory source evidence needs review.",
            ])
            item["priorityTier"] = "urgent_review"


def _has_contradictory_evidence(items: Sequence[Mapping[str, Any]]) -> bool:
    for index, current in enumerate(items):
        current_readiness = _text(_mapping(current.get("readiness")).get("state"))
        current_provenance = _text(_mapping(current.get("provenance")).get("state"))
        current_as_of = _text(current.get("dataAsOf"))
        for other in items[index + 1:]:
            other_readiness = _text(_mapping(other.get("readiness")).get("state"))
            other_provenance = _text(_mapping(other.get("provenance")).get("state"))
            other_as_of = _text(other.get("dataAsOf"))
            if current_readiness and other_readiness and current_readiness != other_readiness:
                return True
            if (
                current_provenance not in {"", "unknown"}
                and other_provenance not in {"", "unknown"}
                and current_provenance != other_provenance
            ):
                return True
            if current_as_of and other_as_of and current_as_of != other_as_of:
                return True
    return False


def _material_change(source: Mapping[str, Any]) -> dict[str, Any]:
    historical = _mapping(source.get("authoritativeHistoricalChange"))
    if historical.get("available") is True and _text(historical.get("state")).lower() in {"new", "changed", "unchanged", "seen"}:
        return {"state": "asserted", "asserted": True}
    return {"state": "unknown", "asserted": False}


def _authentic_current_projection(payload: Mapping[str, Any]) -> bool:
    if payload.get("currentReadProjection") is True:
        return _provenance("market", payload).get("state") == "current"
    status = _text(payload.get("status")).lower()
    readiness = _mapping(payload.get("readiness"))
    quality = _mapping(payload.get("dataQuality"))
    if status != "ok" or _text(readiness.get("status")).lower() != "ok":
        return False
    if payload.get("missingDataFamilies") or payload.get("blockedProductSurfaces"):
        return False
    if _text(quality.get("status")).lower() in {"failed", "failed_closed", "blocked", "unavailable", "partial"}:
        return False
    return _text(payload.get("regimeLabel") or _mapping(payload.get("regime")).get("label")).lower() not in {"", "insufficient_data"}


def _market_as_of(payload: Mapping[str, Any]) -> str | None:
    projection = _mapping(payload.get("regimeEvidenceProjection"))
    return _optional_safe_public_text(payload.get("asOf") or projection.get("asOf"))


def _market_freshness(payload: Mapping[str, Any]) -> str:
    projection = _mapping(payload.get("regimeEvidenceProjection"))
    return _freshness_state(projection.get("freshness") or _mapping(payload.get("readiness")).get("freshness"))


def _scanner_priority_tier(evidence_gaps: Sequence[str], readiness: Mapping[str, Any]) -> str:
    if readiness.get("state") in {"blocked", "unavailable"} or evidence_gaps:
        return "urgent_review"
    return "follow_up"


def _freshness_state(value: Any) -> str:
    normalized = _text(value).lower()
    if normalized in {"fresh", "current", "ready", "available", "complete"}:
        return "current"
    if normalized in {"stale", "delayed", "fallback", "stale_or_cached", "partial", "limited"}:
        return "needs_review"
    if normalized in {"unavailable", "unsupported", "unsupported_market"}:
        return "unavailable"
    if normalized in {"no_evidence", "symbol_unknown", "missing"}:
        return "needs_review"
    return "unknown"


def _freshness_from_notes(value: Any) -> str:
    for note in _text_list(value):
        label, separator, state = note.partition(":")
        if separator and label.strip().lower() == "freshness":
            return state.strip()
    return ""


def _safe_research_path(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for entry_value in value:
        entry = _mapping(entry_value)
        label = _safe_public_text(entry.get("label"))
        route = _safe_route(entry.get("route"))
        section = _safe_public_text(entry.get("section"))
        reason = _safe_public_text(entry.get("reason"))
        if not label or not route or not section:
            continue
        key = (label, route, section, reason or "")
        if key in seen:
            continue
        seen.add(key)
        result.append({"label": label, "route": route, "section": section, "reason": reason or ""})
    return result[:1]


def _safe_route(value: Any) -> str:
    route = _text(value)
    if not route.startswith("/") or _FORBIDDEN_TEXT_RE.search(route) or _RAW_DIAGNOSTIC_RE.search(route):
        return ""
    return route


def _queue_item_id(
    source: str,
    symbol: str,
    *,
    run_id: str | None = None,
) -> str:
    parts = [source, _safe_public_token(symbol)]
    if run_id:
        parts.extend(["run", _safe_public_token(run_id)])
    return "-".join(part for part in parts if part)


def _bounded_limit(value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = RESEARCH_QUEUE_LIMIT
    return max(1, min(parsed, RESEARCH_QUEUE_LIMIT))


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        dumped = value.model_dump()
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _symbol(value: Any) -> str:
    return _safe_public_token(value).upper()


def _safe_public_token(value: Any) -> str:
    text = _text(value).upper()
    return re.sub(r"[^A-Z0-9.-]+", "-", text).strip("-")


def _safe_text_list(value: Any, *, limit: int = 6) -> list[str]:
    return _dedupe(_safe_public_text(item) for item in _text_list(value) if _safe_public_text(item))[:limit]


def _text_list(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, Mapping):
        values: Iterable[Any] = value.values()
    elif isinstance(value, (list, tuple, set)):
        values = value
    else:
        values = [value]
    return [_text(item) for item in values if _text(item)]


def _first_safe_text(*values: Any) -> str:
    for value in values:
        safe = _safe_public_text(value)
        if safe:
            return safe
    return ""


def _safe_public_text(value: Any) -> str:
    text = _text(value)
    if not text:
        return ""
    if _FORBIDDEN_TEXT_RE.search(text) or _RAW_DIAGNOSTIC_RE.search(text):
        return ""
    return text


def _optional_safe_public_text(value: Any) -> str | None:
    return _safe_public_text(value) or None


def _dedupe(items: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = _text(item)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _safe_int(value: Any) -> int | None:
    try:
        if value in (None, "") or isinstance(value, bool):
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str:
    return str(value or "").strip()


__all__ = [
    "RESEARCH_QUEUE_LIMIT",
    "RESEARCH_QUEUE_NO_ADVICE_DISCLOSURE",
    "RESEARCH_QUEUE_SCHEMA_VERSION",
    "ResearchQueueAggregatorService",
]
