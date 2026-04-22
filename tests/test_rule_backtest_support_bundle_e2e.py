# -*- coding: utf-8 -*-
"""HTTP E2E coverage for rule-backtest support bundle exports."""

from __future__ import annotations

import csv
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()

import src.auth as auth  # noqa: E402
from api.app import create_app  # noqa: E402
from src.config import Config  # noqa: E402
from src.multi_user import BOOTSTRAP_ADMIN_USER_ID  # noqa: E402
from src.services.rule_backtest_service import RuleBacktestService  # noqa: E402
from src.storage import DatabaseManager, StockDaily  # noqa: E402


def _reset_auth_globals() -> None:
    auth._auth_enabled = None
    auth._session_secret = None
    auth._password_hash_salt = None
    auth._password_hash_stored = None
    auth._rate_limit = {}


class RuleBacktestSupportBundleE2ETestCase(unittest.TestCase):
    @staticmethod
    def _error_code(response) -> str | None:
        payload = response.json()
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if isinstance(detail, dict):
            return detail.get("error")
        if isinstance(payload, dict):
            return payload.get("error")
        return None

    def setUp(self) -> None:
        _reset_auth_globals()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.env_path = self.data_dir / ".env"
        self.db_path = self.data_dir / "rule_backtest_support_bundle_e2e.db"
        self.env_path.write_text(
            "\n".join(
                [
                    "STOCK_LIST=600519",
                    "GEMINI_API_KEY=test",
                    "ADMIN_AUTH_ENABLED=false",
                    f"DATABASE_PATH={self.db_path}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        os.environ["ENV_FILE"] = str(self.env_path)
        os.environ["DATABASE_PATH"] = str(self.db_path)

        Config.reset_instance()
        DatabaseManager.reset_instance()

        self.app = create_app(static_dir=self.data_dir / "empty-static")
        self.client = TestClient(self.app)
        self.db = DatabaseManager.get_instance()

        with self.db.get_session() as session:
            closes = [
                10,
                10.2,
                10.1,
                10.5,
                11.0,
                11.6,
                11.8,
                11.2,
                10.8,
                10.2,
                9.9,
                10.3,
                10.9,
                11.4,
                11.9,
                12.1,
                11.7,
                11.1,
                10.7,
                10.4,
                10.8,
                11.3,
                11.8,
                12.2,
            ]
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
        self.client.close()
        DatabaseManager.reset_instance()
        Config.reset_instance()
        os.environ.pop("ENV_FILE", None)
        os.environ.pop("DATABASE_PATH", None)
        self.temp_dir.cleanup()

    def _run_completed_backtest(self) -> tuple[RuleBacktestService, dict]:
        service = RuleBacktestService(self.db, owner_id=BOOTSTRAP_ADMIN_USER_ID)
        with patch.object(service, "_get_llm_adapter", return_value=None):
            response = service.parse_and_run(
                code="600519",
                strategy_text="Buy when Close > MA3. Sell when Close < MA3.",
                lookback_bars=20,
                confirmed=True,
            )
        return service, response

    def _fetch_support_bundle_surface(self, run_id: int) -> dict:
        export_index_response = self.client.get(f"/api/v1/backtest/rule/runs/{run_id}/export-index")
        self.assertEqual(export_index_response.status_code, 200)
        export_index = export_index_response.json()

        self.assertEqual(export_index["run_id"], run_id)
        self.assertEqual(
            [item["key"] for item in export_index["exports"]],
            [
                "support_bundle_manifest_json",
                "support_bundle_reproducibility_manifest_json",
                "execution_trace_json",
                "execution_trace_csv",
            ],
        )
        self.assertEqual(
            [
                (item["format"], item["media_type"], item["delivery_mode"], item["payload_class"])
                for item in export_index["exports"]
            ],
            [
                ("json", "application/json", "api", "compact"),
                ("json", "application/json", "api", "compact"),
                ("json", "application/json", "api", "heavy"),
                ("csv", "text/csv", "api", "heavy"),
            ],
        )

        manifest_response = self.client.get(export_index["exports"][0]["endpoint_path"])
        reproducibility_response = self.client.get(export_index["exports"][1]["endpoint_path"])
        self.assertEqual(manifest_response.status_code, 200)
        self.assertEqual(reproducibility_response.status_code, 200)

        manifest = manifest_response.json()
        reproducibility = reproducibility_response.json()

        return {
            "export_index": export_index,
            "manifest": manifest,
            "reproducibility": reproducibility,
            "manifest_content_type": manifest_response.headers.get("content-type", ""),
            "reproducibility_content_type": reproducibility_response.headers.get("content-type", ""),
        }

    def _assert_service_http_support_bundle_parity(
        self,
        *,
        service: RuleBacktestService,
        run_id: int,
        payloads: dict,
        trace_available: bool,
    ) -> None:
        self.assertEqual(service.get_support_export_index(run_id), payloads["export_index"])
        self.assertEqual(service.get_support_bundle_manifest(run_id), payloads["manifest"])
        self.assertEqual(
            service.get_support_bundle_reproducibility_manifest(run_id),
            payloads["reproducibility"],
        )

        trace_json_path = payloads["export_index"]["exports"][2]["endpoint_path"]
        trace_csv_path = payloads["export_index"]["exports"][3]["endpoint_path"]
        trace_json_response = self.client.get(trace_json_path)
        trace_csv_response = self.client.get(trace_csv_path)

        if trace_available:
            self.assertEqual(service.get_execution_trace_export_json(run_id), trace_json_response.json())
            self.assertEqual(
                service.get_execution_trace_export_csv_text(run_id),
                trace_csv_response.text,
            )
        else:
            with self.assertRaisesRegex(ValueError, "has no audit rows to export"):
                service.get_execution_trace_export_json(run_id)
            with self.assertRaisesRegex(ValueError, "has no audit rows to export"):
                service.get_execution_trace_export_csv_text(run_id)

    def _assert_support_bundle_surface(
        self,
        *,
        run_id: int,
        trace_available: bool,
    ) -> dict:
        payloads = self._fetch_support_bundle_surface(run_id)
        export_index = payloads["export_index"]
        manifest = payloads["manifest"]
        reproducibility = payloads["reproducibility"]

        self.assertEqual(manifest["run"]["id"], run_id)
        self.assertEqual(reproducibility["run"]["id"], run_id)
        self.assertEqual(manifest["run"]["status"], export_index["status"])
        self.assertEqual(reproducibility["run"]["status"], export_index["status"])
        self.assertEqual(manifest["manifest_kind"], "rule_backtest_support_bundle")
        self.assertEqual(
            reproducibility["manifest_kind"],
            "rule_backtest_reproducibility_manifest",
        )
        self.assertEqual(manifest["run_timing"], reproducibility["run_timing"])
        self.assertEqual(manifest["run_diagnostics"], reproducibility["run_diagnostics"])
        self.assertEqual(manifest["artifact_availability"], reproducibility["artifact_availability"])
        self.assertEqual(manifest["readback_integrity"], reproducibility["readback_integrity"])
        self.assertEqual(
            [item["endpoint_path"] for item in export_index["exports"]],
            [
                f"/api/v1/backtest/rule/runs/{run_id}/support-bundle-manifest",
                f"/api/v1/backtest/rule/runs/{run_id}/support-bundle-reproducibility-manifest",
                f"/api/v1/backtest/rule/runs/{run_id}/execution-trace.json",
                f"/api/v1/backtest/rule/runs/{run_id}/execution-trace.csv",
            ],
        )
        self.assertTrue(
            payloads["manifest_content_type"].startswith(export_index["exports"][0]["media_type"])
        )
        self.assertTrue(
            payloads["reproducibility_content_type"].startswith(
                export_index["exports"][1]["media_type"]
            )
        )

        trace_json_path = export_index["exports"][2]["endpoint_path"]
        trace_csv_path = export_index["exports"][3]["endpoint_path"]
        trace_json_response = self.client.get(trace_json_path)
        trace_csv_response = self.client.get(trace_csv_path)

        if trace_available:
            self.assertTrue(export_index["exports"][2]["available"])
            self.assertTrue(export_index["exports"][3]["available"])
            self.assertEqual(
                export_index["exports"][2]["availability_reason"],
                "execution_trace_rows_present",
            )
            self.assertEqual(
                export_index["exports"][3]["availability_reason"],
                "execution_trace_rows_present",
            )
            self.assertEqual(trace_json_response.status_code, 200)
            self.assertEqual(trace_csv_response.status_code, 200)
            self.assertTrue(
                trace_json_response.headers.get("content-type", "").startswith(
                    export_index["exports"][2]["media_type"]
                )
            )
            self.assertTrue(
                trace_csv_response.headers.get("content-type", "").startswith(
                    export_index["exports"][3]["media_type"]
                )
            )
            self.assertIn(
                f'rule-backtest-{run_id}-execution-trace.csv',
                trace_csv_response.headers.get("content-disposition", ""),
            )

            trace_json = trace_json_response.json()
            trace_csv_rows = list(csv.DictReader(trace_csv_response.text.splitlines()))
            self.assertEqual(
                len(trace_json["trace_rows"]),
                manifest["artifact_counts"]["execution_trace_rows_count"],
            )
            self.assertEqual(len(trace_json["trace_rows"]), len(trace_csv_rows))
            self.assertEqual(
                trace_json["source"],
                manifest["result_authority"]["domains"]["execution_trace"]["source"],
            )
            payloads["trace_json"] = trace_json
            payloads["trace_csv_rows"] = trace_csv_rows
        else:
            self.assertFalse(export_index["exports"][2]["available"])
            self.assertFalse(export_index["exports"][3]["available"])
            self.assertEqual(
                export_index["exports"][2]["availability_reason"],
                "execution_trace_rows_missing",
            )
            self.assertEqual(
                export_index["exports"][3]["availability_reason"],
                "execution_trace_rows_missing",
            )
            self.assertEqual(trace_json_response.status_code, 409)
            self.assertEqual(trace_csv_response.status_code, 409)
            self.assertEqual(self._error_code(trace_json_response), "export_unavailable")
            self.assertEqual(self._error_code(trace_csv_response), "export_unavailable")
            self.assertTrue(
                trace_json_response.headers.get("content-type", "").startswith("application/json")
            )
            self.assertTrue(
                trace_csv_response.headers.get("content-type", "").startswith("application/json")
            )

        return payloads

    def test_support_bundle_e2e_stored_first_surface_is_coherent(self) -> None:
        service, response = self._run_completed_backtest()

        payloads = self._assert_support_bundle_surface(
            run_id=int(response["id"]),
            trace_available=True,
        )
        self._assert_service_http_support_bundle_parity(
            service=service,
            run_id=int(response["id"]),
            payloads=payloads,
            trace_available=True,
        )

        self.assertEqual(
            payloads["manifest"]["artifact_availability"]["source"],
            "summary.artifact_availability",
        )
        self.assertTrue(payloads["manifest"]["artifact_availability"]["has_trade_rows"])
        self.assertTrue(payloads["manifest"]["artifact_availability"]["has_execution_trace"])
        self.assertFalse(payloads["manifest"]["readback_integrity"]["used_live_storage_repair"])
        self.assertGreater(payloads["manifest"]["artifact_counts"]["execution_trace_rows_count"], 0)

    def test_support_bundle_e2e_live_storage_repair_preserves_http_contract(self) -> None:
        service, response = self._run_completed_backtest()
        deleted = service.repo.delete_trades_by_run_ids([response["id"]])
        self.assertGreater(deleted, 0)

        payloads = self._assert_support_bundle_surface(
            run_id=int(response["id"]),
            trace_available=True,
        )
        self._assert_service_http_support_bundle_parity(
            service=service,
            run_id=int(response["id"]),
            payloads=payloads,
            trace_available=True,
        )

        self.assertEqual(
            payloads["manifest"]["artifact_availability"]["source"],
            "summary.artifact_availability+live_storage_repair",
        )
        self.assertFalse(payloads["manifest"]["artifact_availability"]["has_trade_rows"])
        self.assertEqual(payloads["manifest"]["artifact_counts"]["trade_rows_count"], 0)
        self.assertTrue(payloads["manifest"]["readback_integrity"]["used_live_storage_repair"])
        self.assertTrue(payloads["manifest"]["readback_integrity"]["has_summary_storage_drift"])
        self.assertEqual(payloads["manifest"]["readback_integrity"]["drift_domains"], ["trade_rows"])
        self.assertEqual(payloads["manifest"]["readback_integrity"]["integrity_level"], "drift_repaired")

    def test_support_bundle_e2e_missing_trace_closes_trace_exports(self) -> None:
        service, response = self._run_completed_backtest()
        run_row = service.repo.get_run(response["id"])
        assert run_row is not None

        summary = json.loads(run_row.summary_json)
        summary["execution_trace"] = {}
        summary["visualization"] = dict(summary.get("visualization") or {})
        summary["visualization"]["audit_rows"] = []
        summary["visualization"]["daily_return_series"] = []
        summary["visualization"]["exposure_curve"] = []
        service.repo.update_run(run_row.id, summary_json=service._serialize_json(summary))

        payloads = self._assert_support_bundle_surface(
            run_id=int(response["id"]),
            trace_available=False,
        )
        self._assert_service_http_support_bundle_parity(
            service=service,
            run_id=int(response["id"]),
            payloads=payloads,
            trace_available=False,
        )

        self.assertFalse(payloads["manifest"]["artifact_availability"]["has_execution_trace"])
        self.assertEqual(payloads["manifest"]["artifact_counts"]["execution_trace_rows_count"], 0)
        self.assertEqual(
            payloads["manifest"]["result_authority"]["domains"]["execution_trace"]["source"],
            "unavailable",
        )
