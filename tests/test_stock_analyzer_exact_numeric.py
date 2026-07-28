"""Regression coverage for Decimal-backed persisted market bars."""

from datetime import date, timedelta
from decimal import Decimal
import unittest
from unittest.mock import patch

import pandas as pd

from src.stock_analyzer import StockTrendAnalyzer


class StockTrendAnalyzerExactNumericTestCase(unittest.TestCase):
    """The analyzer projects persisted exact values into analytics numerics."""

    @patch("src.stock_analyzer.get_config")
    def test_analyze_accepts_decimal_backed_ohlcv(self, mock_get_config) -> None:
        mock_get_config.return_value.bias_threshold = 5.0
        start = date(2025, 1, 1)
        frame = pd.DataFrame(
            [
                {
                    "date": start + timedelta(days=index),
                    "open": Decimal("100.00") + Decimal(index) / Decimal("10"),
                    "high": Decimal("100.50") + Decimal(index) / Decimal("10"),
                    "low": Decimal("99.50") + Decimal(index) / Decimal("10"),
                    "close": Decimal("100.00") + Decimal(index) / Decimal("10"),
                    "volume": Decimal("100000") + Decimal(index),
                }
                for index in range(30)
            ]
        )

        result = StockTrendAnalyzer().analyze(frame, "000001")

        self.assertAlmostEqual(result.current_price, 102.9)
        self.assertIsInstance(result.ma20, float)
        self.assertIsInstance(result.volume_ratio_5d, float)
        self.assertTrue(all(isinstance(level, float) for level in result.resistance_levels))


if __name__ == "__main__":
    unittest.main()
