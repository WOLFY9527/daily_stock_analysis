# -*- coding: utf-8 -*-
"""Pure canonical stock-symbol identity helpers shared across product owners."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal


SymbolMarket = Literal["cn", "hk", "us"]

SUPPORTED_SYMBOL_MARKETS = frozenset({"cn", "hk", "us"})

_CN_PREFIX_RE = re.compile(r"^(?:SH|SZ|SS|BJ)(\d{6})$")
_CN_SUFFIX_RE = re.compile(r"^(\d{6})\.(?:SH|SZ|SS|BJ)$")
_HK_PREFIX_RE = re.compile(r"^HK(\d{1,5})$")
_HK_SUFFIX_RE = re.compile(r"^(\d{1,5})\.HK$")
_US_STOCK_PATTERN = re.compile(r"^[A-Z]{1,5}(?:\.(?:US|[A-Z]))?$")
_SYMBOL_TEXT_TOKEN_RE = re.compile(r"[A-Za-z0-9.^]+")
_US_INDEX_CODES = frozenset(
    {
        "SPX",
        "^GSPC",
        "GSPC",
        "DJI",
        "^DJI",
        "DJIA",
        "IXIC",
        "^IXIC",
        "NASDAQ",
        "NDX",
        "^NDX",
        "VIX",
        "^VIX",
        "RUT",
        "^RUT",
    }
)


@dataclass(frozen=True)
class CanonicalSymbol:
    """A parsed symbol identity, including explicit ambiguity where it remains."""

    raw_symbol: str
    symbol: str
    market: SymbolMarket | None
    ambiguous: bool = False


def is_us_index_code(code: str | None) -> bool:
    """Return True when a symbol matches the supported US index vocabulary."""
    return (code or "").strip().upper() in _US_INDEX_CODES


def is_us_stock_code(code: str | None) -> bool:
    """Return True when a symbol matches the supported US stock vocabulary."""
    normalized = (code or "").strip().upper()
    return not is_us_index_code(normalized) and bool(_US_STOCK_PATTERN.fullmatch(normalized))


def normalize_symbol_market(market: str | None) -> SymbolMarket | None:
    """Return a supported lower-case market constraint, or None when absent."""
    normalized = str(market or "").strip().lower()
    return normalized if normalized in SUPPORTED_SYMBOL_MARKETS else None


def parse_canonical_symbol(
    value: str | None,
    *,
    market: SymbolMarket | None = None,
) -> CanonicalSymbol | None:
    """Parse one supported CN, HK, or US symbol without guessing a market.

    A bare one-to-five digit HK code remains explicitly ambiguous or invalid
    unless an HK market constraint is supplied. Every consumer that needs a
    market identity must use this result rather than recreate exchange-specific
    parsing.
    """
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None

    upper = raw.upper()

    hk_match = _HK_PREFIX_RE.fullmatch(upper) or _HK_SUFFIX_RE.fullmatch(upper)
    if hk_match:
        return CanonicalSymbol(raw, f"HK{hk_match.group(1).zfill(5)}", "hk")

    cn_match = _CN_PREFIX_RE.fullmatch(upper) or _CN_SUFFIX_RE.fullmatch(upper)
    if cn_match:
        return CanonicalSymbol(raw, cn_match.group(1), "cn")

    if upper.isdigit() and len(upper) == 6:
        return CanonicalSymbol(raw, upper, "cn")

    if upper.isdigit() and 1 <= len(upper) <= 5:
        if market == "hk":
            return CanonicalSymbol(raw, f"HK{upper.zfill(5)}", "hk")
        if len(upper) == 5:
            return CanonicalSymbol(raw, upper, None, ambiguous=True)
        return None

    if is_us_index_code(upper) or is_us_stock_code(upper):
        return CanonicalSymbol(raw, upper, "us")

    return None


def extract_canonical_symbol_identities_from_text(
    text: str | None,
    *,
    market: SymbolMarket | None = None,
) -> tuple[CanonicalSymbol, ...]:
    """Extract complete, unambiguous canonical identities from free text.

    Token boundaries live beside the parser so consumers cannot independently
    reimplement exchange-specific text matching. The generic token expression
    deliberately does not decide which tokens are symbols; that remains the
    responsibility of :func:`parse_canonical_symbol`.
    """
    if not isinstance(text, str):
        return ()

    identities: list[CanonicalSymbol] = []
    for token in _SYMBOL_TEXT_TOKEN_RE.findall(text):
        identity = parse_canonical_symbol(token, market=market)
        if (
            identity is None
            or identity.ambiguous
            or any(existing.symbol == identity.symbol for existing in identities)
        ):
            continue
        identities.append(identity)
    return tuple(identities)


def extract_canonical_symbols_from_text(
    text: str | None,
    *,
    market: SymbolMarket | None = None,
) -> tuple[str, ...]:
    """Return canonical symbols from :func:`extract_canonical_symbol_identities_from_text`."""
    return tuple(
        identity.symbol
        for identity in extract_canonical_symbol_identities_from_text(text, market=market)
    )


def canonical_symbol_storage_values(
    value: str | None,
    *,
    market: str | None = None,
) -> tuple[str, ...]:
    """Return bounded persisted spellings for one market-known canonical identity.

    This is for joins against existing market-scoped storage only. It never
    validates user input: callers must provide the stored market context, and
    ambiguous input without that context produces no values.
    """
    market_hint = normalize_symbol_market(market)
    if market is not None and market_hint is None:
        return ()
    identity = parse_canonical_symbol(value, market=market_hint)
    if (
        identity is None
        or identity.ambiguous
        or (market_hint is not None and identity.market != market_hint)
    ):
        return ()

    values = [identity.symbol]
    if identity.market == "cn":
        values.extend(
            [
                f"{prefix}{identity.symbol}"
                for prefix in ("SH", "SZ", "SS", "BJ")
            ]
        )
        values.extend(
            [
                f"{identity.symbol}.{suffix}"
                for suffix in ("SH", "SZ", "SS", "BJ")
            ]
        )
    elif identity.market == "hk":
        digits = identity.symbol.removeprefix("HK")
        significant_digits = digits.lstrip("0") or "0"
        widths = range(len(significant_digits), 6)
        values.extend(
            f"HK{significant_digits.zfill(width)}"
            for width in widths
        )
        values.append(significant_digits)
        values.append(digits)
        values.extend(
            f"{significant_digits.zfill(width)}.HK"
            for width in range(len(significant_digits), 6)
        )
    return tuple(dict.fromkeys(values))


def normalize_stock_code(stock_code: str) -> str:
    """Normalize supported exchange forms while retaining unknown raw values.

    This preserves provider-runtime behavior for arbitrary and lower-case US
    values while deriving all CN/HK transformations from ``parse_canonical_symbol``.
    """
    raw = str(stock_code or "").strip()
    identity = parse_canonical_symbol(raw)
    if identity and identity.market in {"cn", "hk"}:
        return identity.symbol
    return raw


def canonical_stock_code(code: str | None) -> str:
    """Return the canonical symbol when supported, otherwise stable uppercase text."""
    raw = str(code or "").strip()
    identity = parse_canonical_symbol(raw)
    return identity.symbol if identity else raw.upper()
