# -*- coding: utf-8 -*-
"""Contract tests for the unified research queue aggregator."""

from __future__ import annotations

import copy
import json

from src.services.research_queue_aggregator_service import (
    RESEARCH_QUEUE_NO_ADVICE_DISCLOSURE,
    RESEARCH_QUEUE_SCHEMA_VERSION,
    ResearchQueueAggregatorService,
)


FORBIDDEN_PUBLIC_TERMS = (
    "buy",
    "sell",
    "hold",
    "recommendation",
    "target price",
    "stop loss",
    "position sizing",
    "买入",
    "卖出",
    "持有",
    "交易建议",
    "投资建议",
    "目标价",
    "止损",
    "仓位",
)
FORBIDDEN_RAW_TERMS = (
    "provider",
    "request id",
    "trace id",
    "debug",
    "raw payload",
    "raw diagnostics",
    "runtime",
)


def _serialized_values(payload: object) -> str:
    values: list[str] = []

    def visit(value: object) -> None:
        if isinstance(value, str):
            values.append(value)
            return
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                visit(item)

    visit(payload)
    return json.dumps(values, ensure_ascii=False, sort_keys=True).lower()


def _scanner_payload() -> dict[str, object]:
    return {
        "id": 42,
        "completed_at": "2026-06-15T09:30:00+00:00",
        "shortlist": [
            {
                "symbol": "ALFA",
                "rank": 1,
                "score": 82.0,
                "consumerDiagnostics": {"freshnessState": "fresh"},
                "candidateResearchPacket": {
                    "whySurfaced": "Scanner evidence explains why this candidate merits research today.",
                    "primaryEvidence": ["Technicals available", "Liquidity available"],
                    "limitingEvidence": [],
                    "dataQualityNotes": ["freshness: fresh"],
                    "researchNextStep": "Confirm evidence persistence.",
                    "observationOnly": True,
                },
                "diagnostics": {
                    "providerTrace": "provider debug trace id should never leak",
                    "raw_payload": "raw payload should never leak",
                },
            },
            {
                "symbol": "BETA",
                "rank": 2,
                "score": 71.0,
                "consumerDiagnostics": {"freshnessState": "delayed"},
                "candidateResearchPacket": {
                    "whySurfaced": "Evidence is incomplete, so review support before confidence improves.",
                    "primaryEvidence": ["Trend evidence available"],
                    "limitingEvidence": ["Fundamental evidence is missing."],
                    "dataQualityNotes": ["freshness: delayed"],
                    "researchNextStep": "Review missing support.",
                    "observationOnly": True,
                },
            },
        ],
    }


def _watchlist_overlay() -> dict[str, object]:
    return {
        "researchPriorityQueue": [
            {
                "symbol": "MSFT",
                "priorityTier": "attention",
                "priorityReasonSafeLabel": "Missing evidence needs review.",
                "evidenceAge": {"state": "no_evidence", "lastReviewedAt": None},
                "missingEvidence": ["Price-history evidence"],
                "suggestedResearchPath": [
                    {
                        "label": "Stock Structure",
                        "route": "/stocks/MSFT/structure-decision",
                        "section": "watchlistResearchOverlay",
                        "reason": "Open symbol structure detail.",
                    }
                ],
                "observationOnly": True,
            }
        ],
        "observationOnly": True,
    }


