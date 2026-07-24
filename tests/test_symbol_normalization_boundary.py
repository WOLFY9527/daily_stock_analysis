# -*- coding: utf-8 -*-
"""Contract tests for the pure symbol normalization boundary."""

from __future__ import annotations

import pytest

from data_provider.base import (
    canonical_stock_code as provider_canonical_stock_code,
)
from data_provider.base import (
    normalize_stock_code as provider_normalize_stock_code,
)
from data_provider.akshare_fetcher import is_hk_stock_code
from src.utils.symbol_normalization import (
    canonical_symbol_storage_values,
    canonical_stock_code,
    normalize_stock_code,
    parse_canonical_symbol,
)


def test_provider_normalization_exports_delegate_to_pure_utils() -> None:
    assert provider_normalize_stock_code is normalize_stock_code
    assert provider_canonical_stock_code is canonical_stock_code
    assert parse_canonical_symbol("0700") is None
    assert parse_canonical_symbol("0700", market="hk").symbol == "HK00700"
    assert parse_canonical_symbol("1234", market="hk").symbol == "HK01234"
    assert canonical_symbol_storage_values("HK00700", market="hk") == (
        "HK00700",
        "HK700",
        "HK0700",
        "700",
        "00700",
        "700.HK",
        "0700.HK",
        "00700.HK",
    )
    assert canonical_symbol_storage_values("00700", market="hk") == (
        "HK00700",
        "HK700",
        "HK0700",
        "700",
        "00700",
        "700.HK",
        "0700.HK",
        "00700.HK",
    )
    assert canonical_symbol_storage_values("600519", market="cn") == (
        "600519",
        "SH600519",
        "SZ600519",
        "SS600519",
        "BJ600519",
        "600519.SH",
        "600519.SZ",
        "600519.SS",
        "600519.BJ",
    )
    assert canonical_symbol_storage_values("00700") == ()
    assert canonical_symbol_storage_values("HK00700", market="cn") == ()
    assert is_hk_stock_code("0700.HK") is True
    assert is_hk_stock_code("00700") is False


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("600519", "600519"),
        (" SH600519 ", "600519"),
        ("000001.SZ", "000001"),
        ("600000.SS", "600000"),
        ("BJ920748", "920748"),
        ("920748.BJ", "920748"),
        ("HK00700", "HK00700"),
        ("hk700", "HK00700"),
        ("1810.HK", "HK01810"),
        ("AAPL", "AAPL"),
        ("brk.b", "brk.b"),
        ("", ""),
    ],
)
def test_normalize_stock_code_matches_provider_runtime_semantics(
    raw: str,
    expected: str,
) -> None:
    assert normalize_stock_code(raw) == expected
    assert normalize_stock_code(raw) == provider_normalize_stock_code(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("aapl", "AAPL"),
        (" 600519 ", "600519"),
        ("hk00700", "HK00700"),
        ("0700.HK", "HK00700"),
        ("", ""),
        (None, ""),
    ],
)
def test_canonical_stock_code_matches_provider_runtime_semantics(
    raw: str | None,
    expected: str,
) -> None:
    assert canonical_stock_code(raw) == expected
    assert canonical_stock_code(raw) == provider_canonical_stock_code(raw)
