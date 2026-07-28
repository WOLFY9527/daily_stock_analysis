# -*- coding: utf-8 -*-
"""Exact numeric contract for the agent analysis-context tool."""

from __future__ import annotations

from decimal import Decimal
import json
import unittest
from unittest.mock import patch

from src.agent.tools.data_tools import _handle_get_analysis_context


class _AnalysisContextDatabase:
    def get_analysis_context(self, stock_code: str):
        return {
            "code": stock_code,
            "today": {"close": Decimal("9007199254740993.12345678")},
            "yesterday": {"close": Decimal("9007199254740992.12345678")},
            "price_change_ratio": Decimal("0.00000001"),
        }


class AnalysisContextToolExactNumericTestCase(unittest.TestCase):
    def test_preserves_decimal_text_and_is_json_serializable(self) -> None:
        with patch(
            "src.agent.tools.data_tools._get_db",
            return_value=_AnalysisContextDatabase(),
        ):
            payload = _handle_get_analysis_context("AAPL")

        self.assertEqual(payload["today"]["close"], "9007199254740993.12345678")
        self.assertEqual(payload["yesterday"]["close"], "9007199254740992.12345678")
        self.assertEqual(payload["price_change_ratio"], "0.00000001")
        json.dumps(payload)


if __name__ == "__main__":
    unittest.main()
