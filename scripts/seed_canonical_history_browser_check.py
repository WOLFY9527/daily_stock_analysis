#!/usr/bin/env python3
"""Seed a deterministic analysis-history row for browser write-through verification."""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.analyzer import AnalysisResult
from src.repositories.analysis_repo import AnalysisRepository
from src.storage import AnalysisHistory, DatabaseManager


OWNER_ID = "bootstrap-admin"


def main() -> None:
    db = DatabaseManager.get_instance()
    repo = AnalysisRepository(db, owner_id=OWNER_ID)
    query_id = f"browser-check-{uuid.uuid4().hex[:12]}"
    generated_at = datetime.now(timezone.utc).isoformat()

    result = AnalysisResult(
        code="ORCL",
        name="Oracle Browser Check",
        sentiment_score=74,
        trend_prediction="趋势延续，等待确认后继续执行",
        operation_advice="持有",
        decision_type="hold",
        analysis_summary="Browser verification canonical report: database payload should replace any local snapshot.",
        technical_analysis="MACD 二次扩张，均线继续抬升。",
        fundamental_analysis="现金流与云业务 backlog 维持韧性。",
        news_summary="Recent earnings follow-through remains constructive.",
        risk_warning="若回踩跌破 117.40，需要重新评估节奏。",
        report_language="en",
    )

    saved = repo.save(
        result=result,
        query_id=query_id,
        report_type="detailed",
        news_content=result.news_summary,
        context_snapshot=None,
    )
    if saved != 1:
        raise SystemExit("failed to save verification history row")

    report_payload = {
        "meta": {
            "query_id": query_id,
            "stock_code": "ORCL",
            "stock_name": "Oracle Browser Check",
            "report_type": "detailed",
            "report_language": "en",
            "created_at": generated_at,
            "generated_at": generated_at,
            "report_generated_at": generated_at,
            "model_used": "browser-check-seed",
            "strategy_type": "hold",
        },
        "summary": {
            "analysis_summary": "Browser verification canonical report: database payload should replace any local snapshot.",
            "strategy_summary": "Open history and confirm the drawer shows the database-backed Oracle Browser Check report.",
            "operation_advice": "Hold while the pullback stays orderly.",
            "trend_prediction": "Constructive for the next 72 hours.",
            "sentiment_score": 74,
            "sentiment_label": "Bullish",
        },
        "strategy": {
            "ideal_buy": "121.80 - 124.60",
            "secondary_buy": "119.20 - 120.40",
            "stop_loss": "117.40",
            "take_profit": "133.50",
        },
        "details": {
            "news_summary": "Recent earnings follow-through remains constructive.",
            "standard_report": {
                "summary_panel": {
                    "stock": "Oracle Browser Check",
                    "ticker": "ORCL",
                    "one_sentence": "DB canonical report for browser verification.",
                    "report_generated_at": generated_at,
                },
                "decision_context": {
                    "short_term_view": "History drawer should reload this canonical payload from /api/v1/history/:id.",
                },
                "decision_panel": {
                    "ideal_entry": "121.80 - 124.60",
                    "target": "133.50",
                    "stop_loss": "117.40",
                    "build_strategy": "Use the persisted canonical report as the source of truth.",
                },
                "reason_layer": {
                    "core_reasons": [
                        "This row was seeded specifically to verify write-through persistence.",
                    ],
                },
                "technical_fields": [
                    {"label": "MACD", "value": "Second expansion above zero"},
                    {"label": "Moving Averages", "value": "MA20 lifting MA60"},
                ],
                "fundamental_fields": [
                    {"label": "Revenue Growth", "value": "+9.4%"},
                    {"label": "Free Cash Flow", "value": "$12.1B"},
                ],
            },
        },
    }

    attached = repo.attach_persisted_report(query_id, report_payload)
    if attached != 1:
        raise SystemExit("failed to attach canonical report payload")

    with db.get_session() as session:
        row = (
            session.query(AnalysisHistory)
            .filter(AnalysisHistory.query_id == query_id)
            .order_by(AnalysisHistory.id.desc())
            .first()
        )
        if row is None:
            raise SystemExit("verification row missing after attach")
        persisted = json.loads(row.raw_result or "{}").get("persisted_report") or {}

    print(
        json.dumps(
            {
                "record_id": row.id,
                "query_id": query_id,
                "generated_at": persisted.get("meta", {}).get("generated_at"),
                "analysis_summary": persisted.get("summary", {}).get("analysis_summary"),
                "one_sentence": (
                    (persisted.get("details", {}) or {})
                    .get("standard_report", {})
                    .get("summary_panel", {})
                    .get("one_sentence")
                ),
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