def test_build_queue_aggregates_watchlist_then_scanner_without_mutating_inputs() -> None:
    scanner_payload = _scanner_payload()
    watchlist_overlay = _watchlist_overlay()
    original_scanner = copy.deepcopy(scanner_payload)
    original_watchlist = copy.deepcopy(watchlist_overlay)

    payload = ResearchQueueAggregatorService().build_queue(
        scanner_payload=scanner_payload,
        watchlist_overlay=watchlist_overlay,
        limit=10,
    )

    assert scanner_payload == original_scanner
    assert watchlist_overlay == original_watchlist
    assert payload["schemaVersion"] == RESEARCH_QUEUE_SCHEMA_VERSION
    assert payload["noAdviceDisclosure"] == RESEARCH_QUEUE_NO_ADVICE_DISCLOSURE
    assert payload["observationOnly"] is True
    assert payload["decisionGrade"] is False
    assert payload["sourceSurfacesAggregated"] == ["watchlist", "scanner"]
    assert payload["aggregateSummary"]["itemCount"] == 3
    assert payload["aggregateSummary"]["bySourceSurface"] == {"watchlist": 1, "scanner": 2}
    assert payload["aggregateSummary"]["byPriorityTier"] == {
        "urgent_review": 2,
        "follow_up": 1,
        "monitor": 0,
    }

    queue = payload["researchQueue"]
    assert [item["sourceSurface"] for item in queue] == ["watchlist", "scanner", "scanner"]
    assert [item["symbol"] for item in queue] == ["MSFT", "ALFA", "BETA"]

    watchlist_item = queue[0]
    assert watchlist_item["queueItemId"] == "watchlist-MSFT"
    assert watchlist_item["priorityTier"] == "urgent_review"
    assert watchlist_item["whyQueued"] == ["Missing evidence needs review."]
    assert watchlist_item["evidenceGaps"] == ["Price-history evidence"]
    assert watchlist_item["readiness"] == {"state": "needs_evidence", "evidenceState": "no_evidence"}
    assert watchlist_item["provenance"] == {"sourceSurface": "watchlist", "state": "unknown"}
    assert watchlist_item["materialChange"] == {"state": "unknown", "asserted": False}
    assert watchlist_item["freshness"] == {"state": "needs_review", "lastReviewedAt": None}
    assert watchlist_item["suggestedResearchPath"] == [
        {
            "label": "Stock Structure",
            "route": "/stocks/MSFT/structure-decision",
            "section": "watchlistResearchOverlay",
            "reason": "Open symbol structure detail.",
        }
    ]

    scanner_item = queue[1]
    assert scanner_item["queueItemId"] == "scanner-ALFA-run-42"
    assert scanner_item["priorityTier"] == "follow_up"
    assert scanner_item["evidenceUsed"] == ["Technicals available", "Liquidity available"]
    assert scanner_item["evidenceGaps"] == []
    assert scanner_item["readiness"] == {"state": "needs_evidence", "evidenceState": "no_evidence"}
    assert scanner_item["freshness"] == {
        "state": "current",
        "lastReviewedAt": "2026-06-15T09:30:00+00:00",
    }
    assert scanner_item["suggestedResearchPath"][0]["route"] == "/stocks/ALFA/structure-decision"

    gap_item = queue[2]
    assert gap_item["symbol"] == "BETA"
    assert gap_item["priorityTier"] == "urgent_review"
    assert gap_item["evidenceGaps"] == ["Fundamental evidence is missing."]
    assert gap_item["freshness"]["state"] == "needs_review"
    assert payload["evidenceGaps"] == ["Price-history evidence", "Fundamental evidence is missing."]

    constrained = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"shortlist": [
            {"symbol": "DROP", "status": "data_failed"},
            {"symbol": "KEEP", "candidateResearchReadiness": {"state": "ready"}, "candidateResearchPacket": {"observationOnly": True, "whySurfaced": "Evidence review."}, "backtest": {"result_contract_available": False}, "consumerDiagnostics": {"freshnessState": "fixture"}},
        ]},
        watchlist_overlay={"researchPriorityQueue": [{"symbol": "WATCH", "readinessState": "unavailable", "priorityReasonSafeLabel": "Evidence needs review."}]},
        market_payload={"researchQueue": [{"symbol": "MKT"}]},
    )
    assert [item["symbol"] for item in constrained["researchQueue"]] == ["WATCH", "KEEP"]
    assert constrained["researchQueue"][0]["readiness"]["state"] == "unavailable"
    assert constrained["researchQueue"][1]["readiness"]["state"] == "blocked"
    assert constrained["researchQueue"][1]["provenance"]["state"] == "fixture"
    assert constrained["dataQuality"]["state"] == "partial"
    assert constrained["dataQuality"]["sourceSurfacesUnavailable"] == ["market"]

    canonical_market = ResearchQueueAggregatorService().build_queue(
        market_payload={
            "status": "ok",
            "benchmarkSymbol": "SPY",
            "regimeLabel": "mixed",
            "readiness": {"status": "ok"},
            "dataQuality": {"status": "ready"},
            "productSummary": "Benchmark breadth evidence is available for research review.",
            "regimeEvidenceProjection": {"asOf": "2026-06-15T09:00:00Z", "freshness": "ready"},
        },
    )
    assert [item["symbol"] for item in canonical_market["researchQueue"]] == ["SPY"]
    assert canonical_market["researchQueue"][0]["provenance"]["state"] == "current"
    assert canonical_market["researchQueue"][0]["dataAsOf"] == "2026-06-15T09:00:00Z"
    assert canonical_market["dataQuality"]["state"] == "partial"

    ready_watchlist = ResearchQueueAggregatorService().build_queue(
        watchlist_overlay={
            "researchPriorityQueue": [{
                "symbol": "READY",
                "priorityTier": "monitor",
                "priorityReasonSafeLabel": "Research context is ready for follow-up.",
                "evidenceAge": {"state": "available", "asOf": "2026-06-15T09:00:00Z"},
            }]
        },
    )
    assert ready_watchlist["researchQueue"][0]["readiness"] == {
        "state": "research_ready",
        "evidenceState": "available",
    }
    assert ready_watchlist["researchQueue"][0]["dataAsOf"] == "2026-06-15T09:00:00Z"

    no_candidates = ResearchQueueAggregatorService().build_queue(
        scanner_payload={},
        watchlist_overlay={},
        market_payload={},
    )
    assert no_candidates["researchQueue"] == []
    assert no_candidates["dataQuality"]["state"] == "no_evidence"
    assert no_candidates["dataQuality"]["sourceSurfacesAvailable"] == ["scanner", "watchlist", "market"]

    run_failed = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"status": "failed", "shortlist": [{"symbol": "DROP"}]},
        watchlist_overlay={"researchPriorityQueue": [{
            "symbol": "WATCH",
            "priorityReasonSafeLabel": "Evidence needs review.",
            "evidenceAge": {"state": "available"},
        }]},
        market_payload={
            "currentReadProjection": True,
            "provenanceState": "fallback",
            "researchQueue": [{"symbol": "MKT", "readinessState": "ready"}],
        },
    )
    assert [item["symbol"] for item in run_failed["researchQueue"]] == ["WATCH"]
    assert run_failed["dataQuality"]["sourceSurfacesUnavailable"] == ["scanner", "market"]
    assert run_failed["dataQuality"]["state"] == "partial"

    zero_trade = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"shortlist": [{
            "symbol": "ZERO",
            "candidateResearchReadiness": {"state": "ready"},
            "candidateResearchPacket": {"observationOnly": True, "whySurfaced": "Evidence review."},
            "backtest": {"status": "completed", "result_contract_available": True, "trade_count": 0},
        }]}
    )
    assert zero_trade["researchQueue"][0]["readiness"]["state"] == "research_ready"

    production_backtest_blocked = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"shortlist": [{
            "symbol": "BLOCKED",
            "candidateResearchReadiness": {"state": "ready"},
            "candidateResearchPacket": {"observationOnly": True, "whySurfaced": "Evidence review."},
            "backtest": {
                "sample_readiness_state": "no_samples",
                "execution_readiness": {
                    "state": "data_disabled",
                    "result_contract_available": False,
                },
            },
        }]}
    )
    assert production_backtest_blocked["researchQueue"][0]["readiness"] == {
        "state": "blocked",
        "evidenceState": "unavailable",
    }

    production_zero_trade = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"shortlist": [{
            "symbol": "ZERO-PROD",
            "candidateResearchReadiness": {"state": "ready"},
            "candidateResearchPacket": {"observationOnly": True, "whySurfaced": "Evidence review."},
            "backtest": {
                "sample_readiness_state": "ready",
                "execution_readiness": {
                    "state": "ready",
                    "result_contract_available": True,
                    "trade_count": 0,
                },
            },
        }]}
    )
    assert production_zero_trade["researchQueue"][0]["readiness"]["state"] == "research_ready"

    contradictory = ResearchQueueAggregatorService().build_queue(
        scanner_payload={"shortlist": [{
            "symbol": "ALFA",
            "candidateResearchReadiness": {"state": "ready"},
            "candidateResearchPacket": {"observationOnly": True, "whySurfaced": "Scanner evidence."},
            "provenanceState": "current",
            "dataAsOf": "2026-06-15T09:00:00Z",
        }]},
        watchlist_overlay={"researchPriorityQueue": [{
            "symbol": "ALFA",
            "priorityReasonSafeLabel": "Evidence needs refresh.",
            "evidenceAge": {"state": "stale", "asOf": "2026-06-14T09:00:00Z"},
        }]},
    )
    assert all(item["priorityTier"] == "urgent_review" for item in contradictory["researchQueue"])
    assert all("Contradictory source evidence needs review." in item["evidenceGaps"] for item in contradictory["researchQueue"])
    assert contradictory["researchQueue"][0]["readiness"]["state"] != "research_ready"

    scanner_payload["shortlist"][0]["authoritativeHistoricalChange"] = {"available": True, "state": "changed"}
    changed = ResearchQueueAggregatorService().build_queue(scanner_payload=scanner_payload)
    reordered = _scanner_payload()
    reordered["shortlist"] = list(reversed(reordered["shortlist"]))
    reloaded = ResearchQueueAggregatorService().build_queue(scanner_payload=reordered)
    assert {item["queueItemId"] for item in payload["researchQueue"] if item["sourceSurface"] == "scanner"} == {item["queueItemId"] for item in reloaded["researchQueue"]}
    assert changed["researchQueue"][0]["materialChange"] == {"state": "asserted", "asserted": True}


