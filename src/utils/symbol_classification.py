# -*- coding: utf-8 -*-
"""Pure symbol classification helpers shared outside provider runtime."""

from __future__ import annotations

import re

from src.utils.symbol_normalization import is_us_index_code, is_us_stock_code


def is_bse_code(code: str | None) -> bool:
    """Return True when a code matches the provider-runtime BSE rules."""
    candidate = (code or "").strip().split(".")[0]
    if len(candidate) != 6 or not candidate.isdigit():
        return False
    if candidate.startswith("900"):
        return False
    return candidate.startswith(("92", "43", "81", "82", "83", "87", "88"))


def is_st_stock(name: str | None) -> bool:
    """Return True when a stock name matches the provider-runtime ST rule."""
    return "ST" in (name or "").upper()


def is_kc_cy_stock(code: str | None) -> bool:
    """Return True when a code matches the provider-runtime STAR/ChiNext rule."""
    candidate = (code or "").strip().split(".")[0]
    return candidate.startswith("688") or candidate.startswith("30")
