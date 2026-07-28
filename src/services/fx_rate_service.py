# -*- coding: utf-8 -*-
"""Small public FX-rate service for portfolio refresh workflows."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

import requests

from src.portfolio_exact_numeric import (
    PortfolioExactNumericError,
    PortfolioPrecisionError,
    parse_portfolio_decimal,
    resolve_portfolio_precision,
    serialize_portfolio_decimal_value,
)

DEFAULT_FX_TTL_SECONDS = 10 * 60


class FxRateService:
    """Fetch and cache public exchange rates with stale fallback."""

    def __init__(self, *, ttl_seconds: int = DEFAULT_FX_TTL_SECONDS, timeout_seconds: int = 3):
        self.ttl_seconds = max(1, int(ttl_seconds))
        self.timeout_seconds = max(1, int(timeout_seconds))
        self._cache: Dict[Tuple[str, str], Dict[str, Any]] = {}

    @staticmethod
    def _normalize_currency(value: str) -> str:
        try:
            return resolve_portfolio_precision(
                kind="fx_rate",
                from_currency=value,
                to_currency=value,
            ).from_currency or ""
        except PortfolioPrecisionError as exc:
            raise ValueError("currency code is unsupported for the Portfolio FX policy") from exc

    def fetch_rate(self, base_currency: str, quote_currency: str, *, force_refresh: bool = False) -> Dict[str, Any]:
        base = self._normalize_currency(base_currency)
        quote = self._normalize_currency(quote_currency)
        now = datetime.utcnow()
        cache_key = (base, quote)

        cached = self._cache.get(cache_key)
        if cached is not None and not force_refresh:
            cached_at = cached.get("_cached_at")
            if isinstance(cached_at, datetime) and now - cached_at <= timedelta(seconds=self.ttl_seconds):
                return self._public_payload(cached, cache_hit=True, stale=False)

        if base == quote:
            payload = self._build_payload(
                base_currency=base,
                quote_currency=quote,
                rate="1",
                provider="identity",
                fetched_at=now,
            )
            self._cache[cache_key] = payload
            return self._public_payload(payload, cache_hit=False, stale=False)

        try:
            payload = self._fetch_frankfurter(base=base, quote=quote, fetched_at=now)
            self._cache[cache_key] = payload
            return self._public_payload(payload, cache_hit=False, stale=False)
        except Exception as exc:
            if cached is not None:
                public = self._public_payload(cached, cache_hit=True, stale=True)
                public["error"] = str(exc)
                return public
            raise

    def _fetch_frankfurter(self, *, base: str, quote: str, fetched_at: datetime) -> Dict[str, Any]:
        url = f"https://api.frankfurter.dev/v2/rate/{base}/{quote}"
        last_error: Optional[Exception] = None
        for attempt in range(2):
            try:
                response = requests.get(url, timeout=self.timeout_seconds)
                status_code = int(response.status_code)
                if 400 <= status_code < 500:
                    response.raise_for_status()
                if status_code >= 500:
                    response.raise_for_status()
                data = response.json(parse_float=Decimal)
                rate = self._extract_rate(data=data, quote=quote)
                return self._build_payload(
                    base_currency=base,
                    quote_currency=quote,
                    rate=rate,
                    provider="frankfurter",
                    fetched_at=fetched_at,
                )
            except requests.exceptions.HTTPError:
                raise
            except (
                requests.exceptions.Timeout,
                requests.exceptions.ConnectionError,
                requests.exceptions.RequestException,
            ) as exc:
                last_error = exc
                if attempt == 1:
                    raise
            except Exception:
                raise
        if last_error is not None:
            raise last_error
        raise RuntimeError("FX provider request failed")

    @staticmethod
    def _extract_rate(*, data: Dict[str, Any], quote: str) -> str:
        if isinstance(data.get("rate"), (Decimal, int, str)) and not isinstance(data.get("rate"), bool):
            return str(data["rate"])
        rates = data.get("rates")
        if (
            isinstance(rates, dict)
            and isinstance(rates.get(quote), (Decimal, int, str))
            and not isinstance(rates.get(quote), bool)
        ):
            return str(rates[quote])
        raise ValueError("provider response did not include rate")

    @staticmethod
    def _build_payload(
        *,
        base_currency: str,
        quote_currency: str,
        rate: Any,
        provider: str,
        fetched_at: datetime,
    ) -> Dict[str, Any]:
        try:
            canonical_rate = serialize_portfolio_decimal_value(
                rate,
                kind="fx_rate",
                from_currency=base_currency,
                to_currency=quote_currency,
            )
        except (PortfolioExactNumericError, PortfolioPrecisionError) as exc:
            raise ValueError("provider returned an invalid FX rate") from exc
        if parse_portfolio_decimal(
            canonical_rate,
            kind="fx_rate",
            from_currency=base_currency,
            to_currency=quote_currency,
        ) <= 0:
            raise ValueError("provider returned non-positive rate")
        return {
            "base_currency": base_currency,
            "quote_currency": quote_currency,
            "rate": canonical_rate,
            "provider": provider,
            "fetched_at": fetched_at.isoformat(),
            "cache_hit": False,
            "stale": False,
            "_cached_at": fetched_at,
        }

    @staticmethod
    def _public_payload(payload: Dict[str, Any], *, cache_hit: bool, stale: bool) -> Dict[str, Any]:
        public = {key: value for key, value in payload.items() if not key.startswith("_")}
        public["cache_hit"] = bool(cache_hit)
        public["stale"] = bool(stale)
        return public


default_fx_rate_service = FxRateService()
