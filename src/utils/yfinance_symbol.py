# -*- coding: utf-8 -*-
"""Pure Yahoo/yfinance symbol helpers shared outside provider runtime."""

from __future__ import annotations

from src.utils.symbol_normalization import parse_canonical_symbol


US_INDEX_MAPPING: dict[str, tuple[str, str]] = {
    "SPX": ("^GSPC", "标普500指数"),
    "^GSPC": ("^GSPC", "标普500指数"),
    "GSPC": ("^GSPC", "标普500指数"),
    "DJI": ("^DJI", "道琼斯工业指数"),
    "^DJI": ("^DJI", "道琼斯工业指数"),
    "DJIA": ("^DJI", "道琼斯工业指数"),
    "IXIC": ("^IXIC", "纳斯达克综合指数"),
    "^IXIC": ("^IXIC", "纳斯达克综合指数"),
    "NASDAQ": ("^IXIC", "纳斯达克综合指数"),
    "NDX": ("^NDX", "纳斯达克100指数"),
    "^NDX": ("^NDX", "纳斯达克100指数"),
    "VIX": ("^VIX", "VIX恐慌指数"),
    "^VIX": ("^VIX", "VIX恐慌指数"),
    "RUT": ("^RUT", "罗素2000指数"),
    "^RUT": ("^RUT", "罗素2000指数"),
}


def get_us_index_yf_symbol(code: str | None) -> tuple[str | None, str | None]:
    """Return the Yahoo Finance symbol and label for supported US index aliases."""
    normalized = (code or "").strip().upper()
    identity = parse_canonical_symbol(normalized)
    if identity is not None and identity.market == "us" and identity.asset_type == "index":
        normalized = identity.symbol
    return US_INDEX_MAPPING.get(normalized, (None, None))


def to_yfinance_symbol(stock_code: str) -> str:
    """Convert a stock/index code into the Yahoo Finance symbol expected by yfinance."""
    code = str(stock_code or "").strip().upper()

    yf_symbol, _ = get_us_index_yf_symbol(code)
    if yf_symbol:
        return yf_symbol

    identity = parse_canonical_symbol(code)
    if identity is None or identity.ambiguous or identity.market is None:
        raise ValueError("unsupported or ambiguous stock symbol")

    if identity.market == "us":
        return identity.symbol

    if identity.market == "hk":
        hk_code = identity.symbol[2:].lstrip("0") or "0"
        return f"{hk_code.zfill(4)}.HK"

    venue_suffix = {
        "XSHG": "SS",
        "XSHE": "SZ",
        "XBSE": "BJ",
    }.get(identity.venue)
    if venue_suffix is None:
        raise ValueError("unsupported or unresolved CN venue")
    return f"{identity.symbol}.{venue_suffix}"
