# -*- coding: utf-8 -*-
"""Pure canonical stock-symbol identity helpers shared across product owners."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal


SymbolMarket = Literal["cn", "hk", "us"]
SymbolAssetType = Literal["stock", "index"]

SUPPORTED_SYMBOL_MARKETS = frozenset({"cn", "hk", "us"})

_CN_PREFIX_RE = re.compile(r"^(SH|SZ|SS|BJ)(\d{6})$")
_CN_SUFFIX_RE = re.compile(r"^(\d{6})\.(SH|SZ|SS|BJ)$")
_HK_PREFIX_RE = re.compile(r"^HK(\d{1,5})$")
_HK_SUFFIX_RE = re.compile(r"^(\d{1,5})\.HK$")
_HK_INDEX_RE = re.compile(r"^(HSI|HSTECH)(?:\.HK)?$")
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
_HK_INDEX_CODES = frozenset({"HSI", "HSTECH"})
_CN_INDEX_VENUES = {
    "000001": "XSHG",
    "000016": "XSHG",
    "000300": "XSHG",
    "000688": "XSHG",
    "000905": "XSHG",
    "000852": "XSHG",
    "399001": "XSHE",
    "399006": "XSHE",
    "899050": "XBSE",
}
_CN_INDEX_ONLY_CODES = frozenset(
    {
        "000016",
        "000300",
        "000688",
        "000852",
        "000905",
        "399001",
        "399006",
        "899050",
    }
)
_CN_VENUE_BY_TOKEN = {"SH": "XSHG", "SS": "XSHG", "SZ": "XSHE", "BJ": "XBSE"}
UNRESOLVED_SYMBOL_VENUE = "UNRESOLVED"


@dataclass(frozen=True)
class CanonicalSymbol:
    """A parsed symbol identity, including explicit ambiguity where it remains."""

    raw_symbol: str
    symbol: str
    market: SymbolMarket | None
    ambiguous: bool = False
    venue: str | None = None
    asset_type: SymbolAssetType | None = None

    @property
    def transport_symbol(self) -> str:
        """Return a stable string spelling that retains explicit CN venue identity."""
        if self.market == "cn" and self.venue and (
            _CN_PREFIX_RE.fullmatch(self.raw_symbol.upper())
            or _CN_SUFFIX_RE.fullmatch(self.raw_symbol.upper())
        ):
            suffix = {
                "XSHG": "SH",
                "XSHE": "SZ",
                "XBSE": "BJ",
            }.get(self.venue)
            if suffix:
                return f"{self.symbol}.{suffix}"
        return self.symbol

    @property
    def identity_key(self) -> tuple[str, str, str, str] | None:
        """Return the complete canonical identity key, when parsing resolved one."""
        if self.ambiguous or not self.market or not self.venue or not self.asset_type:
            return None
        return (self.market, self.venue, self.symbol, self.asset_type)


def is_us_index_code(code: str | None) -> bool:
    """Return True when a symbol matches the supported US index vocabulary."""
    normalized = _canonical_us_symbol((code or "").strip().upper())
    return normalized in _US_INDEX_CODES


def is_us_stock_code(code: str | None) -> bool:
    """Return True when a symbol matches the supported US stock vocabulary."""
    normalized = _canonical_us_symbol((code or "").strip().upper())
    return not is_us_index_code(normalized) and bool(_US_STOCK_PATTERN.fullmatch(normalized))


def normalize_symbol_market(market: str | None) -> SymbolMarket | None:
    """Return a supported lower-case market constraint, or None when absent."""
    normalized = str(market or "").strip().lower()
    return normalized if normalized in SUPPORTED_SYMBOL_MARKETS else None


def parse_canonical_symbol(
    value: str | None,
    *,
    market: SymbolMarket | None = None,
    venue: str | None = None,
    asset_type: SymbolAssetType | None = None,
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
    market_hint = normalize_symbol_market(market)

    hk_match = _HK_PREFIX_RE.fullmatch(upper) or _HK_SUFFIX_RE.fullmatch(upper)
    if hk_match:
        return _constrain_identity(
            CanonicalSymbol(raw, f"HK{hk_match.group(1).zfill(5)}", "hk", venue="XHKG", asset_type="stock"),
            venue=venue,
            asset_type=asset_type,
        )

    hk_index_match = _HK_INDEX_RE.fullmatch(upper)
    if hk_index_match:
        return _constrain_identity(
            CanonicalSymbol(raw, hk_index_match.group(1), "hk", venue="XHKG", asset_type="index"),
            venue=venue,
            asset_type=asset_type,
        )

    cn_match = _CN_PREFIX_RE.fullmatch(upper)
    cn_suffix_match = _CN_SUFFIX_RE.fullmatch(upper)
    if cn_match:
        exchange_token, code = cn_match.groups()
        return _constrain_identity(
            _parse_explicit_cn(raw, code=code, exchange_token=exchange_token),
            venue=venue,
            asset_type=asset_type,
        )
    if cn_suffix_match:
        code, exchange_token = cn_suffix_match.groups()
        return _constrain_identity(
            _parse_explicit_cn(raw, code=code, exchange_token=exchange_token),
            venue=venue,
            asset_type=asset_type,
        )

    if upper.isdigit() and len(upper) == 6:
        index_venue = _CN_INDEX_VENUES.get(upper)
        stock_venue = _cn_stock_venue(upper)
        if index_venue is not None:
            if venue is None and asset_type is None:
                return CanonicalSymbol(raw, upper, "cn", ambiguous=True)
            if venue == index_venue and asset_type in {None, "index"}:
                return CanonicalSymbol(raw, upper, "cn", venue=venue, asset_type="index")
            if upper not in _CN_INDEX_ONLY_CODES and venue == stock_venue and asset_type in {None, "stock"}:
                return CanonicalSymbol(raw, upper, "cn", venue=venue, asset_type="stock")
            return None
        return _constrain_identity(
            CanonicalSymbol(raw, upper, "cn", venue=stock_venue, asset_type="stock"),
            venue=venue,
            asset_type=asset_type,
        )

    if upper.isdigit() and 1 <= len(upper) <= 5:
        if market_hint == "hk":
            return _constrain_identity(
                CanonicalSymbol(raw, f"HK{upper.zfill(5)}", "hk", venue="XHKG", asset_type="stock"),
                venue=venue,
                asset_type=asset_type,
            )
        if len(upper) == 5:
            if venue is not None or asset_type is not None:
                return None
            return CanonicalSymbol(raw, upper, None, ambiguous=True)
        return None

    us_symbol = _canonical_us_symbol(upper)
    if is_us_index_code(us_symbol):
        return _constrain_identity(
            CanonicalSymbol(raw, us_symbol, "us", venue=UNRESOLVED_SYMBOL_VENUE, asset_type="index"),
            venue=venue,
            asset_type=asset_type,
        )
    if is_us_stock_code(us_symbol):
        return _constrain_identity(
            CanonicalSymbol(raw, us_symbol, "us", venue=UNRESOLVED_SYMBOL_VENUE, asset_type="stock"),
            venue=venue,
            asset_type=asset_type,
        )

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
            or any(
                (
                    existing.symbol,
                    existing.market,
                    existing.venue,
                    existing.asset_type,
                )
                == (
                    identity.symbol,
                    identity.market,
                    identity.venue,
                    identity.asset_type,
                )
                for existing in identities
            )
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
    venue: str | None = None,
    asset_type: SymbolAssetType | None = None,
) -> tuple[str, ...]:
    """Return bounded persisted spellings for one market-known canonical identity.

    This is for joins against existing market-scoped storage only. It never
    validates user input: callers must provide the stored market context, and
    ambiguous input without that context produces no values.
    """
    market_hint = normalize_symbol_market(market)
    if market is not None and market_hint is None:
        return ()
    identity = parse_canonical_symbol(
        value,
        market=market_hint,
        venue=venue,
        asset_type=asset_type,
    )
    if (
        identity is None
        or identity.ambiguous
        or (market_hint is not None and identity.market != market_hint)
    ):
        return ()

    values = [identity.symbol]
    if identity.market == "cn":
        exchange_tokens = _cn_exchange_tokens(identity.venue)
        values.extend(
            [
                f"{prefix}{identity.symbol}"
                for prefix in exchange_tokens
            ]
        )
        values.extend(
            [
                f"{identity.symbol}.{suffix}"
                for suffix in exchange_tokens
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


def _parse_explicit_cn(raw: str, *, code: str, exchange_token: str) -> CanonicalSymbol | None:
    venue = _CN_VENUE_BY_TOKEN[exchange_token]
    index_venue = _CN_INDEX_VENUES.get(code)
    if index_venue == venue:
        return CanonicalSymbol(raw, code, "cn", venue=venue, asset_type="index")
    if code in _CN_INDEX_ONLY_CODES:
        return None
    if venue != _cn_stock_venue(code):
        return None
    return CanonicalSymbol(raw, code, "cn", venue=venue, asset_type="stock")


def _constrain_identity(
    identity: CanonicalSymbol | None,
    *,
    venue: str | None,
    asset_type: SymbolAssetType | None,
) -> CanonicalSymbol | None:
    if identity is None:
        return None
    if venue is not None and identity.venue != venue:
        return None
    if asset_type is not None and identity.asset_type != asset_type:
        return None
    return identity


def _canonical_us_symbol(value: str) -> str:
    """Remove only the provider's explicit ``.US`` suffix from US symbols."""
    if value.endswith(".US"):
        return value[:-3]
    return value


def _cn_stock_venue(code: str) -> str:
    if code.startswith(("92", "43", "81", "82", "83", "87", "88")) and not code.startswith("900"):
        return "XBSE"
    if code.startswith(("000", "001", "002", "003", "300", "301")):
        return "XSHE"
    return "XSHG"


def _cn_exchange_tokens(venue: str | None) -> tuple[str, ...]:
    if venue == "XSHG":
        return ("SH", "SS")
    if venue == "XSHE":
        return ("SZ",)
    if venue == "XBSE":
        return ("BJ",)
    return ()
