# -*- coding: utf-8 -*-
"""Contract and fallback tests for market macro card endpoints."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from api.v1.endpoints import market
from src.services.market_overview_service import MarketOverviewService


class MarketMacroCardsApiTestCase(unittest.TestCase):
    def test_sector_rotation_endpoint_returns_stable_contract(self) -> None:
        payload = market.get_sector_rotation()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        self.assertTrue(payload["items"])
        first_item = payload["items"][0]
        self.assertIn("relativeStrength", first_item)
        self.assertIn("rank", first_item)
        self.assertIn(first_item["market"], {"CN", "HK", "US"})

    def test_rates_endpoint_returns_us_and_cn_groups(self) -> None:
        payload = market.get_rates()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        symbols = {item["symbol"] for item in payload["items"]}
        self.assertIn("US10Y", symbols)
        self.assertIn("CN10Y", symbols)
        self.assertIn("explanation", payload)

    def test_fx_commodities_endpoint_returns_fx_and_commodities(self) -> None:
        payload = market.get_fx_commodities()

        self.assertTrue(payload["source"])
        self.assertTrue(payload["updatedAt"])
        symbols = {item["symbol"] for item in payload["items"]}
        self.assertIn("DXY", symbols)
        self.assertIn("USDCNH", symbols)
        self.assertIn("GOLD", symbols)
        self.assertIn("explanation", payload)

    def test_macro_card_fallbacks_are_not_empty_when_provider_fails(self) -> None:
        service = MarketOverviewService()

        cases = [
            ("_fetch_sector_rotation_snapshot", service.get_sector_rotation),
            ("_fetch_rates_snapshot", service.get_rates),
            ("_fetch_fx_commodities_snapshot", service.get_fx_commodities),
        ]
        for fetcher_name, getter in cases:
            with self.subTest(fetcher_name=fetcher_name):
                with patch.object(service, fetcher_name, side_effect=RuntimeError("provider down")):
                    payload = getter()

                self.assertEqual(payload["source"], "fallback")
                self.assertTrue(payload["fallbackUsed"])
                self.assertTrue(payload["items"])


if __name__ == "__main__":
    unittest.main()
