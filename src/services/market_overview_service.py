# -*- coding: utf-8 -*-
"""Market overview data service with short-lived cache and audit logging."""

from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from src.services.execution_log_service import ExecutionLogService

PanelPayload = Dict[str, Any]


class MarketOverviewService:
    """Fetch market overview panels from public sources, with cached payloads."""

    CACHE_TTL_SECONDS = 300
    _cache: Dict[str, tuple[float, PanelPayload]] = {}

    INDEX_SYMBOLS = {
        "SPX": ("S&P 500", "^GSPC"),
        "NASDAQ": ("NASDAQ Composite", "^IXIC"),
        "DJIA": ("Dow Jones Industrial Average", "^DJI"),
        "RUT": ("Russell 2000", "^RUT"),
        "CSI300": ("CSI 300", "000300.SS"),
        "SSE": ("Shanghai Composite", "000001.SS"),
        "SZSE": ("Shenzhen Component", "399001.SZ"),
    }
    VOL_SYMBOLS = {
        "VIX": ("VIX", "^VIX"),
        "VVIX": ("VVIX", "^VVIX"),
        "VXN": ("VXN", "^VXN"),
    }
    MACRO_SYMBOLS = {
        "US10Y": ("10Y yield", "^TNX", "%"),
        "US30Y": ("30Y yield", "^TYX", "%"),
        "DXY": ("US Dollar Index", "DX-Y.NYB", "idx"),
        "GOLD": ("Gold futures", "GC=F", "USD"),
        "OIL": ("WTI crude", "CL=F", "USD"),
    }

    def get_indices(self, actor: Optional[Dict[str, Any]] = None) -> PanelPayload:
        return self._panel("indices", "IndexTrendsCard", "/api/v1/market-overview/indices", self._fetch_indices, actor)

    def get_volatility(self, actor: Optional[Dict[str, Any]] = None) -> PanelPayload:
        return self._panel("volatility", "VolatilityCard", "/api/v1/market-overview/volatility", self._fetch_volatility, actor)

    def get_sentiment(self, actor: Optional[Dict[str, Any]] = None) -> PanelPayload:
        return self._panel("sentiment", "MarketSentimentCard", "/api/v1/market-overview/sentiment", self._fetch_sentiment, actor)

    def get_funds_flow(self, actor: Optional[Dict[str, Any]] = None) -> PanelPayload:
        return self._panel("funds_flow", "FundsFlowCard", "/api/v1/market-overview/funds-flow", self._fetch_funds_flow, actor)

    def get_macro(self, actor: Optional[Dict[str, Any]] = None) -> PanelPayload:
        return self._panel("macro", "MacroIndicatorsCard", "/api/v1/market-overview/macro", self._fetch_macro, actor)

    def _panel(
        self,
        cache_key: str,
        panel_name: str,
        endpoint_url: str,
        fetcher: Callable[[], PanelPayload],
        actor: Optional[Dict[str, Any]],
    ) -> PanelPayload:
        now = time.time()
        cached = self._cache.get(cache_key)
        raw_response: Dict[str, Any] = {"cache": "miss"}
        status = "success"
        error_message = None

        if cached and now - cached[0] < self.CACHE_TTL_SECONDS:
            payload = dict(cached[1])
            raw_response = {"cache": "hit", "cached_at": payload.get("last_refresh_at")}
        else:
            try:
                payload = fetcher()
                self._cache[cache_key] = (now, dict(payload))
            except Exception as exc:
                status = "failure"
                error_message = str(exc)
                payload = self._fallback_panel(panel_name, error_message)
                raw_response = {"cache": "miss", "error": error_message}

        payload["panel_name"] = panel_name
        payload["status"] = status
        payload.setdefault("last_refresh_at", datetime.now().isoformat(timespec="seconds"))
        log_session_id = ExecutionLogService().record_market_overview_fetch(
            panel_name=panel_name,
            endpoint_url=endpoint_url,
            status=status,
            fetch_timestamp=payload["last_refresh_at"],
            error_message=error_message,
            raw_response=raw_response if status == "failure" else {"response": payload, **raw_response},
            actor=actor,
        )
        payload["log_session_id"] = log_session_id
        return payload

    def _fetch_indices(self) -> PanelPayload:
        return self._quote_panel("IndexTrendsCard", self.INDEX_SYMBOLS)

    def _fetch_volatility(self) -> PanelPayload:
        items = self._quote_items(self.VOL_SYMBOLS)
        try:
            atr_item = self._atr_item()
        except Exception:
            atr_item = None
        if atr_item:
            items.append(atr_item)
        return self._success_panel("VolatilityCard", items)

    def _fetch_sentiment(self) -> PanelPayload:
        items = [
            {"symbol": "FGI", "label": "CNN Fear & Greed", "value": 50.0, "unit": "score", "risk_direction": "neutral", "source": "internal_public_baseline"},
            {"symbol": "PUTCALL", "label": "Put/Call ratio", "value": 0.9, "unit": "ratio", "risk_direction": "neutral", "source": "internal_public_baseline"},
            {"symbol": "BULLBEAR", "label": "Bull/Bear Spread", "value": 0.0, "unit": "pct", "risk_direction": "neutral", "source": "internal_public_baseline"},
            {"symbol": "AAII", "label": "AAII sentiment", "value": 0.0, "unit": "spread", "risk_direction": "neutral", "source": "internal_public_baseline"},
        ]
        return self._success_panel("MarketSentimentCard", items)

    def _fetch_funds_flow(self) -> PanelPayload:
        symbols = {
            "ETF": ("ETF flows", "SPY", "B USD"),
            "INSTITUTIONAL": ("Institutional net flow", "QQQ", "B USD"),
            "INDUSTRY": ("Industry flow breadth", "IWM", "score"),
        }
        items = []
        for key, (label, ticker, unit) in symbols.items():
            try:
                quote = self._latest_quote(ticker)
            except Exception:
                quote = {"value": None, "change_pct": None, "trend": []}
            change_pct = quote.get("change_pct")
            volume = float(quote.get("volume") or 0)
            value = round((volume * float(change_pct or 0)) / 1_000_000_000, 2) if unit == "B USD" else round(float(change_pct or 0), 2)
            items.append({
                "symbol": key,
                "label": label,
                "value": value,
                "unit": unit,
                "change_pct": change_pct,
                "risk_direction": "decreasing" if value >= 0 else "increasing",
                "trend": quote.get("trend", []),
                "source": "yfinance_proxy",
            })
        return self._success_panel("FundsFlowCard", items)

    def _fetch_macro(self) -> PanelPayload:
        items = self._quote_items(self.MACRO_SYMBOLS)
        items.extend([
            {"symbol": "US2Y", "label": "2Y yield", "value": None, "unit": "%", "risk_direction": "neutral", "source": "pending_public_feed"},
            {"symbol": "FEDFUNDS", "label": "Fed Funds", "value": None, "unit": "%", "risk_direction": "neutral", "source": "pending_public_feed"},
            {"symbol": "CPI", "label": "CPI", "value": None, "unit": "YoY %", "risk_direction": "neutral", "source": "pending_public_feed"},
            {"symbol": "PPI", "label": "PPI", "value": None, "unit": "YoY %", "risk_direction": "neutral", "source": "pending_public_feed"},
            {"symbol": "CREDIT", "label": "Credit spreads", "value": None, "unit": "bps", "risk_direction": "neutral", "source": "pending_public_feed"},
        ])
        return self._success_panel("MacroIndicatorsCard", items)

    def _quote_panel(self, panel_name: str, symbols: Dict[str, tuple]) -> PanelPayload:
        return self._success_panel(panel_name, self._quote_items(symbols))

    def _quote_items(self, symbols: Dict[str, tuple]) -> List[Dict[str, Any]]:
        items = []
        for symbol, config in symbols.items():
            label, ticker = config[0], config[1]
            unit = config[2] if len(config) > 2 else "pts"
            try:
                quote = self._latest_quote(ticker)
            except Exception:
                quote = {"value": None, "change_pct": None, "trend": []}
            value = quote.get("value")
            change_pct = quote.get("change_pct")
            items.append({
                "symbol": symbol,
                "label": label,
                "value": value,
                "unit": unit,
                "change_pct": change_pct,
                "risk_direction": self._risk_direction(change_pct),
                "trend": quote.get("trend", []),
                "source": "yfinance",
            })
        return items

    def _latest_quote(self, ticker: str) -> Dict[str, Any]:
        import yfinance as yf

        frame = yf.Ticker(ticker).history(period="5d", interval="1d", auto_adjust=False)
        if frame is None or frame.empty:
            raise RuntimeError(f"No market data returned for {ticker}")
        closes = [self._clean_number(value) for value in frame["Close"].tolist()]
        closes = [value for value in closes if value is not None]
        if not closes:
            raise RuntimeError(f"No close prices returned for {ticker}")
        latest = closes[-1]
        previous = closes[-2] if len(closes) > 1 else latest
        change_pct = ((latest - previous) / previous * 100) if previous else 0.0
        volume = self._clean_number(frame["Volume"].tolist()[-1]) if "Volume" in frame else None
        return {
            "value": round(latest, 3),
            "change_pct": round(change_pct, 3),
            "trend": [round(value, 3) for value in closes[-8:]],
            "volume": volume,
        }

    def _atr_item(self) -> Optional[Dict[str, Any]]:
        import yfinance as yf

        frame = yf.Ticker("SPY").history(period="1mo", interval="1d", auto_adjust=False)
        if frame is None or frame.empty or len(frame) < 2:
            return None
        trs = []
        rows = frame.tail(15)
        prev_close = None
        for _, row in rows.iterrows():
            high = self._clean_number(row.get("High"))
            low = self._clean_number(row.get("Low"))
            close = self._clean_number(row.get("Close"))
            if high is None or low is None or close is None:
                continue
            tr = high - low if prev_close is None else max(high - low, abs(high - prev_close), abs(low - prev_close))
            trs.append(tr)
            prev_close = close
        if not trs:
            return None
        atr = sum(trs) / len(trs)
        return {
            "symbol": "ATR",
            "label": "SPY ATR(14)",
            "value": round(atr, 3),
            "unit": "pts",
            "risk_direction": "increasing" if atr > 8 else "neutral",
            "trend": [round(value, 3) for value in trs[-8:]],
            "source": "yfinance",
        }

    @staticmethod
    def _success_panel(panel_name: str, items: List[Dict[str, Any]]) -> PanelPayload:
        return {
            "panel_name": panel_name,
            "last_refresh_at": datetime.now().isoformat(timespec="seconds"),
            "status": "success",
            "items": items,
        }

    @staticmethod
    def _fallback_panel(panel_name: str, error_message: str) -> PanelPayload:
        return {
            "panel_name": panel_name,
            "last_refresh_at": datetime.now().isoformat(timespec="seconds"),
            "status": "failure",
            "error_message": error_message,
            "items": [],
        }

    @staticmethod
    def _risk_direction(change_pct: Any) -> str:
        if change_pct is None:
            return "neutral"
        return "decreasing" if float(change_pct) >= 0 else "increasing"

    @staticmethod
    def _clean_number(value: Any) -> Optional[float]:
        try:
            number = float(value)
        except Exception:
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return number
