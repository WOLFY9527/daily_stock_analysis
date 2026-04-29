# -*- coding: utf-8 -*-
"""Market overview data service with short-lived cache and audit logging."""

from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

import requests

from src.services.execution_log_service import ExecutionLogService

PanelPayload = Dict[str, Any]


class MarketOverviewService:
    """Fetch market overview panels from public sources, with cached payloads."""

    CACHE_TTL_SECONDS = 300
    _cache: Dict[str, tuple[float, PanelPayload]] = {}
    _market_data_cache: Dict[str, Dict[str, Any]] = {}

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

    def get_crypto(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._market_snapshot(
            cache_key="crypto",
            panel_name="CryptoCard",
            endpoint_url="/api/v1/market/crypto",
            fetcher=self._fetch_crypto_market_snapshot,
            actor=actor,
        )

    def get_market_sentiment(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._market_snapshot(
            cache_key="sentiment",
            panel_name="MarketSentimentCard",
            endpoint_url="/api/v1/market/sentiment",
            fetcher=self._fetch_market_sentiment_snapshot,
            actor=actor,
        )

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

    def _market_snapshot(
        self,
        cache_key: str,
        panel_name: str,
        endpoint_url: str,
        fetcher: Callable[[], Dict[str, Any]],
        actor: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        error_message = None
        fallback_used = False
        status = "success"
        raw_response: Dict[str, Any] = {"cache": "miss"}

        try:
            snapshot = fetcher()
            self._market_data_cache[cache_key] = dict(snapshot)
        except Exception as exc:
            status = "failure"
            fallback_used = True
            error_message = f"更新失败：已回退到最近一次有效数据（{exc}）"
            cached = self._market_data_cache.get(cache_key)
            if cached:
                snapshot = {
                    **cached,
                    "error": error_message,
                    "fallback_used": True,
                }
                snapshot["items"] = [
                    {
                        **item,
                        "error": error_message,
                    }
                    for item in cached.get("items", [])
                ]
                raw_response = {"cache": "fallback_hit", "error": str(exc)}
            else:
                snapshot = {
                    "items": [],
                    "last_update": datetime.now().isoformat(timespec="seconds"),
                    "error": error_message,
                    "fallback_used": True,
                    "source": "unavailable",
                }
                raw_response = {"cache": "fallback_miss", "error": str(exc)}

        snapshot.setdefault("last_update", datetime.now().isoformat(timespec="seconds"))
        snapshot.setdefault("error", error_message)
        snapshot.setdefault("fallback_used", fallback_used)
        log_session_id = ExecutionLogService().record_market_overview_fetch(
            panel_name=panel_name,
            endpoint_url=endpoint_url,
            status=status,
            fetch_timestamp=snapshot["last_update"],
            error_message=error_message,
            raw_response=raw_response if status == "failure" else {"response": snapshot, **raw_response},
            actor=actor,
        )
        snapshot["log_session_id"] = log_session_id
        return snapshot

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
        snapshot = self._fetch_market_sentiment_snapshot()
        items = []
        for item in snapshot.get("items", []):
            price = self._clean_number(item.get("price"))
            change = self._clean_number(item.get("change"))
            items.append({
                "symbol": item.get("symbol"),
                "label": item.get("label") or item.get("symbol"),
                "value": price,
                "unit": item.get("unit"),
                "change_pct": change,
                "change_text": item.get("change_text"),
                "risk_direction": item.get("risk_direction") or self._risk_direction(change),
                "trend": item.get("trend") or [],
                "hover_details": item.get("hover_details") or [],
                "source": item.get("source") or snapshot.get("source"),
            })
        return {
            "panel_name": "MarketSentimentCard",
            "last_refresh_at": snapshot.get("last_update"),
            "status": "success",
            "error_message": snapshot.get("error"),
            "items": items,
        }

    def _fetch_crypto_market_snapshot(self) -> Dict[str, Any]:
        symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
        ticker_response = requests.get(
            "https://api.binance.com/api/v3/ticker/24hr",
            params={"symbols": '["BTCUSDT","ETHUSDT","BNBUSDT"]'},
            timeout=8,
        )
        ticker_response.raise_for_status()
        ticker_rows = ticker_response.json()
        history_map = {
            symbol: self._fetch_binance_kline_history(symbol)
            for symbol in symbols
        }
        labels = {
            "BTCUSDT": ("BTC", "Bitcoin"),
            "ETHUSDT": ("ETH", "Ethereum"),
            "BNBUSDT": ("BNB", "BNB"),
        }
        last_update = datetime.now().isoformat(timespec="seconds")
        items = []
        for row in ticker_rows:
            symbol = str(row.get("symbol") or "")
            short_symbol, label = labels[symbol]
            price = self._clean_number(row.get("lastPrice")) or 0.0
            change = self._clean_number(row.get("priceChangePercent")) or 0.0
            trend = history_map.get(symbol) or [price]
            week_change = self._percent_change(trend[0], trend[-1]) if len(trend) > 1 else None
            items.append({
                "symbol": short_symbol,
                "label": label,
                "price": round(price, 2),
                "change": round(change, 2),
                "change_text": None,
                "trend": [round(value, 2) for value in trend],
                "hover_details": [
                    f"24H {self._signed_percent_text(change)}",
                    f"7D {self._signed_percent_text(week_change)}",
                ],
                "risk_direction": self._risk_direction(change),
                "unit": "USD",
                "source": "binance",
                "last_update": last_update,
                "error": None,
            })
        return {
            "items": items,
            "last_update": last_update,
            "error": None,
            "fallback_used": False,
            "source": "binance",
        }

    def _fetch_market_sentiment_snapshot(self) -> Dict[str, Any]:
        provider_error = None
        try:
            payload = self._fetch_cnn_fear_greed_snapshot()
        except Exception as exc:
            provider_error = str(exc)
            payload = self._fetch_alternative_fear_greed_snapshot()
            payload["source"] = "alternative_me"

        values = [item["value"] for item in payload["history"]]
        current = values[-1]
        previous_day = values[-2] if len(values) > 1 else current
        previous_week = values[0] if len(values) > 1 else current
        day_change = current - previous_day
        week_change = current - previous_week
        current_change_pct = self._percent_change(previous_day, current)
        trend = [round(value, 2) for value in values]
        last_update = datetime.now().isoformat(timespec="seconds")

        items = [
            {
                "symbol": "FGI",
                "label": "Fear & Greed",
                "price": round(current, 2),
                "change": round(current_change_pct or 0.0, 2),
                "change_text": f"{day_change:+.0f} pts",
                "trend": trend,
                "hover_details": [
                    f"24H {day_change:+.0f} pts",
                    f"7D {week_change:+.0f} pts",
                ],
                "risk_direction": self._risk_direction(-(current_change_pct or 0.0)),
                "unit": "score",
                "source": payload["source"],
                "last_update": last_update,
                "error": None,
            },
            {
                "symbol": "DAY1",
                "label": "24H Delta",
                "price": round(day_change, 2),
                "change": round(current_change_pct or 0.0, 2),
                "change_text": f"{day_change:+.0f} pts",
                "trend": trend[-4:],
                "hover_details": [f"Current {round(current, 2):.0f}"],
                "risk_direction": self._risk_direction(-day_change),
                "unit": "pts",
                "source": payload["source"],
                "last_update": last_update,
                "error": None,
            },
            {
                "symbol": "DAY7",
                "label": "7D Delta",
                "price": round(week_change, 2),
                "change": round(self._percent_change(previous_week, current) or 0.0, 2),
                "change_text": f"{week_change:+.0f} pts",
                "trend": trend,
                "hover_details": [f"Provider {payload['source']}"],
                "risk_direction": self._risk_direction(-week_change),
                "unit": "pts",
                "source": payload["source"],
                "last_update": last_update,
                "error": None,
            },
        ]
        return {
            "items": items,
            "last_update": last_update,
            "error": provider_error,
            "fallback_used": False,
            "source": payload["source"],
        }

    def _fetch_cnn_fear_greed_snapshot(self) -> Dict[str, Any]:
        response = requests.get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", timeout=8)
        response.raise_for_status()
        payload = response.json()
        history_rows = payload.get("fear_and_greed_historical") or payload.get("fear_and_greed")
        if not isinstance(history_rows, list) or not history_rows:
            raise RuntimeError("CNN Fear & Greed payload unavailable")
        history = []
        for row in history_rows[-8:]:
            value = self._clean_number(row.get("score") if isinstance(row, dict) else None)
            if value is not None:
                history.append({"value": value})
        if len(history) < 2:
            raise RuntimeError("CNN Fear & Greed history unavailable")
        return {"history": history, "source": "cnn"}

    def _fetch_alternative_fear_greed_snapshot(self) -> Dict[str, Any]:
        response = requests.get("https://api.alternative.me/fng/", params={"limit": 8, "format": "json"}, timeout=8)
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("data") or []
        history = []
        for row in reversed(rows):
            value = self._clean_number(row.get("value") if isinstance(row, dict) else None)
            if value is not None:
                history.append({"value": value})
        if len(history) < 2:
            raise RuntimeError("Alternative Fear & Greed history unavailable")
        return {"history": history, "source": "alternative_me"}

    def _fetch_binance_kline_history(self, symbol: str) -> List[float]:
        response = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": symbol, "interval": "1d", "limit": 8},
            timeout=8,
        )
        response.raise_for_status()
        rows = response.json()
        closes = []
        for row in rows:
            if isinstance(row, list) and len(row) >= 5:
                close_value = self._clean_number(row[4])
                if close_value is not None:
                    closes.append(close_value)
        if len(closes) < 2:
            raise RuntimeError(f"Binance kline history unavailable for {symbol}")
        return closes

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
    def _percent_change(previous: Optional[float], current: Optional[float]) -> Optional[float]:
        if previous in (None, 0) or current is None:
            return None
        return (float(current) - float(previous)) / float(previous) * 100

    @staticmethod
    def _signed_percent_text(value: Optional[float]) -> str:
        if value is None:
            return "N/A"
        return f"{value:+.2f}%"

    @staticmethod
    def _clean_number(value: Any) -> Optional[float]:
        try:
            number = float(value)
        except Exception:
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return number