def test_build_queue_is_bounded_and_filters_advice_or_raw_diagnostic_values() -> None:
    scanner_payload = _scanner_payload()
    scanner_payload["shortlist"][0]["candidateResearchPacket"]["whySurfaced"] = "buy now"
    scanner_payload["shortlist"][0]["candidateResearchPacket"]["primaryEvidence"] = [
        "provider runtime debug",
        "Technicals available",
    ]
    scanner_payload["shortlist"][0]["candidateResearchPacket"]["researchNextStep"] = "target price review"

    payload = ResearchQueueAggregatorService().build_queue(
        scanner_payload=scanner_payload,
        watchlist_overlay=_watchlist_overlay(),
        limit=2,
    )

    assert len(payload["researchQueue"]) == 2
    assert payload["aggregateSummary"]["bounded"] is True
    serialized_queue = _serialized_values(payload["researchQueue"])
    for forbidden in (*FORBIDDEN_PUBLIC_TERMS, *FORBIDDEN_RAW_TERMS):
        assert forbidden.lower() not in serialized_queue
    assert "Technicals available".lower() in serialized_queue


def test_build_queue_fail_closed_when_no_source_signals_are_available() -> None:
    payload = ResearchQueueAggregatorService().build_queue()

    assert payload["researchQueue"] == []
    assert payload["sourceSurfacesAggregated"] == []
    assert payload["dataQuality"] == {
        "state": "unavailable",
        "itemCount": 0,
        "sourceSurfacesAvailable": [],
        "sourceSurfacesExpected": ["scanner", "watchlist", "market"],
        "sourceSurfacesUnavailable": ["scanner", "watchlist", "market"],
        "failClosed": True,
    }
    assert payload["observationOnly"] is True
    assert payload["decisionGrade"] is False
