import unittest
from types import SimpleNamespace
from unittest.mock import patch

from src.services.stock_service import StockService


class StockServiceValidationTestCase(unittest.TestCase):
    def test_validate_ticker_exists_accepts_meaningful_name_without_quote(self) -> None:
        manager = SimpleNamespace(
            get_stock_name=lambda stock_code, allow_realtime=False: "NVIDIA",
            get_realtime_quote=lambda stock_code: None,
        )

        with patch("data_provider.base.DataFetcherManager", return_value=manager):
            result = StockService().validate_ticker_exists("NVDA")

        self.assertTrue(result["exists"])
        self.assertEqual(result["stock_code"], "NVDA")
        self.assertEqual(result["stock_name"], "NVIDIA")

    def test_validate_ticker_exists_rejects_placeholder_or_unknown_names(self) -> None:
        manager = SimpleNamespace(
            get_stock_name=lambda stock_code, allow_realtime=False: "待确认股票",
            get_realtime_quote=lambda stock_code: None,
        )

        with patch("data_provider.base.DataFetcherManager", return_value=manager):
            result = StockService().validate_ticker_exists("ZZZZZ")

        self.assertFalse(result["exists"])
        self.assertEqual(result["stock_code"], "ZZZZZ")
        self.assertIsNone(result["stock_name"])


if __name__ == "__main__":
    unittest.main()
