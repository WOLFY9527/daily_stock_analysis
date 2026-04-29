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

    def get_cn_indices(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="cn_indices",
            panel_name="ChinaIndicesCard",
            endpoint_url="/api/v1/market/cn-indices",
            fetcher=self._fetch_cn_indices_snapshot,
            fallback_factory=self._fallback_cn_indices_snapshot,
            actor=actor,
        )

    def get_cn_breadth(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="cn_breadth",
            panel_name="ChinaBreadthCard",
            endpoint_url="/api/v1/market/cn-breadth",
            fetcher=self._fetch_cn_breadth_snapshot,
            fallback_factory=self._fallback_cn_breadth_snapshot,
            actor=actor,
        )

    def get_cn_flows(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="cn_flows",
            panel_name="ChinaFlowsCard",
            endpoint_url="/api/v1/market/cn-flows",
            fetcher=self._fetch_cn_flows_snapshot,
            fallback_factory=self._fallback_cn_flows_snapshot,
            actor=actor,
        )

    def get_sector_rotation(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="sector_rotation",
            panel_name="SectorRotationCard",
            endpoint_url="/api/v1/market/sector-rotation",
            fetcher=self._fetch_sector_rotation_snapshot,
            fallback_factory=self._fallback_sector_rotation_snapshot,
            actor=actor,
        )

    def get_rates(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="rates",
            panel_name="RatesCard",
            endpoint_url="/api/v1/market/rates",
            fetcher=self._fetch_rates_snapshot,
            fallback_factory=self._fallback_rates_snapshot,
            actor=actor,
        )

    def get_fx_commodities(self, actor: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._classified_snapshot(
            cache_key="fx_commodities",
            panel_name="FxCommoditiesCard",
            endpoint_url="/api/v1/market/fx-commodities",
            fetcher=self._fetch_fx_commodities_snapshot,
            fallback_factory=self._fallback_fx_commodities_snapshot,
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

    def _classified_snapshot(
        self,
        cache_key: str,
        panel_name: str,
        endpoint_url: str,
        fetcher: Callable[[], Dict[str, Any]],
        fallback_factory: Callable[[], Dict[str, Any]],
        actor: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        error_message = None
        status = "success"
        raw_response: Dict[str, Any] = {"cache": "miss"}
        try:
            snapshot = fetcher()
            snapshot.setdefault("fallbackUsed", False)
            self._market_data_cache[cache_key] = dict(snapshot)
        except Exception as exc:
            status = "failure"
            error_message = f"更新失败：已回退到可用市场快照（{exc}）"
            cached = self._market_data_cache.get(cache_key)
            if cached and cached.get("items"):
                snapshot = dict(cached)
                snapshot["fallbackUsed"] = True
                snapshot["error"] = error_message
                raw_response = {"cache": "fallback_hit", "error": str(exc)}
            else:
                snapshot = fallback_factory()
                snapshot["fallbackUsed"] = True
                snapshot["error"] = error_message
                raw_response = {"cache": "fallback_static", "error": str(exc)}

        snapshot.setdefault("panelName", panel_name)
        snapshot.setdefault("updatedAt", datetime.now().isoformat(timespec="seconds"))
        snapshot.setdefault("source", "fallback" if snapshot.get("fallbackUsed") else "mixed")
        snapshot.setdefault("items", [])
        log_session_id = ExecutionLogService().record_market_overview_fetch(
            panel_name=panel_name,
            endpoint_url=endpoint_url,
            status=status,
            fetch_timestamp=snapshot["updatedAt"],
            error_message=error_message,
            raw_response=raw_response if status == "failure" else {"response": snapshot, **raw_response},
            actor=actor,
        )
        snapshot["logSessionId"] = log_session_id
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

    def _fetch_cn_indices_snapshot(self) -> Dict[str, Any]:
        return self._fallback_cn_indices_snapshot()

    def _fetch_cn_breadth_snapshot(self) -> Dict[str, Any]:
        return self._fallback_cn_breadth_snapshot()

    def _fetch_cn_flows_snapshot(self) -> Dict[str, Any]:
        return self._fallback_cn_flows_snapshot()

    def _fetch_sector_rotation_snapshot(self) -> Dict[str, Any]:
        return self._fallback_sector_rotation_snapshot()

    def _fetch_rates_snapshot(self) -> Dict[str, Any]:
        return self._fallback_rates_snapshot()

    def _fetch_fx_commodities_snapshot(self) -> Dict[str, Any]:
        return self._fallback_fx_commodities_snapshot()

    def _fallback_cn_indices_snapshot(self) -> Dict[str, Any]:
        items = [
            ("上证指数", "000001.SH", 3120.55, 12.30, 0.39, "CN", [3098, 3105, 3112, 3120.55]),
            ("深证成指", "399001.SZ", 9820.42, 52.18, 0.53, "CN", [9722, 9760, 9798, 9820.42]),
            ("创业板指", "399006.SZ", 1886.24, -6.15, -0.32, "CN", [1901, 1894, 1889, 1886.24]),
            ("科创50", "000688.SH", 827.35, 7.40, 0.90, "CN", [812, 818, 824, 827.35]),
            ("沪深300", "000300.SH", 3618.76, 18.86, 0.52, "CN", [3588, 3602, 3612, 3618.76]),
            ("中证500", "000905.SH", 5488.12, 11.42, 0.21, "CN", [5440, 5466, 5482, 5488.12]),
            ("中证1000", "000852.SH", 5626.77, -8.92, -0.16, "CN", [5660, 5642, 5631, 5626.77]),
            ("北证50", "899050.BJ", 853.40, 5.10, 0.60, "CN", [838, 846, 850, 853.40]),
            ("恒生指数", "HSI.HK", 17680.30, 146.20, 0.83, "HK", [17410, 17520, 17610, 17680.30]),
            ("恒生科技", "HSTECH.HK", 3668.18, 44.80, 1.24, "HK", [3590, 3622, 3650, 3668.18]),
            ("富时A50期货", "CN00Y", 12580.00, 38.00, 0.30, "Futures", [12420, 12488, 12542, 12580.00]),
        ]
        return self._card_snapshot([
            self._metric_item(name, symbol, value, change, change_pct, "pts", sparkline, market=market)
            for name, symbol, value, change, change_pct, market, sparkline in items
        ])

    def _fallback_cn_breadth_snapshot(self) -> Dict[str, Any]:
        items = [
            self._metric_item("赚钱效应", "EFFECT", 64, 4, 6.67, "score", [52, 58, 61, 64], explanation="上涨家数占优，市场赚钱效应较好。"),
            self._metric_item("上涨家数", "ADVANCERS", 3190, 260, 8.87, "stocks", [2800, 2960, 3120, 3190]),
            self._metric_item("下跌家数", "DECLINERS", 1780, -210, -10.55, "stocks", [2150, 1990, 1840, 1780]),
            self._metric_item("平盘家数", "UNCHANGED", 240, -12, -4.76, "stocks", [260, 252, 248, 240]),
            self._metric_item("涨停家数", "LIMIT_UP", 68, 11, 19.30, "stocks", [45, 51, 57, 68]),
            self._metric_item("跌停家数", "LIMIT_DOWN", 18, -6, -25.00, "stocks", [31, 26, 24, 18]),
            self._metric_item("创新高家数", "NEW_HIGH", 92, 18, 24.32, "stocks", [61, 72, 84, 92]),
            self._metric_item("创新低家数", "NEW_LOW", 36, -9, -20.00, "stocks", [52, 45, 40, 36]),
            self._metric_item("上涨比例", "ADV_RATIO", 63.2, 3.8, 6.40, "%", [55, 58, 61, 63.2]),
        ]
        return self._card_snapshot(items, explanation="上涨家数占优，市场赚钱效应较好。")

    def _fallback_cn_flows_snapshot(self) -> Dict[str, Any]:
        items = [
            self._metric_item("北向资金", "NORTHBOUND", 42.6, 18.2, 74.59, "亿 CNY", [12, 18, 24, 42.6], detail="5日 +118.4 亿"),
            self._metric_item("南向资金", "SOUTHBOUND", 28.4, 7.6, 36.54, "亿 HKD", [8, 14, 20, 28.4], detail="5日 +86.1 亿"),
            self._metric_item("主力资金", "MAINLAND_MAIN", -63.5, 22.0, 25.73, "亿 CNY", [-116, -98, -82, -63.5], detail="5日 -286.0 亿"),
            self._metric_item("ETF 净申购", "CN_ETF", 15.8, 4.2, 36.21, "亿 CNY", [4, 8, 12, 15.8], detail="5日 +52.7 亿"),
            self._metric_item("融资余额变化", "MARGIN_BALANCE", 31.2, 9.1, 41.18, "亿 CNY", [8, 17, 24, 31.2], detail="5日 +104.3 亿"),
        ]
        return self._card_snapshot(items)

    def _fallback_sector_rotation_snapshot(self) -> Dict[str, Any]:
        rows = [
            ("AI / 算力", "AI", 3.8, 91, 1, "CN", [0.4, 1.3, 2.6, 3.8], "AI 算力链领涨，风险偏好回升。"),
            ("半导体", "SEMI", 2.6, 86, 2, "CN", [0.1, 0.9, 1.8, 2.6], "国产替代与周期修复共振。"),
            ("港股科技", "HK_TECH", 2.1, 82, 3, "HK", [-0.2, 0.4, 1.3, 2.1], "互联网平台弹性强于大盘。"),
            ("机器人", "ROBOT", 1.8, 78, 4, "CN", [0.3, 0.7, 1.4, 1.8], "主题热度维持高位。"),
            ("资源/有色", "METALS", 1.4, 73, 5, "CN", [-0.1, 0.5, 1.0, 1.4], "铜价上行带动顺周期预期。"),
            ("低空经济", "LOW_ALT", 0.9, 66, 6, "CN", [-0.4, 0.1, 0.5, 0.9], "政策催化仍在扩散。"),
            ("金融", "FIN", 0.4, 58, 7, "CN", [0.1, 0.2, 0.3, 0.4], "权重板块稳定指数。"),
            ("消费", "CONS", -0.2, 46, 8, "CN", [0.3, 0.1, -0.1, -0.2], "需求修复仍需确认。"),
            ("医药", "HEALTH", -0.5, 42, 9, "CN", [-0.1, -0.2, -0.4, -0.5], "防御属性未明显占优。"),
            ("新能源", "NEV", -0.8, 37, 10, "CN", [-0.2, -0.5, -0.6, -0.8], "产能与价格压力仍约束估值。"),
            ("军工", "DEFENSE", -1.0, 34, 11, "CN", [-0.1, -0.3, -0.7, -1.0], "短线资金热度回落。"),
        ]
        items = []
        for name, symbol, change_pct, strength, rank, market, sparkline, explanation in rows:
            item = self._metric_item(name, symbol, strength, change_pct, change_pct, "RS", sparkline, market=market, explanation=explanation)
            item["relativeStrength"] = strength
            item["rank"] = rank
            items.append(item)
        return self._card_snapshot(items)

    def _fallback_rates_snapshot(self) -> Dict[str, Any]:
        items = [
            self._metric_item("US 2Y", "US2Y", 4.82, 3.0, 0.63, "%", [4.70, 4.74, 4.79, 4.82], market="US"),
            self._metric_item("US 10Y", "US10Y", 4.54, 5.0, 1.11, "%", [4.38, 4.45, 4.49, 4.54], market="US"),
            self._metric_item("US 30Y", "US30Y", 4.71, 4.0, 0.86, "%", [4.58, 4.63, 4.68, 4.71], market="US"),
            self._metric_item("10Y-2Y 利差", "US10Y2Y", -28, -2, -7.69, "bp", [-21, -24, -26, -28], market="US"),
            self._metric_item("10Y-3M 利差", "US10Y3M", -94, 4, 4.08, "bp", [-103, -101, -98, -94], market="US"),
            self._metric_item("中国10年国债收益率", "CN10Y", 2.35, -1.5, -0.63, "%", [2.42, 2.39, 2.37, 2.35], market="CN"),
            self._metric_item("DR007", "DR007", 1.86, -6.0, -3.13, "%", [2.01, 1.94, 1.90, 1.86], market="CN"),
            self._metric_item("SHIBOR", "SHIBOR", 1.72, -3.0, -1.71, "%", [1.82, 1.78, 1.75, 1.72], market="CN"),
            self._metric_item("LPR", "LPR", 3.45, 0.0, 0.0, "%", [3.45, 3.45, 3.45, 3.45], market="CN"),
        ]
        return self._card_snapshot(items, explanation="资金利率偏低，A股流动性环境相对友好。")

    def _fallback_fx_commodities_snapshot(self) -> Dict[str, Any]:
        items = [
            self._metric_item("DXY", "DXY", 105.2, 0.35, 0.33, "idx", [104.1, 104.6, 104.9, 105.2], explanation="美元走强时风险资产可能承压。"),
            self._metric_item("USD/CNH", "USDCNH", 7.24, 0.02, 0.28, "", [7.18, 7.20, 7.22, 7.24], explanation="人民币走弱时 A股/港股情绪可能受影响。"),
            self._metric_item("USD/JPY", "USDJPY", 156.4, 0.6, 0.39, "", [154.8, 155.3, 155.9, 156.4]),
            self._metric_item("EUR/USD", "EURUSD", 1.066, -0.003, -0.28, "", [1.075, 1.071, 1.068, 1.066]),
            self._metric_item("黄金", "GOLD", 2358.0, 18.6, 0.79, "USD", [2298, 2318, 2339, 2358], explanation="黄金上涨提示避险或降息预期。"),
            self._metric_item("WTI 原油", "WTI", 82.4, -0.7, -0.84, "USD", [84.0, 83.1, 82.8, 82.4]),
            self._metric_item("布伦特原油", "BRENT", 86.7, -0.5, -0.57, "USD", [88.1, 87.4, 87.0, 86.7]),
            self._metric_item("铜", "COPPER", 4.72, 0.08, 1.72, "USD/lb", [4.50, 4.58, 4.66, 4.72], explanation="铜上涨提示经济复苏预期。"),
        ]
        return self._card_snapshot(items, explanation="美元走强时风险资产可能承压；人民币走弱会压制 A股/港股情绪。")

    def _card_snapshot(self, items: List[Dict[str, Any]], explanation: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "source": "fallback",
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
            "items": items,
            "fallbackUsed": False,
        }
        if explanation:
            payload["explanation"] = explanation
        return payload

    def _metric_item(
        self,
        name: str,
        symbol: str,
        value: float,
        change: float,
        change_percent: float,
        unit: str,
        sparkline: List[float],
        market: Optional[str] = None,
        detail: Optional[str] = None,
        explanation: Optional[str] = None,
    ) -> Dict[str, Any]:
        item: Dict[str, Any] = {
            "name": name,
            "label": name,
            "symbol": symbol,
            "value": value,
            "price": value,
            "change": change,
            "changePercent": change_percent,
            "change_text": f"{change:+.2f}",
            "sparkline": sparkline,
            "trend": sparkline,
            "unit": unit,
            "source": "fallback",
            "risk_direction": self._risk_direction(change_percent),
            "hover_details": [text for text in (detail, explanation) if text],
        }
        if market:
            item["market"] = market
        if explanation:
            item["explanation"] = explanation
        return item

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
