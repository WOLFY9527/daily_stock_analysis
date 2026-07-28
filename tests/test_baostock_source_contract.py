# -*- coding: utf-8 -*-
"""Drift guards for BaoStock source-confidence capability contracts."""

from __future__ import annotations

import pandas as pd

from data_provider.baostock_fetcher import BaostockFetcher
from src.portfolio_exact_numeric import STOCK_DAILY_CLOSE_PROVENANCE_ATTR
from src.services.provider_capability_matrix import list_provider_capability_support_contracts


def test_baostock_contract_capabilities_match_supported_probe_capabilities() -> None:
    contracts = list_provider_capability_support_contracts("baostock")
    contract_capabilities = tuple(sorted(item.capability for item in contracts))

    assert contract_capabilities == tuple(sorted(BaostockFetcher.SUPPORTED_CAPABILITIES))


def test_baostock_contract_capabilities_exclude_unsupported_probe_capabilities() -> None:
    contract_capabilities = {
        item.capability for item in list_provider_capability_support_contracts("baostock")
    }

    assert contract_capabilities.isdisjoint(BaostockFetcher.UNSUPPORTED_CAPABILITIES)


def test_baostock_contracts_remain_cautious_observation_only_metadata() -> None:
    contracts = list_provider_capability_support_contracts("baostock")

    assert contracts
    assert {item.provider_name for item in contracts} == {"baostock"}
    assert {item.provider_id for item in contracts} == {"baostock"}
    assert {item.source_type for item in contracts} == {"public_proxy"}
    assert {item.source_tier for item in contracts} == {"third_party_free_api"}
    assert {item.trust_level for item in contracts} == {"usable_with_caution"}
    assert {item.freshness_expectation for item in contracts} == {"t_plus_1_or_delayed"}
    assert {item.observation_only for item in contracts} == {True}
    assert {item.score_contribution_allowed for item in contracts} == {False}
    assert {item.paid_data_likely_required for item in contracts} == {False}
    assert {item.key_required for item in contracts} == {False}
    assert {item.cache_required for item in contracts} == {True}
    assert {item.background_refresh_recommended for item in contracts} == {True}
    assert {item.degradation_reason for item in contracts} == {"baostock_provider_unavailable"}
    assert {item.missing_provider_reason for item in contracts} == {"baostock_not_installed"}
    assert "official_public" not in {item.source_type for item in contracts}
    assert "exchange_authorized" not in {item.source_tier for item in contracts}
    assert "reliable" not in {item.trust_level for item in contracts}
    assert "live" not in {item.freshness_expectation for item in contracts}
    assert "fresh" not in {item.freshness_expectation for item in contracts}


def test_baostock_daily_normalization_keeps_exact_close_provenance() -> None:
    fetcher = BaostockFetcher()
    normalized = fetcher._normalize_data(
        pd.DataFrame(
            {
                "date": ["2026-04-14", "2026-04-15"],
                "open": ["10.0", "10.2"],
                "high": ["10.5", "10.4"],
                "low": ["9.8", "10.1"],
                "close": ["10.3", "10.35"],
                "volume": ["1000", "1200"],
                "amount": ["10300", "12420"],
                "pctChg": ["1.0", "0.49"],
            }
        ),
        "600519",
    )

    frame = fetcher._clean_data(normalized)

    assert pd.api.types.is_numeric_dtype(frame["close"])
    assert frame.attrs[STOCK_DAILY_CLOSE_PROVENANCE_ATTR] == {
        "2026-04-14": "10.3",
        "2026-04-15": "10.35",
    }


def test_baostock_cleaning_preserves_existing_exact_close_provenance() -> None:
    fetcher = BaostockFetcher()
    close_tokens = {
        "2026-04-14": "9007199254740993.12345678",
        "2026-04-15": "9007199254740994.12345678",
    }
    frame = pd.DataFrame(
        {
            "date": ["2026-04-15", "2026-04-14"],
            "close": [9007199254740994.0, 9007199254740992.0],
            "volume": [1200.0, 1000.0],
        }
    )
    frame.attrs[STOCK_DAILY_CLOSE_PROVENANCE_ATTR] = close_tokens

    cleaned = fetcher._clean_data(frame)

    assert cleaned["date"].dt.date.astype(str).tolist() == ["2026-04-14", "2026-04-15"]
    assert cleaned.attrs[STOCK_DAILY_CLOSE_PROVENANCE_ATTR] == close_tokens
