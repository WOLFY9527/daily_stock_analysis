# -*- coding: utf-8 -*-
"""Integrated acceptance tests for stored-first rule-backtest reopen trustworthiness."""

import json
import os
import tempfile
import unittest
from datetime import date
from unittest.mock import patch

from src.config import Config
from src.services.rule_backtest_service import RuleBacktestService
from src.storage import DatabaseManager, StockDaily


class RuleBacktestReopenAcceptanceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self._db_path = os.path.join(self._temp_dir.name, "test_rule_backtest_acceptance.db")
        os.environ["DATABASE_PATH"] = self._db_path

        Config._instance = None
        DatabaseManager.reset_instance()
        self.db = DatabaseManager.get_instance()

        with self.db.get_session() as session:
            closes = [10, 10.2, 10.1, 10.5, 11.0, 11.6, 11.8, 11.2, 10.8, 10.2, 9.9, 10.3, 10.9, 11.4, 11.9, 12.1, 11.7, 11.1, 10.7, 10.4, 10.8, 11.3, 11.8, 12.2]
            for index, close in enumerate(closes):
                session.add(
                    StockDaily(
                        code="600519",
                        date=date(2024, 1, 1).fromordinal(date(2024, 1, 1).toordinal() + index),
                        open=close - 0.1,
                        high=close + 0.2,
                        low=close - 0.3,
                        close=float(close),
                    )
                )
            session.commit()

    def tearDown(self) -> None:
        DatabaseManager.reset_instance()
        self._temp_dir.cleanup()

    def _run_completed_backtest(self) -> tuple[RuleBacktestService, dict, object]:
        service = RuleBacktestService(self.db)
        with patch.object(service, "_get_llm_adapter", return_value=None):
            response = service.parse_and_run(
                code="600519",
                strategy_text="Buy when Close > MA3. Sell when Close < MA3.",
                lookback_bars=20,
                confirmed=True,
            )

        run_row = service.repo.get_run(response["id"])
        assert run_row is not None
        return service, response, run_row

    def test_reopen_acceptance_detail_history_contract_stays_aligned_across_domains(self) -> None:
        service, _, run_row = self._run_completed_backtest()

        detail = service.get_run(run_row.id)
        status = service.get_run_status(run_row.id)
        history = service.list_runs(code="600519", page=1, limit=10)
        assert detail is not None
        assert status is not None
        item = history["items"][0]

        for domain in [
            "summary",
            "parsed_strategy",
            "metrics",
            "execution_model",
            "execution_assumptions_snapshot",
            "comparison",
        ]:
            self.assertEqual(
                detail["result_authority"]["domains"][domain],
                item["result_authority"]["domains"][domain],
            )

        self.assertEqual(detail["summary"]["parsed_strategy_summary"], detail["parsed_strategy"]["summary"])
        self.assertEqual(detail["summary"]["metrics"]["trade_count"], detail["trade_count"])
        self.assertEqual(detail["summary"]["metrics"]["final_equity"], detail["final_equity"])
        self.assertEqual(detail["summary"]["execution_model"], detail["execution_model"])
        self.assertEqual(detail["summary"]["execution_assumptions_snapshot"], detail["execution_assumptions_snapshot"])
        self.assertEqual(detail["summary"]["execution_trace"], detail["execution_trace"])
        self.assertEqual(detail["summary"]["visualization"]["audit_rows"], detail["audit_rows"])
        self.assertEqual(
            detail["summary"]["visualization"]["daily_return_series"],
            detail["daily_return_series"],
        )
        self.assertEqual(detail["summary"]["visualization"]["exposure_curve"], detail["exposure_curve"])

        self.assertEqual(item["summary"]["parsed_strategy_summary"], item["parsed_strategy"]["summary"])
        self.assertEqual(item["summary"]["metrics"]["trade_count"], item["trade_count"])
        self.assertEqual(item["summary"]["metrics"]["final_equity"], item["final_equity"])
        self.assertEqual(item["summary"]["execution_model"], item["execution_model"])
        self.assertEqual(item["summary"]["execution_assumptions_snapshot"], item["execution_assumptions_snapshot"])
        self.assertEqual(item["summary"]["execution_trace"], {})
        self.assertEqual(item["summary"]["visualization"]["audit_rows"], [])
        self.assertEqual(item["summary"]["visualization"]["daily_return_series"], [])
        self.assertEqual(item["summary"]["visualization"]["exposure_curve"], [])

        self.assertEqual(detail["artifact_availability"], item["artifact_availability"])
        self.assertEqual(status["artifact_availability"], item["artifact_availability"])
        self.assertEqual(detail["summary"]["artifact_availability"], detail["artifact_availability"])
        self.assertEqual(item["summary"]["artifact_availability"], item["artifact_availability"])
        self.assertTrue(detail["artifact_availability"]["has_trade_rows"])
        self.assertTrue(item["artifact_availability"]["has_trade_rows"])
        self.assertTrue(status["artifact_availability"]["has_trade_rows"])
        self.assertEqual(detail["readback_integrity"], item["readback_integrity"])
        self.assertEqual(detail["summary"]["readback_integrity"], detail["readback_integrity"])
        self.assertEqual(item["summary"]["readback_integrity"], item["readback_integrity"])
        self.assertEqual(detail["readback_integrity"]["integrity_level"], "stored_repaired")
        self.assertFalse(detail["readback_integrity"]["used_live_storage_repair"])

    def test_reopen_acceptance_repaired_detail_and_history_share_repaired_domains_without_summary_drift(self) -> None:
        service, response, run_row = self._run_completed_backtest()

        summary = json.loads(run_row.summary_json)
        comparison = dict((summary.get("visualization") or {}).get("comparison") or {})
        comparison.pop("buy_and_hold_summary", None)
        comparison.pop("buy_and_hold_curve", None)
        summary["request"] = {"lookback_bars": 20}
        summary["metrics"] = {"trade_count": response["trade_count"]}
        summary["execution_model"] = {"timeframe": "daily"}
        summary["execution_trace"] = {"source": "summary.execution_trace", "rows": []}
        summary["visualization"] = dict(summary.get("visualization") or {})
        summary["visualization"]["comparison"] = comparison
        service.repo.update_run(
            run_row.id,
            summary_json=service._serialize_json(summary),
            parsed_strategy_json=service._serialize_json(
                {
                    "version": "v1",
                    "timeframe": "daily",
                    "source_text": response["strategy_text"],
                    "normalized_text": response["strategy_text"],
                    "summary": response["parsed_strategy"]["summary"],
                    "strategy_kind": "moving_average_crossover",
                    "setup": {
                        "symbol": "600519",
                        "indicator_family": "moving_average",
                        "fast_period": 3,
                        "slow_period": 5,
                    },
                    "strategy_spec": {},
                }
            ),
        )

        detail = service.get_run(run_row.id)
        history = service.list_runs(code="600519", page=1, limit=10)
        assert detail is not None
        item = history["items"][0]

        for domain in [
            "summary",
            "parsed_strategy",
            "metrics",
            "execution_model",
            "comparison",
        ]:
            self.assertEqual(
                detail["result_authority"]["domains"][domain],
                item["result_authority"]["domains"][domain],
            )
            self.assertEqual(
                detail["result_authority"]["domains"][domain]["completeness"],
                "stored_partial_repaired",
            )

        self.assertEqual(detail["summary"]["execution_trace"], detail["execution_trace"])
        self.assertEqual(
            detail["summary"]["visualization"]["comparison"]["buy_and_hold_summary"],
            detail["buy_and_hold_summary"],
        )
        self.assertEqual(
            detail["summary"]["visualization"]["comparison"]["buy_and_hold_curve"],
            detail["buy_and_hold_curve"],
        )
        self.assertEqual(item["summary"]["execution_trace"], {})
        self.assertEqual(item["summary"]["visualization"]["audit_rows"], [])
        self.assertEqual(item["summary"]["visualization"]["daily_return_series"], [])
        self.assertEqual(item["summary"]["visualization"]["exposure_curve"], [])
