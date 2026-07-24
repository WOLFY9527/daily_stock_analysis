# -*- coding: utf-8 -*-
"""Consumer-facing validation built on the canonical symbol identity boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.utils.symbol_normalization import (
    normalize_symbol_market,
    parse_canonical_symbol,
)


SymbolValidationStatus = Literal[
    "valid",
    "invalid_format",
    "unsupported_market",
    "ambiguous",
    "not_found",
    "unavailable",
    "unknown",
]


class ConsumerSymbolValidationError(ValueError):
    """Raised only when a consumer symbol fails canonical identity validation."""


@dataclass(frozen=True)
class ConsumerSymbolPrecheck:
    raw_symbol: str
    normalized_symbol: str
    market: str | None
    status: SymbolValidationStatus
    message: str

    @property
    def can_lookup(self) -> bool:
        return self.status == "unknown"


def validate_consumer_symbol_precheck(
    symbol: str | None,
    *,
    market: str | None = None,
) -> ConsumerSymbolPrecheck:
    """Validate a consumer symbol without recreating market-specific parsing."""
    raw = str(symbol or "").strip()
    requested_market = _normalize_requested_market(market)
    fallback_normalized = raw.upper()

    if requested_market == "unsupported":
        return _result(
            raw,
            fallback_normalized,
            None,
            "unsupported_market",
            "Supported markets are cn, hk, and us.",
        )
    if not raw:
        return _result(raw, fallback_normalized, requested_market, "invalid_format", "Enter a symbol.")

    identity = parse_canonical_symbol(raw, market=requested_market)
    if identity is None:
        return _result(
            raw,
            fallback_normalized,
            requested_market,
            "invalid_format",
            "Enter a supported stock symbol format.",
        )
    if identity.ambiguous:
        return _result(
            raw,
            identity.symbol,
            None,
            "ambiguous",
            "Add a market to validate this symbol.",
        )
    if requested_market and identity.market != requested_market:
        return _result(
            raw,
            identity.symbol,
            requested_market,
            "unsupported_market",
            "Symbol format does not match the requested market.",
        )

    return _result(
        raw,
        identity.symbol,
        identity.market,
        "unknown",
        "Symbol format is supported, but verification is not confirmed yet.",
    )


def require_consumer_symbol_identity(
    symbol: str | None,
    *,
    market: str | None = None,
) -> ConsumerSymbolPrecheck:
    """Return one canonical consumer identity or reject invalid and ambiguous input."""
    precheck = validate_consumer_symbol_precheck(symbol, market=market)
    if precheck.status != "unknown":
        raise ConsumerSymbolValidationError(precheck.message)
    return precheck


def _normalize_requested_market(market: str | None) -> str | None:
    if market is None:
        return None
    raw = str(market or "").strip()
    if not raw:
        return None
    return normalize_symbol_market(raw) or "unsupported"


def _result(
    raw_symbol: str,
    normalized_symbol: str,
    market: str | None,
    status: SymbolValidationStatus,
    message: str,
) -> ConsumerSymbolPrecheck:
    return ConsumerSymbolPrecheck(
        raw_symbol=raw_symbol,
        normalized_symbol=normalized_symbol,
        market=market,
        status=status,
        message=message,
    )
