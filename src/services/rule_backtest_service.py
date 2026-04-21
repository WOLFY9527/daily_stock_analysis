# -*- coding: utf-8 -*-
"""AI-assisted deterministic rule backtest service."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from data_provider.base import normalize_stock_code
from data_provider.us_index_mapping import is_us_index_code, is_us_stock_code
from src.agent.llm_adapter import LLMToolAdapter
from src.config import get_config
from src.core.rule_backtest_engine import ExecutionModelConfig, ParsedStrategy, RuleBacktestEngine, RuleBacktestParser, _safe_float
from src.repositories.rule_backtest_repo import RuleBacktestRepository
from src.repositories.stock_repo import StockRepository
from src.services.us_history_helper import fetch_daily_history_with_local_us_fallback
from src.storage import DatabaseManager, RuleBacktestRun, RuleBacktestTrade

logger = logging.getLogger(__name__)
_UNSET = object()
_CONFIRMATION_REQUIRED_ERROR = "请先确认解析结果后再运行规则回测。"
TERMINAL_RULE_RUN_STATUSES = frozenset({"completed", "failed", "cancelled"})
CANCELLABLE_RULE_RUN_STATUSES = frozenset({"queued", "parsing", "running", "summarizing"})

BENCHMARK_MODE_AUTO = "auto"
BENCHMARK_MODE_NONE = "none"
BENCHMARK_MODE_SAME_SYMBOL = "same_symbol_buy_and_hold"
BENCHMARK_MODE_HS300 = "index_hs300"
BENCHMARK_MODE_CSI500 = "index_csi500"
BENCHMARK_MODE_NDX100 = "index_ndx100"
BENCHMARK_MODE_QQQ = "etf_qqq"
BENCHMARK_MODE_SP500 = "index_sp500"
BENCHMARK_MODE_SPY = "etf_spy"
BENCHMARK_MODE_CUSTOM = "custom_code"
SUPPORTED_INDICATOR_STRATEGY_FAMILIES = frozenset(
    {
        "moving_average_crossover",
        "macd_crossover",
        "rsi_threshold",
    }
)
SUPPORTED_DETERMINISTIC_STRATEGY_FAMILIES = frozenset(
    {
        "periodic_accumulation",
        *SUPPORTED_INDICATOR_STRATEGY_FAMILIES,
    }
)

BENCHMARK_PRESET_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    BENCHMARK_MODE_NONE: {
        "label": "无基准",
        "code": None,
        "method": "no_benchmark",
    },
    BENCHMARK_MODE_SAME_SYMBOL: {
        "label": "当前标的买入并持有",
        "code": None,
        "method": "same_symbol_buy_and_hold",
    },
    BENCHMARK_MODE_HS300: {
        "label": "沪深300",
        "code": "000300",
        "method": "market_index",
    },
    BENCHMARK_MODE_CSI500: {
        "label": "中证500",
        "code": "000905",
        "method": "market_index",
    },
    BENCHMARK_MODE_NDX100: {
        "label": "纳指100",
        "code": "NDX",
        "method": "market_index",
    },
    BENCHMARK_MODE_QQQ: {
        "label": "QQQ",
        "code": "QQQ",
        "method": "benchmark_security",
    },
    BENCHMARK_MODE_SP500: {
        "label": "标普500",
        "code": "SPX",
        "method": "market_index",
    },
    BENCHMARK_MODE_SPY: {
        "label": "SPY",
        "code": "SPY",
        "method": "benchmark_security",
    },
}

AUTOMATED_SCENARIO_STRATEGIES: Dict[str, str] = {
    "normal_path": "Buy when Close > MA3. Sell when Close < MA3.",
    "cash_insufficiency_skip": "资金1500，从2024-01-05到2024-01-20，每天买100股ORCL，买到资金耗尽为止",
    "benchmark_fallback": "Buy when Close > MA3. Sell when Close < MA3.",
    "macd_crossover": "MACD金叉买入，死叉卖出",
    "rsi_threshold": "RSI 小于 30 买入，大于 70 卖出",
}

COMPARE_DELTA_METRICS: List[str] = [
    "total_return_pct",
    "annualized_return_pct",
    "max_drawdown_pct",
    "benchmark_return_pct",
    "excess_return_vs_benchmark_pct",
]

TRACE_EXPORT_COLUMNS: List[tuple[str, str]] = [
    ("date", "日期"),
    ("symbol_close", "标的收盘价"),
    ("benchmark_close", "基准收盘价"),
    ("signal_summary", "信号摘要"),
    ("action_display", "动作"),
    ("fill_price", "成交价"),
    ("shares", "持股数"),
    ("cash", "现金"),
    ("holdings_value", "持仓市值"),
    ("total_portfolio_value", "总资产"),
    ("daily_pnl", "当日盈亏"),
    ("daily_return", "当日收益率"),
    ("cumulative_return", "策略累计收益率"),
    ("benchmark_cumulative_return", "基准累计收益率"),
    ("buy_hold_cumulative_return", "买入持有累计收益率"),
    ("position", "仓位"),
    ("fees", "手续费"),
    ("slippage", "滑点"),
    ("notes", "备注"),
    ("assumptions_defaults", "assumptions"),
    ("fallback", "fallback"),
]

EQUITY_CURVE_FIELD_ORDER: List[str] = [
    "date",
    "equity",
    "cumulative_return_pct",
    "drawdown_pct",
    "close",
    "signal_summary",
    "target_position",
    "executed_action",
    "fill_price",
    "shares_held",
    "cash",
    "holdings_value",
    "total_portfolio_value",
    "position_state",
    "exposure_pct",
    "fee_amount",
    "slippage_amount",
    "notes",
]

PARSED_STRATEGY_FIELD_ORDER: List[str] = [
    "version",
    "timeframe",
    "source_text",
    "normalized_text",
    "entry",
    "exit",
    "confidence",
    "needs_confirmation",
    "ambiguities",
    "summary.entry",
    "summary.exit",
    "summary.strategy",
    "max_lookback",
    "strategy_kind",
    "setup",
    "strategy_spec.version",
    "strategy_spec.strategy_type",
    "strategy_spec.strategy_family",
    "strategy_spec.timeframe",
    "strategy_spec.max_lookback",
    "executable",
    "normalization_state",
    "assumptions",
    "assumption_groups",
    "detected_strategy_family",
    "unsupported_reason",
    "unsupported_details",
    "unsupported_extensions",
    "core_intent_summary",
    "interpretation_confidence",
    "supported_portion_summary",
    "rewrite_suggestions",
    "parse_warnings",
    "strategy_spec.support.executable",
    "strategy_spec.support.normalization_state",
    "strategy_spec.support.requires_confirmation",
    "strategy_spec.support.detected_strategy_family",
]

SUMMARY_FIELD_ORDER: List[str] = [
    "request",
    "request.start_date",
    "request.end_date",
    "request.lookback_bars",
    "request.initial_capital",
    "request.fee_bps",
    "request.slippage_bps",
    "request.benchmark_mode",
    "request.benchmark_code",
    "request.confirmed",
    "request.execution_model",
    "parsed_strategy_summary",
    "metrics",
    "execution_model",
    "execution_assumptions",
    "execution_assumptions_snapshot",
    "visualization",
    "execution_trace",
    "no_result_reason",
    "no_result_message",
    "ai_summary",
    "status_message",
    "status_history",
]


@dataclass
class _StrategySpecSupportPayload:
    executable: bool
    normalization_state: str
    requires_confirmation: bool
    unsupported_reason: Optional[str]
    detected_strategy_family: Optional[str]


@dataclass
class _StrategySpecDateRangePayload:
    start_date: str
    end_date: str


@dataclass
class _StrategySpecCapitalPayload:
    initial_capital: float
    currency: str


@dataclass
class _StrategySpecCostsPayload:
    fee_bps: float
    slippage_bps: float


@dataclass
class _PeriodicSchedulePayload:
    frequency: str
    timing: str


@dataclass
class _PeriodicOrderPayload:
    mode: str
    quantity: Optional[float]
    amount: Optional[float]


@dataclass
class _PeriodicEntryPayload:
    side: str
    order: _PeriodicOrderPayload
    price_basis: str


@dataclass
class _PeriodicExitPayload:
    policy: str
    price_basis: str


@dataclass
class _PeriodicPositionBehaviorPayload:
    accumulate: bool
    cash_policy: str


@dataclass
class _PeriodicAccumulationStrategySpecPayload:
    strategy_type: str
    version: str
    symbol: str
    timeframe: str
    date_range: _StrategySpecDateRangePayload
    capital: _StrategySpecCapitalPayload
    schedule: _PeriodicSchedulePayload
    entry: _PeriodicEntryPayload
    exit: _PeriodicExitPayload
    position_behavior: _PeriodicPositionBehaviorPayload
    costs: _StrategySpecCostsPayload


@dataclass
class _MovingAverageSignalPayload:
    indicator_family: str
    fast_period: int
    slow_period: int
    fast_type: str
    slow_type: str
    entry_condition: str
    exit_condition: str


@dataclass
class _MacdSignalPayload:
    indicator_family: str
    fast_period: int
    slow_period: int
    signal_period: int
    entry_condition: str
    exit_condition: str


@dataclass
class _RsiSignalPayload:
    indicator_family: str
    period: int
    lower_threshold: float
    upper_threshold: float
    entry_condition: str
    exit_condition: str


@dataclass
class _IndicatorExecutionPayload:
    frequency: str
    signal_timing: str
    fill_timing: str


@dataclass
class _IndicatorPositionBehaviorPayload:
    direction: str
    entry_sizing: str
    max_positions: int
    pyramiding: bool


@dataclass
class _IndicatorEndBehaviorPayload:
    policy: str
    price_basis: str


@dataclass
class _IndicatorStrategySpecPayload:
    strategy_type: str
    version: str
    symbol: str
    timeframe: str
    date_range: _StrategySpecDateRangePayload
    capital: _StrategySpecCapitalPayload
    signal: Any
    execution: _IndicatorExecutionPayload
    position_behavior: _IndicatorPositionBehaviorPayload
    costs: _StrategySpecCostsPayload
    end_behavior: _IndicatorEndBehaviorPayload


class RuleBacktestService:
    """Orchestrate parsing, deterministic execution, persistence, and async submissions."""

    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        llm_adapter: Optional[LLMToolAdapter] = None,
        *,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self.repo = RuleBacktestRepository(self.db)
        self.stock_repo = StockRepository(self.db)
        self.parser = RuleBacktestParser()
        self.engine = RuleBacktestEngine()
        self._llm_adapter = llm_adapter
        self.owner_id = owner_id
        self.include_all_owners = bool(include_all_owners)

    def _owner_kwargs(self) -> Dict[str, Any]:
        return {
            "owner_id": self.owner_id,
            "include_all_owners": self.include_all_owners,
        }

    def parse_strategy(
        self,
        strategy_text: str,
        *,
        code: Optional[str] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        initial_capital: Optional[float] = None,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
    ) -> Dict[str, Any]:
        parsed = self.parser.parse(strategy_text, llm_adapter=self._get_llm_adapter())
        parsed = self._normalize_parsed_strategy(
            parsed,
            code=code,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
        )
        return self._parsed_to_dict(parsed)

    def run_backtest(
        self,
        *,
        code: str,
        strategy_text: str,
        parsed_strategy: Optional[Dict[str, Any]] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        lookback_bars: int = 252,
        initial_capital: float = 100000.0,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
        benchmark_mode: str = BENCHMARK_MODE_AUTO,
        benchmark_code: Optional[str] = None,
        confirmed: bool = False,
    ) -> Dict[str, Any]:
        """Run a deterministic rule backtest synchronously and persist the completed result."""

        normalized_code, raw_text = self._validate_submission_inputs(code=code, strategy_text=strategy_text)
        parsed = self._ensure_parsed_strategy(
            raw_text,
            parsed_strategy,
            code=normalized_code,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
        )
        if parsed.needs_confirmation and not confirmed:
            raise ValueError(_CONFIRMATION_REQUIRED_ERROR)

        result = self._execute_rule_backtest(
            code=normalized_code,
            parsed=parsed,
            start_date=start_date,
            end_date=end_date,
            lookback_bars=lookback_bars,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
        )
        ai_summary = self._build_ai_summary(parsed, result)
        return self._store_result(
            result,
            code=normalized_code,
            strategy_text=raw_text,
            start_date=start_date,
            end_date=end_date,
            lookback_bars=lookback_bars,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
            confirmed=confirmed,
            ai_summary=ai_summary,
        )

    def submit_backtest(
        self,
        *,
        code: str,
        strategy_text: str,
        parsed_strategy: Optional[Dict[str, Any]] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        lookback_bars: int = 252,
        initial_capital: float = 100000.0,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
        benchmark_mode: str = BENCHMARK_MODE_AUTO,
        benchmark_code: Optional[str] = None,
        confirmed: bool = False,
    ) -> Dict[str, Any]:
        """Create a non-blocking rule backtest run and return immediately."""

        normalized_code, raw_text = self._validate_submission_inputs(code=code, strategy_text=strategy_text)
        parsed: Optional[ParsedStrategy] = None
        if parsed_strategy:
            parsed = self._dict_to_parsed_strategy(parsed_strategy, raw_text)
            if parsed.needs_confirmation and not confirmed:
                raise ValueError(_CONFIRMATION_REQUIRED_ERROR)

        normalized_start_date, normalized_end_date = self._normalize_date_range(start_date=start_date, end_date=end_date)
        submitted_at = datetime.now()
        initial_status = "queued" if parsed is not None else "parsing"
        initial_status_message = "策略已提交，等待开始执行。" if parsed is not None else "正在解析策略文本。"
        summary = self._update_summary_payload(
            {},
            request_payload=self._build_request_payload(
                start_date=normalized_start_date,
                end_date=normalized_end_date,
                lookback_bars=lookback_bars,
                initial_capital=initial_capital,
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
                benchmark_mode=benchmark_mode,
                benchmark_code=benchmark_code,
                confirmed=confirmed,
                execution_model=self._build_execution_model_payload(
                    timeframe=(parsed.timeframe if parsed is not None else "daily"),
                    fee_bps=fee_bps,
                    slippage_bps=slippage_bps,
                    parsed_strategy=parsed,
                ),
            ),
            execution_assumptions=self._build_execution_assumptions_payload(
                execution_model=self._build_execution_model_payload(
                    timeframe=(parsed.timeframe if parsed is not None else "daily"),
                    fee_bps=fee_bps,
                    slippage_bps=slippage_bps,
                    parsed_strategy=parsed,
                ),
            ),
            execution_model=self._build_execution_model_payload(
                timeframe=(parsed.timeframe if parsed is not None else "daily"),
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
                parsed_strategy=parsed,
            ),
            parsed_strategy=parsed if parsed is not None else _UNSET,
            status=initial_status,
            status_message=initial_status_message,
            at=submitted_at,
        )

        run = RuleBacktestRun(
            owner_id=self.db.require_user_id(self.owner_id),
            code=normalized_code,
            strategy_text=raw_text,
            parsed_strategy_json=self._serialize_json(parsed.to_dict() if parsed is not None else {}),
            strategy_hash=hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            timeframe=parsed.timeframe if parsed is not None else "daily",
            lookback_bars=int(lookback_bars),
            initial_capital=float(initial_capital),
            fee_bps=float(fee_bps),
            parsed_confidence=(parsed.confidence if parsed is not None else None),
            needs_confirmation=bool(parsed.needs_confirmation) if parsed is not None else False,
            warnings_json=self._serialize_json(parsed.ambiguities if parsed is not None else []),
            run_at=submitted_at,
            completed_at=None,
            status=initial_status,
            no_result_reason=None,
            no_result_message=None,
            trade_count=0,
            win_count=0,
            loss_count=0,
            total_return_pct=None,
            win_rate_pct=None,
            avg_trade_return_pct=None,
            max_drawdown_pct=None,
            avg_holding_days=None,
            final_equity=None,
            summary_json=self._serialize_json(summary),
            ai_summary=None,
            equity_curve_json=self._serialize_json([]),
        )
        run = self.repo.save_run(run)
        return self._run_row_to_dict(run, include_trades=False)

    def process_submitted_run(self, run_id: int) -> None:
        """Continue a submitted run in the background."""

        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            logger.warning("Rule backtest submission %s no longer exists.", run_id)
            return
        if self._is_run_cancelled_status(row.status):
            logger.info("Rule backtest submission %s was cancelled before processing started.", run_id)
            return

        request_payload = self._extract_request_payload(row.summary_json)
        try:
            raw_text = str(row.strategy_text or "").strip()
            parsed_strategy = self._load_parsed_strategy(row.parsed_strategy_json, raw_text)
            if parsed_strategy is None:
                self._update_run_state(run_id, status="parsing", status_message="正在解析策略文本。")
                if self._should_stop_run_processing(run_id):
                    logger.info("Rule backtest submission %s was cancelled during parsing stage.", run_id)
                    return
                parsed_dict = self.parse_strategy(raw_text, code=row.code)
                parsed_strategy = self._dict_to_parsed_strategy(parsed_dict, raw_text)
                if self._should_stop_run_processing(run_id):
                    logger.info("Rule backtest submission %s was cancelled after parsing.", run_id)
                    return
                self._update_run_state(
                    run_id,
                    status="queued",
                    parsed_strategy=parsed_strategy,
                    status_message="策略解析完成，等待开始执行。",
                )

            if parsed_strategy.needs_confirmation and not request_payload["confirmed"]:
                self._mark_run_failed(
                    run_id,
                    no_result_reason="confirmation_required",
                    no_result_message="解析结果仍存在歧义，请先确认规则结构后再运行。",
                )
                return

            if self._should_stop_run_processing(run_id):
                logger.info("Rule backtest submission %s was cancelled before execution.", run_id)
                return
            self._update_run_state(run_id, status="running", parsed_strategy=parsed_strategy, status_message="正在执行规则回测。")
            result = self._execute_rule_backtest(
                code=row.code,
                parsed=parsed_strategy,
                start_date=request_payload["start_date"],
                end_date=request_payload["end_date"],
                lookback_bars=request_payload["lookback_bars"],
                initial_capital=request_payload["initial_capital"],
                fee_bps=request_payload["fee_bps"],
                slippage_bps=request_payload["slippage_bps"],
                benchmark_mode=str(request_payload.get("benchmark_mode") or BENCHMARK_MODE_AUTO),
                benchmark_code=request_payload.get("benchmark_code"),
            )

            if self._should_stop_run_processing(run_id):
                logger.info("Rule backtest submission %s was cancelled after execution completed.", run_id)
                return
            self._update_run_state(
                run_id,
                status="summarizing",
                parsed_strategy=parsed_strategy,
                metrics=result.metrics,
                no_result_reason=result.no_result_reason,
                no_result_message=result.no_result_message,
                status_message="执行完成，正在整理摘要与交易审计。",
            )
            if self._should_stop_run_processing(run_id):
                logger.info("Rule backtest submission %s was cancelled during summarizing stage.", run_id)
                return
            ai_summary = self._build_ai_summary(parsed_strategy, result)
            self._store_result(
                result,
                code=row.code,
                strategy_text=raw_text,
                start_date=request_payload["start_date"],
                end_date=request_payload["end_date"],
                lookback_bars=request_payload["lookback_bars"],
                initial_capital=request_payload["initial_capital"],
                fee_bps=request_payload["fee_bps"],
                slippage_bps=request_payload["slippage_bps"],
                benchmark_mode=str(request_payload.get("benchmark_mode") or BENCHMARK_MODE_AUTO),
                benchmark_code=request_payload.get("benchmark_code"),
                confirmed=request_payload["confirmed"],
                ai_summary=ai_summary,
                existing_run_id=run_id,
            )
        except Exception as exc:
            logger.error("Rule backtest async execution failed for run %s: %s", run_id, exc, exc_info=True)
            self._mark_run_failed(
                run_id,
                no_result_reason="execution_failed",
                no_result_message=f"规则回测执行失败：{exc}",
            )

    def list_runs(self, *, code: Optional[str] = None, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        offset = max(page - 1, 0) * limit
        rows, total = self.repo.get_runs_paginated(
            code=code,
            offset=offset,
            limit=limit,
            **self._owner_kwargs(),
        )
        return {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [self._run_row_to_dict(row, include_trades=False) for row in rows],
        }

    def get_run(self, run_id: int) -> Optional[Dict[str, Any]]:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return None
        return self._run_row_to_dict(row, include_trades=True)

    def compare_runs(self, run_ids: List[int]) -> Dict[str, Any]:
        requested_run_ids = self._normalize_compare_run_ids(run_ids)
        rows = self.repo.get_runs_by_ids(requested_run_ids, **self._owner_kwargs())
        row_map = {int(row.id): row for row in rows if getattr(row, "id", None) is not None}

        resolved_run_ids: List[int] = []
        comparable_run_ids: List[int] = []
        missing_run_ids: List[int] = []
        unavailable_runs: List[Dict[str, Any]] = []
        items: List[Dict[str, Any]] = []

        for run_id in requested_run_ids:
            row = row_map.get(int(run_id))
            if row is None:
                missing_run_ids.append(int(run_id))
                continue

            resolved_run_ids.append(int(run_id))
            run_payload = self._run_row_to_dict(row, include_trades=False)
            normalized_status = self._normalize_run_status(run_payload.get("status"))
            if normalized_status != "completed":
                unavailable_runs.append(
                    self._build_compare_unavailable_run_payload(run_payload=run_payload)
                )
                continue

            comparable_run_ids.append(int(run_id))
            items.append(self._build_compare_run_item_payload(run_payload=run_payload))

        if len(comparable_run_ids) < 2:
            unavailable_ids = [int(item["id"]) for item in unavailable_runs if item.get("id") is not None]
            raise ValueError(
                "At least two completed accessible rule backtest runs are required for comparison; "
                f"requested={requested_run_ids}, comparable={comparable_run_ids}, "
                f"missing={missing_run_ids}, unavailable={unavailable_ids}"
            )

        return {
            "comparison_source": "stored_rule_backtest_runs",
            "read_mode": "stored_first",
            "requested_run_ids": requested_run_ids,
            "resolved_run_ids": resolved_run_ids,
            "comparable_run_ids": comparable_run_ids,
            "missing_run_ids": missing_run_ids,
            "unavailable_runs": unavailable_runs,
            "field_groups": ["metadata", "parsed_strategy", "metrics", "benchmark", "execution_model"],
            "comparison_summary": self._build_compare_summary(items=items),
            "items": items,
        }

    def get_run_status(self, run_id: int) -> Optional[Dict[str, Any]]:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return None
        summary = self._load_summary_payload(row.summary_json)
        return self._build_run_status_payload(row=row, summary=summary)

    def cancel_run(self, run_id: int) -> Optional[Dict[str, Any]]:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return None

        normalized_status = self._normalize_run_status(row.status)
        if normalized_status in TERMINAL_RULE_RUN_STATUSES and normalized_status != "cancelled":
            return self.get_run_status(run_id)

        if normalized_status in CANCELLABLE_RULE_RUN_STATUSES or normalized_status == "cancelled":
            self._mark_run_cancelled(run_id, no_result_message="规则回测已取消。")
            return self.get_run_status(run_id)

        return self.get_run_status(run_id)

    def parse_and_run(
        self,
        *,
        code: str,
        strategy_text: str,
        lookback_bars: int = 252,
        initial_capital: float = 100000.0,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
        benchmark_mode: str = BENCHMARK_MODE_AUTO,
        benchmark_code: Optional[str] = None,
        confirmed: bool = False,
    ) -> Dict[str, Any]:
        parsed = self.parse_strategy(strategy_text)
        return self.run_backtest(
            code=code,
            strategy_text=strategy_text,
            parsed_strategy=parsed,
            lookback_bars=lookback_bars,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
            confirmed=confirmed,
        )

    def _validate_submission_inputs(self, *, code: str, strategy_text: str) -> tuple[str, str]:
        normalized_code = str(code or "").strip()
        if not normalized_code:
            raise ValueError("code is required")
        raw_text = str(strategy_text or "").strip()
        if not raw_text:
            raise ValueError("strategy_text is required")
        return normalized_code, raw_text

    def _execute_rule_backtest(
        self,
        *,
        code: str,
        parsed: ParsedStrategy,
        start_date: Optional[Any],
        end_date: Optional[Any],
        lookback_bars: int,
        initial_capital: float,
        fee_bps: float,
        slippage_bps: float,
        benchmark_mode: str,
        benchmark_code: Optional[str],
    ):
        normalized_start_date, normalized_end_date = self._normalize_date_range(start_date=start_date, end_date=end_date)
        load_count = max(int(lookback_bars) + parsed.max_lookback + 20, int(lookback_bars) + 30)
        history_start_date = (
            normalized_start_date - timedelta(days=max(parsed.max_lookback * 4, 120))
            if normalized_start_date is not None
            else None
        )
        self._ensure_market_history(
            code=code,
            load_count=load_count,
            start_date=history_start_date,
            end_date=normalized_end_date,
        )
        if history_start_date is not None and normalized_end_date is not None:
            rows = self.stock_repo.get_range(code, history_start_date, normalized_end_date)
            bars = rows
        else:
            rows = self.stock_repo.get_latest(code, days=load_count)
            bars = list(reversed(rows))
        if len(bars) < max(10, parsed.max_lookback + 2):
            result = self._build_empty_result(
                parsed=parsed,
                initial_capital=initial_capital,
                lookback_bars=lookback_bars,
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
                no_result_reason="insufficient_history",
                no_result_message="历史行情不足，无法执行该策略回测。",
                start_date=normalized_start_date,
                end_date=normalized_end_date,
            )
            self._apply_benchmark_context(
                result,
                instrument_code=code,
                benchmark_mode=benchmark_mode,
                benchmark_code=benchmark_code,
                start_date=normalized_start_date,
                end_date=normalized_end_date,
            )
            result.audit_ledger = self.engine._build_audit_ledger(
                equity_curve=result.equity_curve,
                benchmark_curve=result.benchmark_curve,
                buy_and_hold_curve=getattr(result, "buy_and_hold_curve", []) or [],
                benchmark_summary=dict(result.benchmark_summary or {}),
            )
            return result

        result = self.engine.run(
            code=code,
            parsed_strategy=parsed,
            bars=bars,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            lookback_bars=lookback_bars,
            start_date=normalized_start_date,
            end_date=normalized_end_date,
        )
        self._apply_benchmark_context(
            result,
            instrument_code=code,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
            start_date=normalized_start_date,
            end_date=normalized_end_date,
        )
        result.audit_ledger = self.engine._build_audit_ledger(
            equity_curve=result.equity_curve,
            benchmark_curve=result.benchmark_curve,
            buy_and_hold_curve=getattr(result, "buy_and_hold_curve", []) or [],
            benchmark_summary=dict(result.benchmark_summary or {}),
        )

        if not result.no_result_reason and result.metrics.get("trade_count", 0) <= 0:
            result.no_result_reason = "no_trades"
            result.no_result_message = "规则已解析并执行，但未产生任何交易。"
        return result

    def _ensure_market_history(
        self,
        *,
        code: str,
        load_count: int,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> int:
        if start_date is not None and end_date is not None:
            try:
                df, source = self._load_history_with_local_us_fallback(
                    code=code,
                    start_date=start_date,
                    end_date=end_date,
                    days=max(load_count, (end_date - start_date).days + 5),
                    log_context="[rule-backtest date-range history]",
                )
                if df is None or df.empty:
                    return 0
                return self.stock_repo.save_dataframe(df, code=code, data_source=source or "Unknown")
            except Exception as exc:
                logger.warning("Failed to ensure date-range rule backtest history for %s: %s", code, exc)
                return 0

        recent_rows = self.stock_repo.get_latest(code, days=load_count)
        if len(recent_rows) >= load_count:
            latest_date = recent_rows[0].date if recent_rows else None
            if latest_date and latest_date >= datetime.now().date() - timedelta(days=3):
                return 0

        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=max(load_count * 2, 180))
        try:
            df, source = self._load_history_with_local_us_fallback(
                code=code,
                start_date=start_date,
                end_date=end_date,
                days=load_count,
                log_context="[rule-backtest history]",
            )
            if df is None or df.empty:
                return 0
            return self.stock_repo.save_dataframe(df, code=code, data_source=source or "Unknown")
        except Exception as exc:
            logger.warning("Failed to ensure rule backtest history for %s: %s", code, exc)
            return 0

    def _load_history_with_local_us_fallback(
        self,
        *,
        code: str,
        start_date: date,
        end_date: date,
        days: int,
        log_context: str,
    ) -> tuple[Optional[Any], Optional[str]]:
        return fetch_daily_history_with_local_us_fallback(
            code,
            start_date=start_date,
            end_date=end_date,
            days=days,
            log_context=log_context,
        )

    @staticmethod
    def _is_a_share_like_code(code: str) -> bool:
        normalized = normalize_stock_code(str(code or ""))
        return normalized.isdigit() and len(normalized) == 6

    def _default_benchmark_mode_for_code(self, code: str) -> str:
        normalized = normalize_stock_code(str(code or "").strip()).upper()
        if is_us_stock_code(normalized) or is_us_index_code(normalized):
            return BENCHMARK_MODE_QQQ
        if self._is_a_share_like_code(normalized):
            return BENCHMARK_MODE_HS300
        return BENCHMARK_MODE_SAME_SYMBOL

    def _resolve_benchmark_selection(
        self,
        *,
        instrument_code: str,
        benchmark_mode: Optional[str],
        benchmark_code: Optional[str],
    ) -> Dict[str, Any]:
        requested_mode = str(benchmark_mode or BENCHMARK_MODE_AUTO).strip().lower() or BENCHMARK_MODE_AUTO
        auto_resolved = requested_mode == BENCHMARK_MODE_AUTO
        resolved_mode = self._default_benchmark_mode_for_code(instrument_code) if auto_resolved else requested_mode

        if resolved_mode == BENCHMARK_MODE_CUSTOM:
            normalized_custom_code = normalize_stock_code(str(benchmark_code or "").strip()).upper()
            if not normalized_custom_code:
                raise ValueError("benchmark_code is required when benchmark_mode=custom_code")
            return {
                "requested_mode": requested_mode,
                "resolved_mode": resolved_mode,
                "label": f"自定义代码 {normalized_custom_code}",
                "code": normalized_custom_code,
                "method": "custom_security",
                "auto_resolved": auto_resolved,
                "fallback_used": False,
            }

        preset = BENCHMARK_PRESET_DEFINITIONS.get(resolved_mode)
        if preset is None:
            raise ValueError(f"unsupported benchmark_mode: {benchmark_mode}")

        resolved_code = normalize_stock_code(str(preset.get("code") or instrument_code or "").strip()).upper() or None
        if resolved_mode in {BENCHMARK_MODE_NONE, BENCHMARK_MODE_SAME_SYMBOL}:
            resolved_code = None

        return {
            "requested_mode": requested_mode,
            "resolved_mode": resolved_mode,
            "label": str(preset.get("label") or "基准"),
            "code": resolved_code,
            "method": str(preset.get("method") or "benchmark_security"),
            "auto_resolved": auto_resolved,
            "fallback_used": False,
        }

    def _decorate_benchmark_summary(
        self,
        base_summary: Optional[Dict[str, Any]],
        selection: Dict[str, Any],
        *,
        unavailable_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        summary = dict(base_summary or {})
        summary["label"] = str(selection.get("label") or summary.get("label") or "基准")
        summary["code"] = selection.get("code")
        summary["method"] = str(selection.get("method") or summary.get("method") or "benchmark_security")
        summary["requested_mode"] = selection.get("requested_mode")
        summary["resolved_mode"] = selection.get("resolved_mode")
        summary["price_basis"] = str(summary.get("price_basis") or "close")
        summary["auto_resolved"] = bool(selection.get("auto_resolved"))
        summary["fallback_used"] = bool(selection.get("fallback_used"))
        summary["unavailable_reason"] = unavailable_reason
        return summary

    def _resolve_benchmark_window(
        self,
        result: Any,
        *,
        start_date: Optional[date],
        end_date: Optional[date],
    ) -> tuple[Optional[date], Optional[date]]:
        for series in (
            getattr(result, "buy_and_hold_curve", None),
            getattr(result, "benchmark_curve", None),
            [point.to_dict() for point in getattr(result, "equity_curve", [])] if getattr(result, "equity_curve", None) else None,
        ):
            rows = list(series or [])
            if not rows:
                continue
            first = self._parse_optional_date(rows[0].get("date"))
            last = self._parse_optional_date(rows[-1].get("date"))
            if first is not None and last is not None:
                return first, last

        metrics = dict(getattr(result, "metrics", {}) or {})
        return (
            self._parse_optional_date(metrics.get("period_start")) or start_date,
            self._parse_optional_date(metrics.get("period_end")) or end_date,
        )

    def _load_external_benchmark_context(
        self,
        *,
        selection: Dict[str, Any],
        window_start: date,
        window_end: date,
    ) -> tuple[List[Dict[str, Any]], Dict[str, Any], Optional[str]]:
        benchmark_code = str(selection.get("code") or "").strip()
        if not benchmark_code:
            return [], self._decorate_benchmark_summary({}, selection), "未提供基准代码。"

        load_count = max((window_end - window_start).days + 10, 80)
        self._ensure_market_history(
            code=benchmark_code,
            load_count=load_count,
            start_date=window_start,
            end_date=window_end,
        )
        rows = self.stock_repo.get_range(benchmark_code, window_start, window_end)
        if not rows:
            reason = f"{selection.get('label') or benchmark_code} 在当前窗口没有可用行情。"
            return [], self._decorate_benchmark_summary({}, selection, unavailable_reason=reason), reason

        curve = self.engine._build_benchmark_curve(rows)
        if not curve:
            reason = f"{selection.get('label') or benchmark_code} 行情存在缺失，无法构建基准曲线。"
            return [], self._decorate_benchmark_summary({}, selection, unavailable_reason=reason), reason

        metrics = self.engine._build_benchmark_metrics(rows)
        summary = self._decorate_benchmark_summary(
            self.engine._build_benchmark_summary(metrics),
            selection,
        )
        return curve, summary, None

    def _apply_benchmark_context(
        self,
        result: Any,
        *,
        instrument_code: str,
        benchmark_mode: Optional[str],
        benchmark_code: Optional[str],
        start_date: Optional[date],
        end_date: Optional[date],
    ) -> None:
        same_symbol_selection = {
            "requested_mode": BENCHMARK_MODE_SAME_SYMBOL,
            "resolved_mode": BENCHMARK_MODE_SAME_SYMBOL,
            "label": "当前标的买入并持有",
            "code": None,
            "method": "same_symbol_buy_and_hold",
            "auto_resolved": False,
            "fallback_used": False,
        }
        same_symbol_curve = list(getattr(result, "buy_and_hold_curve", None) or getattr(result, "benchmark_curve", None) or [])
        same_symbol_summary = self._decorate_benchmark_summary(
            getattr(result, "buy_and_hold_summary", None) or getattr(result, "benchmark_summary", None) or {},
            same_symbol_selection,
        )
        result.buy_and_hold_curve = same_symbol_curve
        result.buy_and_hold_summary = same_symbol_summary

        selection = self._resolve_benchmark_selection(
            instrument_code=instrument_code,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
        )
        selected_curve: List[Dict[str, Any]] = []
        selected_summary: Dict[str, Any]
        unavailable_reason: Optional[str] = None

        if selection["resolved_mode"] == BENCHMARK_MODE_NONE:
            selected_summary = self._decorate_benchmark_summary({}, selection)
        elif selection["resolved_mode"] == BENCHMARK_MODE_SAME_SYMBOL:
            selected_curve = same_symbol_curve
            selected_summary = self._decorate_benchmark_summary(same_symbol_summary, selection)
        else:
            window_start, window_end = self._resolve_benchmark_window(result, start_date=start_date, end_date=end_date)
            if window_start is not None and window_end is not None:
                selected_curve, selected_summary, unavailable_reason = self._load_external_benchmark_context(
                    selection=selection,
                    window_start=window_start,
                    window_end=window_end,
                )
            else:
                unavailable_reason = "当前结果没有可用于匹配基准的有效日期窗口。"
                selected_summary = self._decorate_benchmark_summary({}, selection, unavailable_reason=unavailable_reason)

            if not selected_curve and selection.get("requested_mode") == BENCHMARK_MODE_AUTO and same_symbol_curve:
                fallback_selection = dict(same_symbol_selection)
                fallback_selection["requested_mode"] = BENCHMARK_MODE_AUTO
                fallback_selection["auto_resolved"] = True
                fallback_selection["fallback_used"] = True
                selected_curve = same_symbol_curve
                selected_summary = self._decorate_benchmark_summary(same_symbol_summary, fallback_selection, unavailable_reason=unavailable_reason)

        result.benchmark_curve = selected_curve
        result.benchmark_summary = selected_summary

        comparison_metrics = self._build_benchmark_comparison_metrics(
            total_return_pct=(getattr(result, "metrics", {}) or {}).get("total_return_pct"),
            benchmark_summary=selected_summary,
            buy_and_hold_summary=same_symbol_summary,
        )
        result.metrics["buy_and_hold_return_pct"] = comparison_metrics.get("buy_and_hold_return_pct")
        result.metrics["excess_return_vs_buy_and_hold_pct"] = comparison_metrics.get("excess_return_vs_buy_and_hold_pct")
        result.metrics["benchmark_return_pct"] = comparison_metrics.get("benchmark_return_pct")
        result.metrics["excess_return_vs_benchmark_pct"] = comparison_metrics.get("excess_return_vs_benchmark_pct")
        result.execution_assumptions.benchmark_method = str(selected_summary.get("method") or "no_benchmark")
        result.execution_assumptions.benchmark_price_basis = str(selected_summary.get("price_basis") or "close")

    def _ensure_parsed_strategy(
        self,
        raw_text: str,
        parsed_strategy: Optional[Dict[str, Any]],
        *,
        code: Optional[str] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        initial_capital: Optional[float] = None,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
    ) -> ParsedStrategy:
        if parsed_strategy:
            parsed = self._dict_to_parsed_strategy(parsed_strategy, raw_text)
        else:
            parsed_dict = self.parse_strategy(raw_text, code=code)
            parsed = self._dict_to_parsed_strategy(parsed_dict, raw_text)
        return self._normalize_parsed_strategy(
            parsed,
            code=code,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
        )

    def _load_parsed_strategy(self, parsed_strategy_json: Optional[str], raw_text: str) -> Optional[ParsedStrategy]:
        if not parsed_strategy_json:
            return None
        try:
            parsed_dict = json.loads(parsed_strategy_json)
        except Exception:
            return None
        if not isinstance(parsed_dict, dict) or not parsed_dict:
            return None
        parsed = self._dict_to_parsed_strategy(parsed_dict, raw_text)
        return self._normalize_parsed_strategy(parsed)

    def _build_empty_result(
        self,
        *,
        parsed: ParsedStrategy,
        initial_capital: float,
        lookback_bars: int,
        fee_bps: float,
        slippage_bps: float,
        no_result_reason: str,
        no_result_message: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ):
        metrics = {
            "initial_capital": float(initial_capital),
            "final_equity": float(initial_capital),
            "total_return_pct": 0.0,
            "benchmark_return_pct": None,
            "excess_return_vs_benchmark_pct": None,
            "buy_and_hold_return_pct": 0.0,
            "excess_return_vs_buy_and_hold_pct": 0.0,
            "trade_count": 0,
            "entry_signal_count": 0,
            "win_count": 0,
            "loss_count": 0,
            "win_rate_pct": 0.0,
            "avg_trade_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "avg_holding_days": 0.0,
            "avg_holding_bars": 0.0,
            "avg_holding_calendar_days": 0.0,
            "bars_used": 0,
            "lookback_bars": int(lookback_bars),
            "period_start": start_date.isoformat() if start_date is not None else None,
            "period_end": end_date.isoformat() if end_date is not None else None,
        }
        from src.core.rule_backtest_engine import RuleBacktestResult

        execution_model = self.engine._build_execution_model(
            timeframe=parsed.timeframe,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            strategy_type=str(parsed.strategy_spec.get("strategy_type") or parsed.strategy_kind),
        )
        assumptions = self.engine._build_execution_assumptions(execution_model=execution_model)
        return RuleBacktestResult(
            parsed_strategy=parsed,
            execution_model=execution_model,
            execution_assumptions=assumptions,
            trades=[],
            equity_curve=[],
            metrics=metrics,
            no_result_reason=no_result_reason,
            no_result_message=no_result_message,
            warnings=parsed.ambiguities,
        )

    def _store_result(
        self,
        result,
        *,
        code: str,
        strategy_text: str,
        start_date: Optional[Any],
        end_date: Optional[Any],
        lookback_bars: int,
        initial_capital: float,
        fee_bps: float,
        slippage_bps: float,
        benchmark_mode: str,
        benchmark_code: Optional[str],
        confirmed: bool,
        ai_summary: Optional[str] = None,
        existing_run_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        run_at = datetime.now()
        normalized_start_date, normalized_end_date = self._normalize_date_range(start_date=start_date, end_date=end_date)
        strategy_hash = hashlib.sha256(strategy_text.encode("utf-8")).hexdigest()
        warnings = result.warnings or []
        equity_payload = [p.to_dict() for p in result.equity_curve]
        trade_payload = [trade.to_dict() for trade in result.trades]
        audit_rows = [row.to_dict() for row in list(getattr(result, "audit_ledger", []) or [])]
        replay_series = self._build_replay_series_from_audit_rows(audit_rows)
        daily_return_series = list(replay_series.get("daily_return_series") or [])
        exposure_curve = list(replay_series.get("exposure_curve") or [])
        comparison_payload = self._build_benchmark_comparison_payload(
            total_return_pct=result.metrics.get("total_return_pct"),
            benchmark_curve=result.benchmark_curve,
            benchmark_summary=result.benchmark_summary,
            buy_and_hold_curve=getattr(result, "buy_and_hold_curve", []) or [],
            buy_and_hold_summary=getattr(result, "buy_and_hold_summary", {}) or {},
        )
        execution_model_payload = result.execution_model.to_dict()
        execution_assumptions_payload = result.execution_assumptions.to_dict()
        visualization_payload = {
            "benchmark_curve": comparison_payload.get("benchmark_curve") or [],
            "benchmark_summary": comparison_payload.get("benchmark_summary") or {},
            "buy_and_hold_curve": comparison_payload.get("buy_and_hold_curve") or [],
            "buy_and_hold_summary": comparison_payload.get("buy_and_hold_summary") or {},
            "comparison": comparison_payload,
            "audit_rows": audit_rows,
            "daily_return_series": daily_return_series,
            "exposure_curve": exposure_curve,
        }
        execution_trace_payload = self._build_execution_trace_payload(
            parsed_strategy=result.parsed_strategy.to_dict(),
            audit_rows=audit_rows,
            execution_model=execution_model_payload,
            execution_assumptions=execution_assumptions_payload,
            benchmark_summary=dict(result.benchmark_summary or {}),
            source="stored_execution_trace",
            trace_rebuilt=False,
        )
        summary_patch = self._update_summary_payload(
            {},
            request_payload=self._build_request_payload(
                start_date=normalized_start_date,
                end_date=normalized_end_date,
                lookback_bars=lookback_bars,
                initial_capital=initial_capital,
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
                benchmark_mode=benchmark_mode,
                benchmark_code=benchmark_code,
                confirmed=confirmed,
                execution_model=execution_model_payload,
            ),
            metrics=result.metrics,
            parsed_strategy=result.parsed_strategy,
            execution_model=execution_model_payload,
            execution_assumptions=execution_assumptions_payload,
            visualization=visualization_payload,
            execution_trace=execution_trace_payload,
            no_result_reason=result.no_result_reason,
            no_result_message=result.no_result_message,
            ai_summary=ai_summary,
            status="completed",
            status_message="规则回测已完成，可查看交易明细与执行假设。",
            at=run_at,
        )

        if existing_run_id is None:
            run = RuleBacktestRun(
                owner_id=self.db.require_user_id(self.owner_id),
                code=code,
                strategy_text=strategy_text,
                parsed_strategy_json=self._serialize_json(result.parsed_strategy.to_dict()),
                strategy_hash=strategy_hash,
                timeframe=result.parsed_strategy.timeframe,
                lookback_bars=int(lookback_bars),
                initial_capital=float(initial_capital),
                fee_bps=float(fee_bps),
                parsed_confidence=result.parsed_strategy.confidence,
                needs_confirmation=bool(result.parsed_strategy.needs_confirmation),
                warnings_json=self._serialize_json(warnings),
                run_at=run_at,
                completed_at=run_at,
                status="completed",
                no_result_reason=result.no_result_reason,
                no_result_message=result.no_result_message,
                trade_count=result.metrics.get("trade_count", 0),
                win_count=result.metrics.get("win_count", 0),
                loss_count=result.metrics.get("loss_count", 0),
                total_return_pct=result.metrics.get("total_return_pct"),
                win_rate_pct=result.metrics.get("win_rate_pct"),
                avg_trade_return_pct=result.metrics.get("avg_trade_return_pct"),
                max_drawdown_pct=result.metrics.get("max_drawdown_pct"),
                avg_holding_days=self._resolve_avg_holding_days(result.metrics),
                final_equity=result.metrics.get("final_equity"),
                summary_json=self._serialize_json(summary_patch),
                ai_summary=ai_summary,
                equity_curve_json=self._serialize_json(equity_payload),
            )
            run = self.repo.save_run(run)
        else:
            existing = self.repo.get_run(existing_run_id, **self._owner_kwargs())
            merged_summary = self._update_summary_payload(
                self._load_summary_payload(existing.summary_json if existing is not None else None),
                request_payload=summary_patch.get("request"),
                metrics=result.metrics,
                parsed_strategy=result.parsed_strategy,
                execution_model=summary_patch.get("execution_model"),
                execution_assumptions=summary_patch.get("execution_assumptions"),
                visualization=summary_patch.get("visualization"),
                execution_trace=summary_patch.get("execution_trace"),
                no_result_reason=result.no_result_reason,
                no_result_message=result.no_result_message,
                ai_summary=ai_summary,
                status="completed",
                status_message="规则回测已完成，可查看交易明细与执行假设。",
                at=run_at,
            )
            run = self.repo.update_run(
                existing_run_id,
                **self._owner_kwargs(),
                parsed_strategy_json=self._serialize_json(result.parsed_strategy.to_dict()),
                strategy_hash=strategy_hash,
                timeframe=result.parsed_strategy.timeframe,
                lookback_bars=int(lookback_bars),
                initial_capital=float(initial_capital),
                fee_bps=float(fee_bps),
                parsed_confidence=result.parsed_strategy.confidence,
                needs_confirmation=bool(result.parsed_strategy.needs_confirmation),
                warnings_json=self._serialize_json(warnings),
                completed_at=run_at,
                status="completed",
                no_result_reason=result.no_result_reason,
                no_result_message=result.no_result_message,
                trade_count=result.metrics.get("trade_count", 0),
                win_count=result.metrics.get("win_count", 0),
                loss_count=result.metrics.get("loss_count", 0),
                total_return_pct=result.metrics.get("total_return_pct"),
                win_rate_pct=result.metrics.get("win_rate_pct"),
                avg_trade_return_pct=result.metrics.get("avg_trade_return_pct"),
                max_drawdown_pct=result.metrics.get("max_drawdown_pct"),
                avg_holding_days=self._resolve_avg_holding_days(result.metrics),
                final_equity=result.metrics.get("final_equity"),
                summary_json=self._serialize_json(merged_summary),
                ai_summary=ai_summary,
                equity_curve_json=self._serialize_json(equity_payload),
            )
            if run is None:
                raise ValueError(f"Run {existing_run_id} not found.")
            self.repo.delete_trades_by_run_ids([run.id])

        trade_rows = [
            RuleBacktestTrade(
                run_id=run.id,
                trade_index=index,
                code=code,
                entry_date=trade.entry_date,
                exit_date=trade.exit_date,
                entry_price=trade.entry_price,
                exit_price=trade.exit_price,
                entry_signal=trade.entry_signal,
                exit_signal=trade.exit_signal,
                return_pct=trade.return_pct,
                holding_days=trade.holding_bars,
                entry_rule_json=self._serialize_json(
                    {
                        "rule": trade.entry_rule_json,
                        "signal_date": trade.entry_signal_date.isoformat(),
                        "trigger": trade.entry_trigger,
                        "indicators": trade.entry_indicators,
                        "signal_price_basis": trade.signal_price_basis,
                        "fill_basis": trade.entry_fill_basis,
                    }
                ),
                exit_rule_json=self._serialize_json(
                    {
                        "rule": trade.exit_rule_json,
                        "signal_date": trade.exit_signal_date.isoformat(),
                        "trigger": trade.exit_trigger,
                        "indicators": trade.exit_indicators,
                        "signal_price_basis": trade.signal_price_basis,
                        "fill_basis": trade.exit_fill_basis,
                    }
                ),
                notes=self._serialize_json(
                    {
                        "entry_fill_basis": trade.entry_fill_basis,
                        "exit_fill_basis": trade.exit_fill_basis,
                        "signal_price_basis": trade.signal_price_basis,
                        "price_basis": trade.price_basis,
                        "fee_bps": trade.fee_bps,
                        "slippage_bps": trade.slippage_bps,
                        "entry_fee_amount": trade.entry_fee_amount,
                        "exit_fee_amount": trade.exit_fee_amount,
                        "entry_slippage_amount": trade.entry_slippage_amount,
                        "exit_slippage_amount": trade.exit_slippage_amount,
                        "holding_bars": trade.holding_bars,
                        "holding_calendar_days": trade.holding_calendar_days,
                        "notes": trade.notes,
                    }
                ),
            )
            for index, trade in enumerate(result.trades)
        ]
        if trade_rows:
            self.repo.save_trades(trade_rows)

        return self._run_row_to_dict(
            run,
            include_trades=True,
            trades_override=trade_payload,
            equity_override=equity_payload,
            parsed_override=result.parsed_strategy.to_dict(),
            ai_summary_override=ai_summary,
            summary_override=(summary_patch if existing_run_id is None else self._load_summary_payload(run.summary_json)),
        )

    def _update_run_state(
        self,
        run_id: int,
        *,
        status: str,
        status_message: Optional[str] = None,
        parsed_strategy: Optional[ParsedStrategy] = None,
        metrics: Optional[Dict[str, Any]] = None,
        no_result_reason: Optional[str] = None,
        no_result_message: Optional[str] = None,
    ) -> None:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return
        summary = self._update_summary_payload(
            self._load_summary_payload(row.summary_json),
            parsed_strategy=parsed_strategy if parsed_strategy is not None else _UNSET,
            metrics=metrics if metrics is not None else _UNSET,
            execution_model=(
                self._build_execution_model_payload(
                    timeframe=parsed_strategy.timeframe,
                    fee_bps=row.fee_bps,
                    slippage_bps=float(self._extract_request_payload(row.summary_json).get("slippage_bps") or 0.0),
                    parsed_strategy=parsed_strategy,
                )
                if parsed_strategy is not None
                else _UNSET
            ),
            execution_assumptions=(
                self._build_execution_assumptions_payload(
                    execution_model=self._build_execution_model_payload(
                        timeframe=parsed_strategy.timeframe,
                        fee_bps=row.fee_bps,
                        slippage_bps=float(self._extract_request_payload(row.summary_json).get("slippage_bps") or 0.0),
                        parsed_strategy=parsed_strategy,
                    )
                )
                if parsed_strategy is not None
                else _UNSET
            ),
            no_result_reason=no_result_reason if no_result_reason is not None else _UNSET,
            no_result_message=no_result_message if no_result_message is not None else _UNSET,
            status=status,
            status_message=status_message,
        )
        self.repo.update_run(
            run_id,
            **self._owner_kwargs(),
            status=status,
            parsed_strategy_json=(
                self._serialize_json(parsed_strategy.to_dict())
                if parsed_strategy is not None
                else row.parsed_strategy_json
            ),
            timeframe=(parsed_strategy.timeframe if parsed_strategy is not None else row.timeframe),
            parsed_confidence=(parsed_strategy.confidence if parsed_strategy is not None else row.parsed_confidence),
            needs_confirmation=(
                bool(parsed_strategy.needs_confirmation)
                if parsed_strategy is not None
                else row.needs_confirmation
            ),
            warnings_json=(
                self._serialize_json(parsed_strategy.ambiguities)
                if parsed_strategy is not None
                else row.warnings_json
            ),
            no_result_reason=row.no_result_reason if no_result_reason is None else no_result_reason,
            no_result_message=row.no_result_message if no_result_message is None else no_result_message,
            summary_json=self._serialize_json(summary),
        )

    def _mark_run_failed(self, run_id: int, *, no_result_reason: str, no_result_message: str) -> None:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return
        summary = self._update_summary_payload(
            self._load_summary_payload(row.summary_json),
            no_result_reason=no_result_reason,
            no_result_message=no_result_message,
            status="failed",
            status_message=no_result_message,
        )
        self.repo.update_run(
            run_id,
            **self._owner_kwargs(),
            status="failed",
            completed_at=datetime.now(),
            no_result_reason=no_result_reason,
            no_result_message=no_result_message,
            summary_json=self._serialize_json(summary),
        )

    def _mark_run_cancelled(self, run_id: int, *, no_result_message: str) -> None:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return
        if self._is_run_cancelled_status(row.status):
            return

        summary = self._update_summary_payload(
            self._load_summary_payload(row.summary_json),
            no_result_reason="cancelled",
            no_result_message=no_result_message,
            status="cancelled",
            status_message=no_result_message,
            at=datetime.now(),
        )
        self.repo.update_run(
            run_id,
            **self._owner_kwargs(),
            status="cancelled",
            completed_at=row.completed_at or datetime.now(),
            no_result_reason="cancelled",
            no_result_message=no_result_message,
            summary_json=self._serialize_json(summary),
        )

    @staticmethod
    def _normalize_run_status(status: Optional[str]) -> str:
        return str(status or "").strip().lower()

    @staticmethod
    def _normalize_compare_run_ids(run_ids: List[int]) -> List[int]:
        normalized_ids: List[int] = []
        seen: set[int] = set()
        for raw_value in list(run_ids or []):
            try:
                normalized = int(raw_value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid rule backtest run id: {raw_value}") from exc
            if normalized <= 0:
                raise ValueError("Rule backtest compare run ids must be positive integers.")
            if normalized in seen:
                continue
            seen.add(normalized)
            normalized_ids.append(normalized)
        if len(normalized_ids) < 2:
            raise ValueError("At least two rule backtest run ids are required for comparison.")
        if len(normalized_ids) > 10:
            raise ValueError("Rule backtest compare currently supports at most 10 run ids per request.")
        return normalized_ids

    @classmethod
    def _build_compare_unavailable_run_payload(cls, *, run_payload: Dict[str, Any]) -> Dict[str, Any]:
        status = cls._normalize_run_status(run_payload.get("status"))
        return {
            "id": int(run_payload["id"]),
            "code": str(run_payload.get("code") or ""),
            "status": status or str(run_payload.get("status") or ""),
            "reason": "run_not_completed",
            "message": "Only completed runs are comparable in the stored-first compare foundation.",
        }

    @staticmethod
    def _build_compare_run_item_payload(*, run_payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "metadata": {
                "id": int(run_payload["id"]),
                "code": str(run_payload.get("code") or ""),
                "status": str(run_payload.get("status") or ""),
                "run_at": run_payload.get("run_at"),
                "completed_at": run_payload.get("completed_at"),
                "timeframe": str(run_payload.get("timeframe") or ""),
                "start_date": run_payload.get("start_date"),
                "end_date": run_payload.get("end_date"),
                "period_start": run_payload.get("period_start"),
                "period_end": run_payload.get("period_end"),
                "lookback_bars": int(run_payload.get("lookback_bars") or 0),
                "initial_capital": float(run_payload.get("initial_capital") or 0.0),
                "fee_bps": float(run_payload.get("fee_bps") or 0.0),
                "slippage_bps": float(run_payload.get("slippage_bps") or 0.0),
            },
            "parsed_strategy": dict(run_payload.get("parsed_strategy") or {}),
            "metrics": {
                "trade_count": int(run_payload.get("trade_count") or 0),
                "win_count": int(run_payload.get("win_count") or 0),
                "loss_count": int(run_payload.get("loss_count") or 0),
                "total_return_pct": run_payload.get("total_return_pct"),
                "annualized_return_pct": run_payload.get("annualized_return_pct"),
                "benchmark_return_pct": run_payload.get("benchmark_return_pct"),
                "excess_return_vs_benchmark_pct": run_payload.get("excess_return_vs_benchmark_pct"),
                "buy_and_hold_return_pct": run_payload.get("buy_and_hold_return_pct"),
                "excess_return_vs_buy_and_hold_pct": run_payload.get("excess_return_vs_buy_and_hold_pct"),
                "win_rate_pct": run_payload.get("win_rate_pct"),
                "avg_trade_return_pct": run_payload.get("avg_trade_return_pct"),
                "max_drawdown_pct": run_payload.get("max_drawdown_pct"),
                "avg_holding_days": run_payload.get("avg_holding_days"),
                "avg_holding_bars": run_payload.get("avg_holding_bars"),
                "avg_holding_calendar_days": run_payload.get("avg_holding_calendar_days"),
                "final_equity": run_payload.get("final_equity"),
            },
            "benchmark": {
                "benchmark_mode": run_payload.get("benchmark_mode"),
                "benchmark_code": run_payload.get("benchmark_code"),
                "benchmark_summary": dict(run_payload.get("benchmark_summary") or {}),
                "buy_and_hold_summary": dict(run_payload.get("buy_and_hold_summary") or {}),
            },
            "execution_model": dict(run_payload.get("execution_model") or {}),
            "result_authority": dict(run_payload.get("result_authority") or {}),
        }

    @classmethod
    def _build_compare_summary(cls, *, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not items:
            raise ValueError("comparison summary requires at least one comparable run item")

        baseline_item = dict(items[0] or {})
        baseline_metadata = dict(baseline_item.get("metadata") or {})
        baseline_parsed_strategy = dict(baseline_item.get("parsed_strategy") or {})
        baseline_strategy_spec = dict(baseline_parsed_strategy.get("strategy_spec") or {})
        baseline_strategy_family = cls._extract_compare_strategy_family(baseline_item)
        baseline_strategy_type = cls._extract_compare_strategy_type(baseline_item)

        code_values = sorted(
            {
                str(dict(item.get("metadata") or {}).get("code") or "")
                for item in items
                if str(dict(item.get("metadata") or {}).get("code") or "")
            }
        )
        timeframe_values = sorted(
            {
                str(dict(item.get("metadata") or {}).get("timeframe") or "")
                for item in items
                if str(dict(item.get("metadata") or {}).get("timeframe") or "")
            }
        )
        strategy_family_values = sorted(
            {
                str(cls._extract_compare_strategy_family(item) or "")
                for item in items
                if str(cls._extract_compare_strategy_family(item) or "")
            }
        )
        strategy_type_values = sorted(
            {
                str(cls._extract_compare_strategy_type(item) or "")
                for item in items
                if str(cls._extract_compare_strategy_type(item) or "")
            }
        )
        date_ranges = [
            {
                "run_id": int(dict(item.get("metadata") or {}).get("id") or 0),
                "start_date": dict(item.get("metadata") or {}).get("start_date"),
                "end_date": dict(item.get("metadata") or {}).get("end_date"),
            }
            for item in items
        ]
        distinct_date_ranges = {
            (
                item.get("start_date"),
                item.get("end_date"),
            )
            for item in date_ranges
        }

        return {
            "baseline": {
                "run_id": int(baseline_metadata.get("id") or 0),
                "selection_rule": "first_comparable_run_by_request_order",
                "code": str(baseline_metadata.get("code") or ""),
                "timeframe": str(baseline_metadata.get("timeframe") or ""),
                "start_date": baseline_metadata.get("start_date"),
                "end_date": baseline_metadata.get("end_date"),
                "strategy_family": baseline_strategy_family,
                "strategy_type": (
                    str(baseline_strategy_spec.get("strategy_type") or baseline_strategy_type)
                    if (baseline_strategy_spec or baseline_strategy_type)
                    else None
                ),
            },
            "context": {
                "code_values": code_values,
                "timeframe_values": timeframe_values,
                "strategy_family_values": strategy_family_values,
                "strategy_type_values": strategy_type_values,
                "date_ranges": date_ranges,
                "all_same_code": len(code_values) <= 1,
                "all_same_timeframe": len(timeframe_values) <= 1,
                "all_same_date_range": len(distinct_date_ranges) <= 1,
            },
            "metric_deltas": {
                metric_name: cls._build_compare_metric_delta(metric_name=metric_name, items=items)
                for metric_name in COMPARE_DELTA_METRICS
            },
        }

    @staticmethod
    def _extract_compare_strategy_family(item: Dict[str, Any]) -> Optional[str]:
        parsed_strategy = dict(item.get("parsed_strategy") or {})
        strategy_spec = dict(parsed_strategy.get("strategy_spec") or {})
        value = strategy_spec.get("strategy_family") or parsed_strategy.get("strategy_kind")
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _extract_compare_strategy_type(item: Dict[str, Any]) -> Optional[str]:
        parsed_strategy = dict(item.get("parsed_strategy") or {})
        strategy_spec = dict(parsed_strategy.get("strategy_spec") or {})
        value = strategy_spec.get("strategy_type") or parsed_strategy.get("strategy_kind")
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @classmethod
    def _build_compare_metric_delta(
        cls,
        *,
        metric_name: str,
        items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        baseline_item = dict(items[0] or {})
        baseline_metadata = dict(baseline_item.get("metadata") or {})
        baseline_metrics = dict(baseline_item.get("metrics") or {})
        baseline_run_id = int(baseline_metadata.get("id") or 0)
        baseline_value = cls._normalize_compare_metric_value(baseline_metrics.get(metric_name))

        available_run_ids: List[int] = []
        unavailable_run_ids: List[int] = []
        deltas: List[Dict[str, Any]] = []

        for item in items:
            metadata = dict(item.get("metadata") or {})
            metrics = dict(item.get("metrics") or {})
            run_id = int(metadata.get("id") or 0)
            metric_value = cls._normalize_compare_metric_value(metrics.get(metric_name))
            if metric_value is None:
                unavailable_run_ids.append(run_id)
                continue
            available_run_ids.append(run_id)
            deltas.append(
                {
                    "run_id": run_id,
                    "value": metric_value,
                    "delta_vs_baseline": (
                        metric_value - baseline_value
                        if baseline_value is not None
                        else None
                    ),
                }
            )

        if not available_run_ids:
            state = "unavailable"
        elif baseline_value is None:
            state = "baseline_unavailable"
        elif unavailable_run_ids:
            state = "partial"
        else:
            state = "comparable"

        return {
            "label": metric_name,
            "state": state,
            "baseline_run_id": baseline_run_id,
            "baseline_value": baseline_value,
            "available_run_ids": available_run_ids,
            "unavailable_run_ids": unavailable_run_ids,
            "deltas": deltas,
        }

    @staticmethod
    def _normalize_compare_metric_value(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _is_run_cancelled_status(cls, status: Optional[str]) -> bool:
        return cls._normalize_run_status(status) == "cancelled"

    def _should_stop_run_processing(self, run_id: int) -> bool:
        row = self.repo.get_run(run_id, **self._owner_kwargs())
        if row is None:
            return True
        return self._is_run_cancelled_status(row.status)

    @staticmethod
    def _build_run_status_payload(*, row: RuleBacktestRun, summary: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": int(row.id),
            "code": str(row.code),
            "status": str(row.status),
            "status_message": summary.get("status_message"),
            "status_history": list(summary.get("status_history") or []),
            "run_at": row.run_at.isoformat() if row.run_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "no_result_reason": row.no_result_reason,
            "no_result_message": row.no_result_message,
            "trade_count": int(row.trade_count or 0),
            "parsed_confidence": row.parsed_confidence,
            "needs_confirmation": bool(row.needs_confirmation),
        }

    @staticmethod
    def _load_summary_payload(summary_json: Optional[str]) -> Dict[str, Any]:
        if not summary_json:
            return {}
        try:
            parsed = json.loads(summary_json)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _serialize_json(payload: Any) -> str:
        return json.dumps(payload, ensure_ascii=False)

    @staticmethod
    def _extract_request_payload(summary_json: Optional[str]) -> Dict[str, Any]:
        summary = RuleBacktestService._load_summary_payload(summary_json)
        request = summary.get("request") or {}
        return {
            "start_date": RuleBacktestService._parse_optional_date(request.get("start_date")),
            "end_date": RuleBacktestService._parse_optional_date(request.get("end_date")),
            "lookback_bars": int(request.get("lookback_bars") or 252),
            "initial_capital": float(request.get("initial_capital") or 100000.0),
            "fee_bps": float(request.get("fee_bps") or 0.0),
            "slippage_bps": float(request.get("slippage_bps") or 0.0),
            "benchmark_mode": str(request.get("benchmark_mode") or BENCHMARK_MODE_AUTO),
            "benchmark_code": str(request.get("benchmark_code") or "").strip() or None,
            "confirmed": bool(request.get("confirmed", False)),
            "execution_model": dict(request.get("execution_model") or {}),
        }

    @staticmethod
    def _build_request_payload(
        *,
        start_date: Optional[date],
        end_date: Optional[date],
        lookback_bars: int,
        initial_capital: float,
        fee_bps: float,
        slippage_bps: float,
        benchmark_mode: str,
        benchmark_code: Optional[str],
        confirmed: bool,
        execution_model: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "start_date": start_date.isoformat() if start_date is not None else None,
            "end_date": end_date.isoformat() if end_date is not None else None,
            "lookback_bars": int(lookback_bars),
            "initial_capital": float(initial_capital),
            "fee_bps": float(fee_bps),
            "slippage_bps": float(slippage_bps),
            "benchmark_mode": str(benchmark_mode or BENCHMARK_MODE_AUTO),
            "benchmark_code": str(benchmark_code or "").strip() or None,
            "confirmed": bool(confirmed),
            "execution_model": dict(execution_model or {}),
        }

    @staticmethod
    def _append_status_history(
        summary: Dict[str, Any],
        status: str,
        *,
        status_message: Optional[str] = None,
        at: Optional[datetime] = None,
    ) -> None:
        status_history = list(summary.get("status_history") or [])
        timestamp = at or datetime.now()
        history_item = {"status": status, "at": timestamp.isoformat()}
        if status_message:
            history_item["message"] = status_message
        status_history.append(history_item)
        summary["status_history"] = status_history
        if status_message:
            summary["status_message"] = status_message

    def _build_execution_model_payload(
        self,
        *,
        timeframe: str,
        fee_bps: float,
        slippage_bps: float,
        parsed_strategy: Optional[ParsedStrategy] = None,
    ) -> Dict[str, Any]:
        strategy_type = "rule_conditions"
        if parsed_strategy is not None:
            strategy_type = str(parsed_strategy.strategy_spec.get("strategy_type") or parsed_strategy.strategy_kind)
        return self.engine._build_execution_model(
            timeframe=timeframe,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            strategy_type=strategy_type,
        ).to_dict()

    def _build_execution_assumptions_payload(
        self,
        *,
        execution_model: Dict[str, Any],
    ) -> Dict[str, Any]:
        resolved_model = ExecutionModelConfig.from_dict(execution_model)
        if resolved_model is None:
            return {}
        return self.engine._build_execution_assumptions(
            execution_model=resolved_model,
        ).to_dict()

    @staticmethod
    def _build_execution_assumptions_snapshot_payload(
        *,
        payload: Optional[Dict[str, Any]],
        source: str,
        completeness: str,
        missing_keys: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return {
            "version": "v1",
            "source": str(source or "unknown"),
            "completeness": str(completeness or "unknown"),
            "missing_keys": [str(item) for item in (missing_keys or []) if str(item or "").strip()],
            "payload": dict(payload or {}),
        }

    @staticmethod
    def _extract_execution_assumptions_snapshot_payload(summary: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        snapshot = summary.get("execution_assumptions_snapshot")
        if not isinstance(snapshot, dict) or not snapshot:
            return None
        payload = snapshot.get("payload")
        if not isinstance(payload, dict):
            return None
        return snapshot

    @staticmethod
    def _resolve_execution_assumptions_snapshot(
        *,
        summary: Dict[str, Any],
        derived_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        snapshot = RuleBacktestService._extract_execution_assumptions_snapshot_payload(summary)
        if snapshot is not None:
            stored_payload = dict(snapshot.get("payload") or {})
            missing_keys = [key for key in derived_payload.keys() if stored_payload.get(key) is None]
            resolved_payload = dict(derived_payload)
            resolved_payload.update({key: value for key, value in stored_payload.items() if value is not None})
            if missing_keys:
                return RuleBacktestService._build_execution_assumptions_snapshot_payload(
                    payload=resolved_payload,
                    source="summary.execution_assumptions_snapshot+derived_defaults",
                    completeness="stored_partial_repaired",
                    missing_keys=missing_keys,
                )
            return RuleBacktestService._build_execution_assumptions_snapshot_payload(
                payload=resolved_payload,
                source="summary.execution_assumptions_snapshot",
                completeness="complete",
                missing_keys=[],
            )

        legacy_payload = summary.get("execution_assumptions")
        if isinstance(legacy_payload, dict) and legacy_payload:
            missing_keys = [key for key in derived_payload.keys() if legacy_payload.get(key) is None]
            resolved_payload = dict(derived_payload)
            resolved_payload.update({key: value for key, value in legacy_payload.items() if value is not None})
            if missing_keys:
                return RuleBacktestService._build_execution_assumptions_snapshot_payload(
                    payload=resolved_payload,
                    source="summary.execution_assumptions+derived_defaults",
                    completeness="legacy_partial_repaired",
                    missing_keys=missing_keys,
                )
            return RuleBacktestService._build_execution_assumptions_snapshot_payload(
                payload=resolved_payload,
                source="summary.execution_assumptions",
                completeness="legacy_complete",
                missing_keys=[],
            )

        return RuleBacktestService._build_execution_assumptions_snapshot_payload(
            payload=derived_payload,
            source="derived_from_execution_model",
            completeness="derived",
            missing_keys=[],
        )
    @staticmethod
    def _build_daily_return_series(equity_curve: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        series: List[Dict[str, Any]] = []
        previous_equity: Optional[float] = None
        for point in equity_curve or []:
            current_equity = _safe_float(point.get("equity"))
            point_date = point.get("date")
            if current_equity is None or not point_date:
                continue
            daily_return_pct = 0.0
            daily_pnl = 0.0
            if previous_equity is not None and previous_equity > 0:
                daily_pnl = current_equity - previous_equity
                daily_return_pct = (daily_pnl / previous_equity) * 100.0
            series.append(
                {
                    "date": point_date,
                    "equity": round(float(current_equity), 6),
                    "daily_return_pct": round(float(daily_return_pct), 6),
                    "daily_pnl": round(float(daily_pnl), 6),
                }
            )
            previous_equity = current_equity
        return series

    @staticmethod
    def _build_daily_return_series_from_audit_rows(audit_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        series: List[Dict[str, Any]] = []
        for row in audit_rows or []:
            point_date = row.get("date")
            total_portfolio_value = _safe_float(row.get("total_portfolio_value"))
            if not point_date or total_portfolio_value is None:
                continue
            series.append(
                {
                    "date": point_date,
                    "equity": round(float(total_portfolio_value), 6),
                    "daily_return_pct": round(float(_safe_float(row.get("daily_return")) or _safe_float(row.get("daily_return_pct")) or 0.0), 6),
                    "daily_pnl": round(float(_safe_float(row.get("daily_pnl")) or 0.0), 6),
                }
            )
        return series

    @classmethod
    def _build_replay_series_from_audit_rows(cls, audit_rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        return {
            "daily_return_series": cls._build_daily_return_series_from_audit_rows(list(audit_rows or [])),
            "exposure_curve": cls._build_exposure_curve_from_audit_rows(list(audit_rows or [])),
        }

    @staticmethod
    def _build_audit_rows(
        *,
        equity_curve: List[Dict[str, Any]],
        benchmark_curve: List[Dict[str, Any]],
        buy_and_hold_curve: List[Dict[str, Any]],
        benchmark_summary: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        return [
            row.to_dict()
            for row in RuleBacktestEngine._build_audit_ledger(
                equity_curve=equity_curve,
                benchmark_curve=benchmark_curve,
                buy_and_hold_curve=buy_and_hold_curve,
                benchmark_summary=benchmark_summary,
            )
        ]

    @staticmethod
    def _build_benchmark_comparison_metrics(
        *,
        total_return_pct: Any,
        benchmark_summary: Dict[str, Any],
        buy_and_hold_summary: Dict[str, Any],
    ) -> Dict[str, Optional[float]]:
        total_return = _safe_float(total_return_pct)
        benchmark_resolved_mode = str(benchmark_summary.get("resolved_mode") or "").strip().lower()
        benchmark_return_pct = (
            None
            if benchmark_resolved_mode in {"", BENCHMARK_MODE_NONE}
            else _safe_float(benchmark_summary.get("return_pct"))
        )
        buy_and_hold_return_pct = _safe_float(buy_and_hold_summary.get("return_pct"))
        return {
            "benchmark_return_pct": benchmark_return_pct,
            "excess_return_vs_benchmark_pct": (
                round(float(total_return) - float(benchmark_return_pct), 4)
                if total_return is not None and benchmark_return_pct is not None
                else None
            ),
            "buy_and_hold_return_pct": buy_and_hold_return_pct,
            "excess_return_vs_buy_and_hold_pct": (
                round(float(total_return) - float(buy_and_hold_return_pct), 4)
                if total_return is not None and buy_and_hold_return_pct is not None
                else None
            ),
        }

    @classmethod
    def _build_benchmark_comparison_payload(
        cls,
        *,
        total_return_pct: Any,
        benchmark_curve: List[Dict[str, Any]],
        benchmark_summary: Dict[str, Any],
        buy_and_hold_curve: List[Dict[str, Any]],
        buy_and_hold_summary: Dict[str, Any],
        source: str = "stored",
        completeness: str = "complete",
        missing_sections: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return {
            "version": "v1",
            "source": str(source or "stored"),
            "completeness": str(completeness or "unknown"),
            "missing_sections": [str(item) for item in (missing_sections or []) if str(item or "").strip()],
            "benchmark_curve": list(benchmark_curve or []),
            "benchmark_summary": dict(benchmark_summary or {}),
            "buy_and_hold_curve": list(buy_and_hold_curve or []),
            "buy_and_hold_summary": dict(buy_and_hold_summary or {}),
            "metrics": cls._build_benchmark_comparison_metrics(
                total_return_pct=total_return_pct,
                benchmark_summary=dict(benchmark_summary or {}),
                buy_and_hold_summary=dict(buy_and_hold_summary or {}),
            ),
        }

    @classmethod
    def _resolve_benchmark_comparison_payload(
        cls,
        *,
        visualization: Dict[str, Any],
        metrics: Dict[str, Any],
    ) -> tuple[Dict[str, Any], str, str, List[str]]:
        stored_payload = visualization.get("comparison")
        legacy_benchmark_curve = list(visualization.get("benchmark_curve") or [])
        legacy_benchmark_summary = dict(visualization.get("benchmark_summary") or {})
        legacy_buy_and_hold_curve = list(visualization.get("buy_and_hold_curve") or [])
        legacy_buy_and_hold_summary = dict(visualization.get("buy_and_hold_summary") or {})

        if isinstance(stored_payload, dict):
            missing_sections: List[str] = []

            stored_benchmark_curve = stored_payload.get("benchmark_curve")
            if isinstance(stored_benchmark_curve, list):
                benchmark_curve = list(stored_benchmark_curve)
            else:
                benchmark_curve = list(legacy_benchmark_curve)
                if stored_benchmark_curve is None:
                    missing_sections.append("benchmark_curve")

            stored_benchmark_summary = stored_payload.get("benchmark_summary")
            if isinstance(stored_benchmark_summary, dict) and stored_benchmark_summary:
                benchmark_summary = dict(stored_benchmark_summary)
            else:
                benchmark_summary = dict(legacy_benchmark_summary)
                if stored_benchmark_summary is None:
                    missing_sections.append("benchmark_summary")

            stored_buy_and_hold_curve = stored_payload.get("buy_and_hold_curve")
            if isinstance(stored_buy_and_hold_curve, list):
                buy_and_hold_curve = list(stored_buy_and_hold_curve)
            else:
                buy_and_hold_curve = list(legacy_buy_and_hold_curve)
                if stored_buy_and_hold_curve is None:
                    missing_sections.append("buy_and_hold_curve")

            stored_buy_and_hold_summary = stored_payload.get("buy_and_hold_summary")
            if isinstance(stored_buy_and_hold_summary, dict) and stored_buy_and_hold_summary:
                buy_and_hold_summary = dict(stored_buy_and_hold_summary)
            else:
                buy_and_hold_summary = dict(legacy_buy_and_hold_summary)
                if stored_buy_and_hold_summary is None:
                    missing_sections.append("buy_and_hold_summary")

            derived_metrics = cls._build_benchmark_comparison_metrics(
                total_return_pct=metrics.get("total_return_pct"),
                benchmark_summary=benchmark_summary,
                buy_and_hold_summary=buy_and_hold_summary,
            )
            stored_metrics_raw = stored_payload.get("metrics")
            stored_metrics = dict(stored_metrics_raw or {}) if isinstance(stored_metrics_raw, dict) else {}
            if not isinstance(stored_metrics_raw, dict):
                missing_sections.append("metrics")

            resolved_payload = {
                "version": str(stored_payload.get("version") or "v1"),
                "source": (
                    "summary.visualization.comparison+repaired_sections"
                    if missing_sections
                    else "summary.visualization.comparison"
                ),
                "completeness": "stored_partial_repaired" if missing_sections else "complete",
                "missing_sections": missing_sections,
                "benchmark_curve": benchmark_curve,
                "benchmark_summary": benchmark_summary,
                "buy_and_hold_curve": buy_and_hold_curve,
                "buy_and_hold_summary": buy_and_hold_summary,
                "metrics": {
                    **derived_metrics,
                    **{key: stored_metrics.get(key) for key in derived_metrics.keys() if key in stored_metrics},
                },
            }
            return (
                resolved_payload,
                str(resolved_payload.get("source") or "summary.visualization.comparison"),
                str(resolved_payload.get("completeness") or "unknown"),
                list(resolved_payload.get("missing_sections") or []),
            )

        if (
            legacy_benchmark_curve
            or legacy_benchmark_summary
            or legacy_buy_and_hold_curve
            or legacy_buy_and_hold_summary
        ):
            missing_sections: List[str] = []
            if not legacy_benchmark_summary:
                missing_sections.append("benchmark_summary")
            if not legacy_buy_and_hold_summary:
                missing_sections.append("buy_and_hold_summary")
            resolved_payload = cls._build_benchmark_comparison_payload(
                total_return_pct=metrics.get("total_return_pct"),
                benchmark_curve=legacy_benchmark_curve,
                benchmark_summary=legacy_benchmark_summary,
                buy_and_hold_curve=legacy_buy_and_hold_curve,
                buy_and_hold_summary=legacy_buy_and_hold_summary,
                source="derived_from_stored_visualization_components",
                completeness="legacy_partial" if missing_sections else "legacy_complete",
                missing_sections=missing_sections,
            )
            return (
                resolved_payload,
                str(resolved_payload.get("source") or "derived_from_stored_visualization_components"),
                str(resolved_payload.get("completeness") or "unknown"),
                list(resolved_payload.get("missing_sections") or []),
            )

        unavailable_payload = cls._build_benchmark_comparison_payload(
            total_return_pct=metrics.get("total_return_pct"),
            benchmark_curve=[],
            benchmark_summary={},
            buy_and_hold_curve=[],
            buy_and_hold_summary={},
            source="unavailable",
            completeness="unavailable",
            missing_sections=["comparison", "benchmark_summary", "buy_and_hold_summary"],
        )
        return (
            unavailable_payload,
            "unavailable",
            "unavailable",
            list(unavailable_payload.get("missing_sections") or []),
        )

    @staticmethod
    def _resolve_run_metrics_payload(
        *,
        row: RuleBacktestRun,
        summary: Dict[str, Any],
    ) -> tuple[Dict[str, Any], str, str, List[str]]:
        stored_metrics_raw = summary.get("metrics")
        stored_metrics = dict(stored_metrics_raw or {}) if isinstance(stored_metrics_raw, dict) else {}
        metric_fallbacks = {
            "trade_count": row.trade_count,
            "win_count": row.win_count,
            "loss_count": row.loss_count,
            "total_return_pct": row.total_return_pct,
            "annualized_return_pct": None,
            "win_rate_pct": row.win_rate_pct,
            "avg_trade_return_pct": row.avg_trade_return_pct,
            "max_drawdown_pct": row.max_drawdown_pct,
            "avg_holding_days": row.avg_holding_days,
            "avg_holding_bars": row.avg_holding_days,
            "avg_holding_calendar_days": None,
            "final_equity": row.final_equity,
            "period_start": None,
            "period_end": None,
        }

        resolved: Dict[str, Any] = {}
        repaired_fields: List[str] = []
        missing_fields: List[str] = []
        for key, fallback in metric_fallbacks.items():
            stored_value = stored_metrics.get(key)
            if key in stored_metrics and stored_value is not None:
                resolved[key] = stored_value
                continue
            if fallback is not None:
                resolved[key] = fallback
                if stored_metrics:
                    repaired_fields.append(key)
                continue
            resolved[key] = None
            missing_fields.append(key)

        if stored_metrics:
            if repaired_fields or missing_fields:
                return (
                    resolved,
                    "summary.metrics+row_columns_fallback",
                    "stored_partial_repaired",
                    sorted(set(repaired_fields + missing_fields)),
                )
            return resolved, "summary.metrics", "complete", []

        row_fields_present = any(value is not None for value in metric_fallbacks.values())
        if row_fields_present:
            return resolved, "row_columns_fallback", "legacy_row_columns", missing_fields
        return resolved, "unavailable", "unavailable", sorted(set(metric_fallbacks.keys()))

    def _build_legacy_replay_visualization_payload(
        self,
        *,
        equity_curve: List[Dict[str, Any]],
        trade_rows: List[Dict[str, Any]],
        benchmark_curve: List[Dict[str, Any]],
        buy_and_hold_curve: List[Dict[str, Any]],
        benchmark_summary: Dict[str, Any],
    ) -> Dict[str, Any]:
        audit_rows = self._build_audit_rows(
            equity_curve=list(equity_curve or []),
            benchmark_curve=list(benchmark_curve or []),
            buy_and_hold_curve=list(buy_and_hold_curve or []),
            benchmark_summary=dict(benchmark_summary or {}),
        )
        if audit_rows:
            replay_series = self._build_replay_series_from_audit_rows(audit_rows)
            daily_return_series = list(replay_series.get("daily_return_series") or [])
            exposure_curve = list(replay_series.get("exposure_curve") or [])
        else:
            daily_return_series = self._build_daily_return_series(list(equity_curve or []))
            exposure_curve = self._build_exposure_curve(list(equity_curve or []), list(trade_rows or []))
        return {
            "audit_rows": audit_rows,
            "daily_return_series": daily_return_series,
            "exposure_curve": exposure_curve,
        }

    def _resolve_replay_visualization_payload(
        self,
        *,
        include_trades: bool,
        visualization: Dict[str, Any],
        metrics: Dict[str, Any],
        equity_curve: List[Dict[str, Any]],
        trade_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        (
            comparison,
            comparison_source,
            comparison_completeness,
            comparison_missing_sections,
        ) = self._resolve_benchmark_comparison_payload(
            visualization=visualization,
            metrics=metrics,
        )
        benchmark_curve = list(comparison.get("benchmark_curve") or []) if include_trades else []
        benchmark_summary = dict(comparison.get("benchmark_summary") or {})
        buy_and_hold_curve = list(comparison.get("buy_and_hold_curve") or []) if include_trades else []
        buy_and_hold_summary = dict(comparison.get("buy_and_hold_summary") or {})
        if not include_trades:
            return {
                "comparison": comparison,
                "benchmark_curve": benchmark_curve,
                "benchmark_summary": benchmark_summary,
                "buy_and_hold_curve": buy_and_hold_curve,
                "buy_and_hold_summary": buy_and_hold_summary,
                "comparison_source": comparison_source,
                "comparison_completeness": comparison_completeness,
                "comparison_missing_sections": comparison_missing_sections,
                "replay_payload_source": "omitted_without_detail_read",
                "replay_payload_completeness": "omitted",
                "replay_payload_missing_sections": [],
                "audit_rows_source": "omitted_without_detail_read",
                "daily_return_series_source": "omitted_without_detail_read",
                "exposure_curve_source": "omitted_without_detail_read",
                "audit_rows": [],
                "daily_return_series": [],
                "exposure_curve": [],
            }

        stored_audit_rows = visualization.get("audit_rows")
        stored_daily_return_series = visualization.get("daily_return_series")
        stored_exposure_curve = visualization.get("exposure_curve")
        has_stored_audit_rows = isinstance(stored_audit_rows, list)
        has_stored_daily_return_series = isinstance(stored_daily_return_series, list)
        has_stored_exposure_curve = isinstance(stored_exposure_curve, list)
        has_nonempty_stored_audit_rows = has_stored_audit_rows and bool(stored_audit_rows)
        has_nonempty_stored_daily_return_series = (
            has_stored_daily_return_series and bool(stored_daily_return_series)
        )
        has_nonempty_stored_exposure_curve = has_stored_exposure_curve and bool(stored_exposure_curve)

        audit_rows = list(stored_audit_rows or []) if has_nonempty_stored_audit_rows else []
        daily_return_series = (
            list(stored_daily_return_series or [])
            if has_nonempty_stored_daily_return_series
            else []
        )
        exposure_curve = (
            list(stored_exposure_curve or [])
            if has_nonempty_stored_exposure_curve
            else []
        )

        if has_nonempty_stored_audit_rows:
            replay_series = self._build_replay_series_from_audit_rows(audit_rows)
            missing_sections: List[str] = []
            if not has_nonempty_stored_daily_return_series:
                daily_return_series = list(replay_series.get("daily_return_series") or [])
                missing_sections.append("daily_return_series")
            if not has_nonempty_stored_exposure_curve:
                exposure_curve = list(replay_series.get("exposure_curve") or [])
                missing_sections.append("exposure_curve")
            replay_payload_source = (
                "summary.visualization.audit_rows+repaired_sections"
                if missing_sections
                else "summary.visualization.audit_rows"
            )
            replay_payload_completeness = "stored_partial_repaired" if missing_sections else "complete"
            audit_rows_source = "summary.visualization.audit_rows"
            daily_return_series_source = (
                "summary.visualization.daily_return_series"
                if has_nonempty_stored_daily_return_series
                else "rebuilt_from_summary.visualization.audit_rows"
            )
            exposure_curve_source = (
                "summary.visualization.exposure_curve"
                if has_nonempty_stored_exposure_curve
                else "rebuilt_from_summary.visualization.audit_rows"
            )
        else:
            legacy_payload = self._build_legacy_replay_visualization_payload(
                equity_curve=equity_curve,
                trade_rows=trade_rows,
                benchmark_curve=benchmark_curve,
                buy_and_hold_curve=buy_and_hold_curve,
                benchmark_summary=benchmark_summary,
            )
            derived_audit_rows = list(legacy_payload.get("audit_rows") or [])
            derived_daily_return_series = list(legacy_payload.get("daily_return_series") or [])
            derived_exposure_curve = list(legacy_payload.get("exposure_curve") or [])
            if derived_audit_rows:
                audit_rows = derived_audit_rows
            if not has_nonempty_stored_daily_return_series:
                daily_return_series = derived_daily_return_series
            if not has_nonempty_stored_exposure_curve:
                exposure_curve = derived_exposure_curve

            if audit_rows or daily_return_series or exposure_curve:
                missing_sections = []
                if not audit_rows:
                    missing_sections.append("audit_rows")
                if not daily_return_series:
                    missing_sections.append("daily_return_series")
                if not exposure_curve:
                    missing_sections.append("exposure_curve")

                if has_nonempty_stored_daily_return_series or has_nonempty_stored_exposure_curve:
                    replay_payload_source = "stored_replay_sections+derived_audit_rows"
                    replay_payload_completeness = "stored_partial_repaired"
                else:
                    replay_payload_source = "derived_from_stored_run_artifacts"
                    replay_payload_completeness = "legacy_partial" if missing_sections else "legacy_complete"

                audit_rows_source = (
                    "derived_from_stored_run_artifacts"
                    if audit_rows
                    else "unavailable"
                )
                daily_return_series_source = (
                    "summary.visualization.daily_return_series"
                    if has_nonempty_stored_daily_return_series
                    else (
                        "derived_from_stored_run_artifacts"
                        if daily_return_series
                        else "unavailable"
                    )
                )
                exposure_curve_source = (
                    "summary.visualization.exposure_curve"
                    if has_nonempty_stored_exposure_curve
                    else (
                        "derived_from_stored_run_artifacts"
                        if exposure_curve
                        else "unavailable"
                    )
                )
            else:
                missing_sections = ["audit_rows", "daily_return_series", "exposure_curve"]
                replay_payload_source = "unavailable"
                replay_payload_completeness = "unavailable"
                audit_rows_source = "unavailable"
                daily_return_series_source = "unavailable"
                exposure_curve_source = "unavailable"

        return {
            "comparison": comparison,
            "benchmark_curve": benchmark_curve,
            "benchmark_summary": benchmark_summary,
            "buy_and_hold_curve": buy_and_hold_curve,
            "buy_and_hold_summary": buy_and_hold_summary,
            "comparison_source": comparison_source,
            "comparison_completeness": comparison_completeness,
            "comparison_missing_sections": comparison_missing_sections,
            "replay_payload_source": replay_payload_source,
            "replay_payload_completeness": replay_payload_completeness,
            "replay_payload_missing_sections": missing_sections,
            "audit_rows_source": audit_rows_source,
            "daily_return_series_source": daily_return_series_source,
            "exposure_curve_source": exposure_curve_source,
            "audit_rows": audit_rows,
            "daily_return_series": daily_return_series,
            "exposure_curve": exposure_curve,
        }

    @staticmethod
    def _build_result_authority_payload(
        *,
        include_trades: bool,
        row: RuleBacktestRun,
        summary: Dict[str, Any],
        summary_source: str,
        summary_completeness: str,
        summary_missing_fields: List[str],
        parsed_strategy_source: str,
        parsed_strategy_completeness: str,
        parsed_strategy_missing_fields: List[str],
        comparison_source: str,
        comparison_completeness: str,
        comparison_missing_sections: List[str],
        replay_payload_source: str,
        replay_payload_completeness: str,
        replay_payload_missing_sections: List[str],
        audit_rows_source: str,
        daily_return_series_source: str,
        exposure_curve_source: str,
        metrics_source: str,
        metrics_completeness: str,
        metrics_missing_fields: List[str],
        execution_model_source: str,
        execution_model_completeness: str,
        execution_model_missing_fields: List[str],
        execution_assumptions_source: str,
        execution_assumptions_snapshot_completeness: str,
        execution_assumptions_snapshot_missing_keys: List[str],
        trade_rows_source: str,
        trade_rows_completeness: str,
        trade_rows_missing_fields: List[str],
        equity_curve_source: str,
        equity_curve_completeness: str,
        equity_curve_missing_fields: List[str],
        execution_trace_source: str,
        execution_trace_completeness: str,
        execution_trace_missing_fields: List[str],
    ) -> Dict[str, Any]:
        domains = {
            "summary": RuleBacktestService._build_result_authority_domain_entry(
                source=summary_source,
                completeness=summary_completeness,
                missing=summary_missing_fields,
                missing_kind="fields",
            ),
            "parsed_strategy": RuleBacktestService._build_result_authority_domain_entry(
                source=parsed_strategy_source,
                completeness=parsed_strategy_completeness,
                missing=parsed_strategy_missing_fields,
                missing_kind="fields",
            ),
            "metrics": RuleBacktestService._build_result_authority_domain_entry(
                source=metrics_source,
                completeness=metrics_completeness,
                missing=metrics_missing_fields,
                missing_kind="fields",
            ),
            "execution_model": RuleBacktestService._build_result_authority_domain_entry(
                source=execution_model_source,
                completeness=execution_model_completeness,
                missing=execution_model_missing_fields,
                missing_kind="fields",
            ),
            "execution_assumptions_snapshot": RuleBacktestService._build_result_authority_domain_entry(
                source=execution_assumptions_source,
                completeness=execution_assumptions_snapshot_completeness,
                missing=execution_assumptions_snapshot_missing_keys,
                missing_kind="keys",
            ),
            "comparison": RuleBacktestService._build_result_authority_domain_entry(
                source=comparison_source,
                completeness=comparison_completeness,
                missing=comparison_missing_sections,
                missing_kind="sections",
            ),
            "replay_payload": RuleBacktestService._build_result_authority_domain_entry(
                source=replay_payload_source,
                completeness=replay_payload_completeness,
                missing=replay_payload_missing_sections,
                missing_kind="sections",
            ),
            "audit_rows": RuleBacktestService._build_result_authority_domain_entry(
                source=audit_rows_source,
                missing_kind="rows",
            ),
            "daily_return_series": RuleBacktestService._build_result_authority_domain_entry(
                source=daily_return_series_source,
                missing_kind="rows",
            ),
            "exposure_curve": RuleBacktestService._build_result_authority_domain_entry(
                source=exposure_curve_source,
                missing_kind="rows",
            ),
            "trade_rows": RuleBacktestService._build_result_authority_domain_entry(
                source=trade_rows_source,
                completeness=trade_rows_completeness,
                missing=trade_rows_missing_fields,
                missing_kind="fields",
            ),
            "equity_curve": RuleBacktestService._build_result_authority_domain_entry(
                source=equity_curve_source,
                completeness=equity_curve_completeness,
                missing=equity_curve_missing_fields,
                missing_kind="fields",
            ),
            "execution_trace": RuleBacktestService._build_result_authority_domain_entry(
                source=execution_trace_source,
                completeness=execution_trace_completeness,
                missing=execution_trace_missing_fields,
                missing_kind="fields",
            ),
        }

        return {
            "contract_version": "v1",
            "read_mode": "stored_first",
            "summary_source": summary_source,
            "summary_completeness": summary_completeness,
            "summary_missing_fields": list(summary_missing_fields or []),
            "parsed_strategy_source": parsed_strategy_source,
            "parsed_strategy_completeness": parsed_strategy_completeness,
            "parsed_strategy_missing_fields": list(parsed_strategy_missing_fields or []),
            "metrics_source": metrics_source,
            "metrics_completeness": metrics_completeness,
            "metrics_missing_fields": list(metrics_missing_fields or []),
            "execution_model_source": execution_model_source,
            "execution_model_completeness": execution_model_completeness,
            "execution_model_missing_fields": list(execution_model_missing_fields or []),
            "execution_assumptions_source": execution_assumptions_source,
            "execution_assumptions_snapshot_completeness": execution_assumptions_snapshot_completeness,
            "execution_assumptions_snapshot_missing_keys": list(execution_assumptions_snapshot_missing_keys or []),
            "comparison_source": comparison_source,
            "comparison_completeness": comparison_completeness,
            "comparison_missing_sections": list(comparison_missing_sections or []),
            "replay_payload_source": replay_payload_source,
            "replay_payload_completeness": replay_payload_completeness,
            "replay_payload_missing_sections": list(replay_payload_missing_sections or []),
            "audit_rows_source": audit_rows_source,
            "daily_return_series_source": daily_return_series_source,
            "exposure_curve_source": exposure_curve_source,
            "trade_rows_source": trade_rows_source,
            "trade_rows_completeness": trade_rows_completeness,
            "trade_rows_missing_fields": list(trade_rows_missing_fields or []),
            "equity_curve_source": equity_curve_source,
            "equity_curve_completeness": equity_curve_completeness,
            "equity_curve_missing_fields": list(equity_curve_missing_fields or []),
            "execution_trace_source": execution_trace_source,
            "execution_trace_completeness": execution_trace_completeness,
            "execution_trace_missing_fields": list(execution_trace_missing_fields or []),
            "domains": domains,
        }

    @staticmethod
    def _build_result_authority_domain_entry(
        *,
        source: str,
        completeness: Optional[str] = None,
        missing: Optional[List[str]] = None,
        missing_kind: str = "fields",
    ) -> Dict[str, Any]:
        normalized_source = str(source or "unknown")
        normalized_completeness = str(
            completeness
            or RuleBacktestService._infer_result_authority_completeness_from_source(normalized_source)
        )
        return {
            "source": normalized_source,
            "completeness": normalized_completeness,
            "state": RuleBacktestService._infer_result_authority_state(
                source=normalized_source,
                completeness=normalized_completeness,
            ),
            "missing": list(missing or []),
            "missing_kind": str(missing_kind or "fields"),
        }

    @staticmethod
    def _infer_result_authority_completeness_from_source(source: str) -> str:
        normalized_source = str(source or "").strip().lower()
        if normalized_source == "omitted_without_detail_read":
            return "omitted"
        if normalized_source == "unavailable":
            return "unavailable"
        if normalized_source == "empty":
            return "empty"
        if normalized_source in {"", "unknown"}:
            return "unknown"
        return "complete"

    @staticmethod
    def _infer_result_authority_state(*, source: str, completeness: str) -> str:
        normalized_source = str(source or "").strip().lower()
        normalized_completeness = str(completeness or "").strip().lower()
        if normalized_source == "omitted_without_detail_read" or normalized_completeness == "omitted":
            return "omitted"
        if normalized_source == "unavailable" or normalized_completeness == "unavailable":
            return "unavailable"
        if normalized_source == "empty" or normalized_completeness == "empty":
            return "empty"
        if normalized_completeness == "unknown":
            return "unknown"
        return "available"

    @staticmethod
    def _build_execution_trace_assumptions(parsed_strategy: Optional[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], str]:
        assumptions = list((parsed_strategy or {}).get("assumptions") or [])
        fragments: List[str] = []
        for item in assumptions:
            key = str(item.get("label") or item.get("key") or "").strip()
            value = item.get("value")
            reason = str(item.get("reason") or item.get("message") or "").strip()
            fragment = key or "assumption"
            if value not in (None, ""):
                fragment = f"{fragment}={value}"
            if reason:
                fragment = f"{fragment}（{reason}）"
            fragments.append(fragment)
        if not fragments:
            return assumptions, "默认/推断：无额外默认值"
        return assumptions, f"默认/推断：{'；'.join(fragments)}"

    @staticmethod
    def _derive_execution_trace_event_type(row: Dict[str, Any]) -> str:
        action = str(row.get("action") or row.get("executed_action") or "").strip().lower()
        notes = str(row.get("notes") or "").strip().lower()
        signal_summary = str(row.get("signal_summary") or "").strip()
        if action in {"buy", "accumulate"}:
            return "buy"
        if action in {"sell", "forced_close"}:
            return "sell"
        if "skip" in action or "skip" in notes or "现金不足" in signal_summary:
            return "skip"
        return "hold"

    @staticmethod
    def _format_execution_trace_action(event_type: str) -> str:
        return {
            "buy": "买",
            "sell": "卖",
            "skip": "跳过",
            "hold": "持有",
        }.get(str(event_type or ""), str(event_type or ""))

    @staticmethod
    def _build_execution_trace_fallback_note(
        *,
        benchmark_summary: Optional[Dict[str, Any]],
        trace_rebuilt: bool,
    ) -> str:
        notes: List[str] = []
        benchmark_payload = dict(benchmark_summary or {})
        unavailable_reason = str(benchmark_payload.get("unavailable_reason") or "").strip()
        if trace_rebuilt:
            notes.append("历史运行回补trace")
        if benchmark_payload.get("fallback_used"):
            notes.append(unavailable_reason or "基准不可用，已回退到当前标的买入持有")
        if not notes:
            notes.append("标准执行路径")
        return "；".join(notes)

    def _build_execution_trace_payload(
        self,
        *,
        parsed_strategy: Optional[Dict[str, Any]],
        audit_rows: List[Dict[str, Any]],
        execution_model: Dict[str, Any],
        execution_assumptions: Dict[str, Any],
        benchmark_summary: Optional[Dict[str, Any]],
        source: str,
        trace_rebuilt: bool,
        completeness: str = "complete",
        missing_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        assumptions, assumptions_summary = self._build_execution_trace_assumptions(parsed_strategy)
        fallback_note = self._build_execution_trace_fallback_note(
            benchmark_summary=benchmark_summary,
            trace_rebuilt=trace_rebuilt,
        )
        rows: List[Dict[str, Any]] = []
        for audit_row in audit_rows or []:
            event_type = self._derive_execution_trace_event_type(audit_row)
            rows.append(
                {
                    "date": audit_row.get("date"),
                    "symbol_close": audit_row.get("symbol_close"),
                    "benchmark_close": audit_row.get("benchmark_close"),
                    "signal_summary": audit_row.get("signal_summary"),
                    "event_type": event_type,
                    "action": event_type,
                    "action_display": self._format_execution_trace_action(event_type),
                    "fill_price": audit_row.get("fill_price"),
                    "shares": audit_row.get("shares"),
                    "cash": audit_row.get("cash"),
                    "holdings_value": audit_row.get("holdings_value"),
                    "total_portfolio_value": audit_row.get("total_portfolio_value"),
                    "daily_pnl": audit_row.get("daily_pnl"),
                    "daily_return": audit_row.get("daily_return"),
                    "cumulative_return": audit_row.get("cumulative_return"),
                    "benchmark_cumulative_return": audit_row.get("benchmark_cumulative_return"),
                    "buy_hold_cumulative_return": audit_row.get("buy_hold_cumulative_return"),
                    "position": audit_row.get("position"),
                    "fees": audit_row.get("fees"),
                    "slippage": audit_row.get("slippage"),
                    "notes": audit_row.get("notes"),
                    "unavailable_reason": audit_row.get("unavailable_reason"),
                    "assumptions_defaults": assumptions_summary,
                    "fallback": fallback_note,
                }
            )
        return {
            "version": "v1",
            "source": str(source or "stored_execution_trace"),
            "completeness": str(completeness or "unknown"),
            "missing_fields": [str(item) for item in (missing_fields or []) if str(item or "").strip()],
            "rows": rows,
            "execution_model": dict(execution_model or {}),
            "execution_assumptions": dict(execution_assumptions or {}),
            "assumptions_defaults": {
                "items": assumptions,
                "summary_text": assumptions_summary,
            },
            "fallback": {
                "run_fallback": bool(dict(benchmark_summary or {}).get("fallback_used")),
                "trace_rebuilt": bool(trace_rebuilt),
                "note": fallback_note,
            },
        }

    @staticmethod
    def _normalize_execution_trace_source(source: Any) -> str:
        normalized = str(source or "").strip()
        if normalized in {"", "stored_execution_trace"}:
            return "summary.execution_trace"
        return normalized

    @staticmethod
    def _build_execution_trace_unavailable_note(*, stored_trace_present: bool) -> str:
        if stored_trace_present:
            return "历史运行缺少可用 execution trace rows，且无可回补 audit rows。"
        return "历史运行缺少已持久化 execution trace，且无可回补 audit rows。"

    def _resolve_execution_trace_payload(
        self,
        *,
        include_trades: bool,
        summary: Dict[str, Any],
        parsed_strategy: Optional[Dict[str, Any]],
        stored_audit_rows: List[Dict[str, Any]],
        execution_model: Dict[str, Any],
        execution_assumptions: Dict[str, Any],
        benchmark_summary: Optional[Dict[str, Any]],
    ) -> tuple[Optional[Dict[str, Any]], str, str, List[str]]:
        if not include_trades:
            return None, "omitted_without_detail_read", "omitted", []

        default_trace = self._build_execution_trace_payload(
            parsed_strategy=parsed_strategy or {},
            audit_rows=[],
            execution_model=execution_model,
            execution_assumptions=execution_assumptions,
            benchmark_summary=benchmark_summary,
            source="summary.execution_trace",
            trace_rebuilt=False,
        )
        stored_trace = summary.get("execution_trace")
        if isinstance(stored_trace, dict):
            stored_rows = stored_trace.get("rows")
            if isinstance(stored_rows, list):
                missing_fields: List[str] = []
                if not isinstance(stored_trace.get("execution_model"), dict):
                    missing_fields.append("execution_model")
                if not isinstance(stored_trace.get("execution_assumptions"), dict):
                    missing_fields.append("execution_assumptions")
                if not isinstance(stored_trace.get("assumptions_defaults"), dict):
                    missing_fields.append("assumptions_defaults")
                if not isinstance(stored_trace.get("fallback"), dict):
                    missing_fields.append("fallback")

                fallback_payload = dict(stored_trace.get("fallback") or {})
                trace_rebuilt = bool(fallback_payload.get("trace_rebuilt"))
                resolved_source = self._normalize_execution_trace_source(stored_trace.get("source"))
                if missing_fields and "repaired_fields" not in resolved_source:
                    resolved_source = "summary.execution_trace+repaired_fields"
                resolved_missing_fields = [
                    str(item)
                    for item in (stored_trace.get("missing_fields") or missing_fields)
                    if str(item or "").strip()
                ]
                resolved_completeness = str(
                    stored_trace.get("completeness")
                    or ("stored_partial_repaired" if missing_fields else "complete")
                )
                if missing_fields and resolved_completeness == "complete":
                    resolved_completeness = "stored_partial_repaired"

                resolved_trace = {
                    **{
                        key: value
                        for key, value in stored_trace.items()
                        if key
                        not in {
                            "version",
                            "source",
                            "completeness",
                            "missing_fields",
                            "rows",
                            "execution_model",
                            "execution_assumptions",
                            "assumptions_defaults",
                            "fallback",
                        }
                    },
                    "version": str(stored_trace.get("version") or "v1"),
                    "source": resolved_source,
                    "completeness": resolved_completeness,
                    "missing_fields": resolved_missing_fields,
                    "rows": list(stored_rows),
                    "execution_model": dict(stored_trace.get("execution_model") or execution_model),
                    "execution_assumptions": dict(stored_trace.get("execution_assumptions") or execution_assumptions),
                    "assumptions_defaults": dict(
                        stored_trace.get("assumptions_defaults")
                        or default_trace.get("assumptions_defaults")
                        or {}
                    ),
                    "fallback": {
                        "run_fallback": bool(
                            fallback_payload.get("run_fallback")
                            or dict(benchmark_summary or {}).get("fallback_used")
                        ),
                        "trace_rebuilt": trace_rebuilt,
                        "note": str(
                            fallback_payload.get("note")
                            or self._build_execution_trace_fallback_note(
                                benchmark_summary=benchmark_summary,
                                trace_rebuilt=trace_rebuilt,
                            )
                        ),
                    },
                }
                return (
                    resolved_trace,
                    str(resolved_trace.get("source") or "summary.execution_trace"),
                    str(resolved_trace.get("completeness") or "unknown"),
                    list(resolved_trace.get("missing_fields") or []),
                )

            if stored_audit_rows:
                rebuilt_trace = self._build_execution_trace_payload(
                    parsed_strategy=parsed_strategy or {},
                    audit_rows=stored_audit_rows,
                    execution_model=execution_model,
                    execution_assumptions=execution_assumptions,
                    benchmark_summary=benchmark_summary,
                    source="rebuilt_from_stored_audit_rows",
                    trace_rebuilt=True,
                    completeness="stored_partial_repaired",
                    missing_fields=["rows"],
                )
                return (
                    rebuilt_trace,
                    str(rebuilt_trace.get("source") or "rebuilt_from_stored_audit_rows"),
                    str(rebuilt_trace.get("completeness") or "unknown"),
                    list(rebuilt_trace.get("missing_fields") or []),
                )

            unavailable_trace = self._build_execution_trace_payload(
                parsed_strategy=parsed_strategy or {},
                audit_rows=[],
                execution_model=execution_model,
                execution_assumptions=execution_assumptions,
                benchmark_summary=benchmark_summary,
                source="unavailable",
                trace_rebuilt=False,
                completeness="unavailable",
                missing_fields=["rows"],
            )
            unavailable_trace["fallback"]["note"] = self._build_execution_trace_unavailable_note(
                stored_trace_present=True,
            )
            return (
                unavailable_trace,
                "unavailable",
                "unavailable",
                list(unavailable_trace.get("missing_fields") or []),
            )

        if stored_audit_rows:
            rebuilt_trace = self._build_execution_trace_payload(
                parsed_strategy=parsed_strategy or {},
                audit_rows=stored_audit_rows,
                execution_model=execution_model,
                execution_assumptions=execution_assumptions,
                benchmark_summary=benchmark_summary,
                source="rebuilt_from_stored_audit_rows",
                trace_rebuilt=True,
                completeness="legacy_rebuilt",
                missing_fields=["stored_trace"],
            )
            return (
                rebuilt_trace,
                "rebuilt_from_stored_audit_rows",
                "legacy_rebuilt",
                list(rebuilt_trace.get("missing_fields") or []),
            )

        unavailable_trace = self._build_execution_trace_payload(
            parsed_strategy=parsed_strategy or {},
            audit_rows=[],
            execution_model=execution_model,
            execution_assumptions=execution_assumptions,
            benchmark_summary=benchmark_summary,
            source="unavailable",
            trace_rebuilt=False,
            completeness="unavailable",
            missing_fields=["stored_trace", "rows"],
        )
        unavailable_trace["fallback"]["note"] = self._build_execution_trace_unavailable_note(
            stored_trace_present=False,
        )
        return (
            unavailable_trace,
            "unavailable",
            "unavailable",
            list(unavailable_trace.get("missing_fields") or []),
        )

    @staticmethod
    def _stringify_execution_trace_value(value: Any) -> str:
        if value is None:
            return ""
        return str(value)

    def _build_execution_trace_export_rows(self, execution_trace: Dict[str, Any]) -> List[Dict[str, str]]:
        rows = list(execution_trace.get("rows") or [])
        export_rows: List[Dict[str, str]] = []
        for row in rows:
            export_row: Dict[str, str] = {}
            for key, label in TRACE_EXPORT_COLUMNS:
                value = row.get(key)
                if key == "action_display":
                    value = value or self._format_execution_trace_action(str(row.get("event_type") or row.get("action") or "hold"))
                export_row[label] = self._stringify_execution_trace_value(value)
            export_rows.append(export_row)
        return export_rows

    @staticmethod
    def _build_exposure_curve(
        equity_curve: List[Dict[str, Any]],
        trades: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        intervals: List[tuple[str, str]] = []
        for trade in trades or []:
            entry_date = trade.get("entry_date") or trade.get("entryDate")
            exit_date = trade.get("exit_date") or trade.get("exitDate")
            if entry_date and exit_date:
                intervals.append((str(entry_date), str(exit_date)))

        series: List[Dict[str, Any]] = []
        for point in equity_curve or []:
            point_date = point.get("date")
            if not point_date:
                continue
            date_str = str(point_date)
            invested = any(start <= date_str <= end for start, end in intervals)
            series.append(
                {
                    "date": date_str,
                    "exposure": 1.0 if invested else 0.0,
                    "position_state": "long" if invested else "flat",
                }
            )
        return series

    @staticmethod
    def _build_exposure_curve_from_audit_rows(audit_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        series: List[Dict[str, Any]] = []
        for row in audit_rows or []:
            point_date = row.get("date")
            if not point_date:
                continue
            exposure = _safe_float(row.get("position"))
            if exposure is None:
                exposure = _safe_float(row.get("exposure_pct"))
            if exposure is None:
                exposure = _safe_float(row.get("target_position"))
            series.append(
                {
                    "date": str(point_date),
                    "exposure": round(float(exposure or 0.0), 6),
                    "position_state": row.get("position_state") or ("long" if (exposure or 0.0) > 0 else "flat"),
                    "executed_action": row.get("action") or row.get("executed_action"),
                    "fill_price": _safe_float(row.get("fill_price")),
                }
            )
        return series

    def _update_summary_payload(
        self,
        summary: Dict[str, Any],
        *,
        request_payload: Any = _UNSET,
        parsed_strategy: Any = _UNSET,
        metrics: Any = _UNSET,
        execution_model: Any = _UNSET,
        execution_assumptions: Any = _UNSET,
        visualization: Any = _UNSET,
        execution_trace: Any = _UNSET,
        no_result_reason: Any = _UNSET,
        no_result_message: Any = _UNSET,
        ai_summary: Any = _UNSET,
        status: Optional[str] = None,
        status_message: Optional[str] = None,
        at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        payload = dict(summary or {})
        if request_payload is not _UNSET:
            payload["request"] = request_payload
        if parsed_strategy is not _UNSET:
            payload["parsed_strategy_summary"] = (
                parsed_strategy.summary if isinstance(parsed_strategy, ParsedStrategy) else parsed_strategy
            )
        if metrics is not _UNSET:
            payload["metrics"] = metrics
        if execution_model is not _UNSET:
            payload["execution_model"] = execution_model
        if execution_assumptions is not _UNSET:
            payload["execution_assumptions"] = execution_assumptions
            payload["execution_assumptions_snapshot"] = self._build_execution_assumptions_snapshot_payload(
                payload=dict(execution_assumptions or {}),
                source="summary.execution_assumptions_snapshot",
                completeness="complete",
                missing_keys=[],
            )
        if visualization is not _UNSET:
            payload["visualization"] = visualization
        if execution_trace is not _UNSET:
            payload["execution_trace"] = execution_trace
        if no_result_reason is not _UNSET:
            payload["no_result_reason"] = no_result_reason
        if no_result_message is not _UNSET:
            payload["no_result_message"] = no_result_message
        if ai_summary is not _UNSET:
            payload["ai_summary"] = ai_summary
        if status is not None:
            self._append_status_history(payload, status, status_message=status_message, at=at)
        return payload

    @staticmethod
    def _resolve_avg_holding_days(metrics: Dict[str, Any]) -> Optional[float]:
        value = metrics.get("avg_holding_days")
        if value is None:
            value = metrics.get("avg_holding_bars")
        return float(value) if value is not None else None

    def _build_ai_summary(self, parsed: ParsedStrategy, result) -> str:
        prompt = self._build_summary_prompt(
            parsed,
            result.execution_assumptions.to_dict(),
            result.metrics,
            result.trades,
            benchmark_summary=getattr(result, "benchmark_summary", None),
            buy_and_hold_summary=getattr(result, "buy_and_hold_summary", None),
        )
        adapter = self._get_llm_adapter()
        if adapter is not None:
            try:
                response = adapter.call_text(
                    [
                        {"role": "system", "content": "You summarize deterministic rule-based backtests. Do not invent trades or metrics."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,
                    max_tokens=700,
                )
                content = (response.content or "").strip()
                if content:
                    return content
            except Exception as exc:
                logger.warning("AI summary generation failed: %s", exc)

        return self._fallback_summary(parsed, result.metrics, result.trades, result)

    def _build_summary_prompt(
        self,
        parsed: ParsedStrategy,
        execution_assumptions: Dict[str, Any],
        metrics: Dict[str, Any],
        trades: List[Any],
        benchmark_summary: Optional[Dict[str, Any]] = None,
        buy_and_hold_summary: Optional[Dict[str, Any]] = None,
    ) -> str:
        sample_trades = [trade.to_dict() for trade in trades[:8]]
        payload = {
            "parsed_strategy": parsed.to_dict(),
            "execution_assumptions": execution_assumptions,
            "metrics": metrics,
            "benchmark_summary": benchmark_summary or {},
            "buy_and_hold_summary": buy_and_hold_summary or {},
            "sample_trades": sample_trades,
        }
        return (
            "请基于下面的规则回测结果，用中文输出一段简洁总结。\n"
            "要求：\n"
            "1. 只基于给定数据，不要编造。\n"
            "2. 明确说明策略在做什么、表现如何、相对所选基准是否有优势；若当前标的买入持有与所选基准不同，也要点出差异。\n"
            "3. 语气务实，避免空话。\n"
            "4. 如果交易次数很少，必须点出统计不稳定。\n"
            f"数据:\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
        )

    def _fallback_summary(self, parsed: ParsedStrategy, metrics: Dict[str, Any], trades: List[Any], result: Any) -> str:
        total_return = metrics.get("total_return_pct", 0.0) or 0.0
        benchmark_return = metrics.get("benchmark_return_pct")
        benchmark_excess = metrics.get("excess_return_vs_benchmark_pct")
        buy_hold = metrics.get("buy_and_hold_return_pct", 0.0) or 0.0
        buy_hold_excess = metrics.get("excess_return_vs_buy_and_hold_pct", 0.0) or 0.0
        win_rate = metrics.get("win_rate_pct", 0.0) or 0.0
        trade_count = metrics.get("trade_count", 0) or 0
        max_drawdown = metrics.get("max_drawdown_pct", 0.0) or 0.0
        avg_trade = metrics.get("avg_trade_return_pct", 0.0) or 0.0
        benchmark_label = str((getattr(result, "benchmark_summary", {}) or {}).get("label") or "所选基准")
        buy_hold_label = str((getattr(result, "buy_and_hold_summary", {}) or {}).get("label") or "当前标的买入持有")
        headline = (
            f"该策略以“{parsed.summary.get('entry', '--')}”作为入场，“{parsed.summary.get('exit', '--')}”作为离场。"
        )
        comparison_parts: List[str] = []
        if benchmark_return is not None:
            comparison_parts.append(
                f"{benchmark_label} {float(benchmark_return):.2f}%，相对基准超额 {float(benchmark_excess or 0.0):.2f}%"
            )
        if buy_hold is not None and (benchmark_return is None or abs(float(buy_hold) - float(benchmark_return or 0.0)) > 1e-6):
            comparison_parts.append(
                f"{buy_hold_label} {float(buy_hold):.2f}%，相对买入持有超额 {float(buy_hold_excess):.2f}%"
            )
        performance = (
            f"回测总收益 {total_return:.2f}%，{('；'.join(comparison_parts)) if comparison_parts else '未设置额外基准对比。'}"
            f" 共 {trade_count} 笔交易，胜率 {win_rate:.2f}%，平均单笔收益 {avg_trade:.2f}%，最大回撤 {max_drawdown:.2f}%。"
        )
        if trade_count == 0:
            return f"{headline} 回测窗口内没有生成交易，当前结果更像是规则过滤效果而不是完整绩效样本。建议放宽条件或扩大样本区间。"

        strengths = "优势是规则明确、交易触发可复查，适合继续做参数敏感性分析。"
        weaknesses = "弱点通常在于条件过严时样本偏少，统计稳定性不足。"
        if win_rate < 45:
            weaknesses = "弱点是胜率偏低，说明入场条件可能过严或离场条件反应过慢。"
        elif benchmark_return is not None and total_return < float(benchmark_return):
            weaknesses = f"弱点是策略跑输{benchmark_label}，说明择时规则尚未带来稳定超额收益。"
        elif buy_hold is not None and total_return < float(buy_hold):
            weaknesses = "弱点是策略跑输当前标的买入持有，说明择时规则尚未带来稳定超额收益。"
        suggestions = "下一步建议结合交易明细检查哪些触发最常导致回撤，再决定是否放宽阈值或调整均线/RSI 周期。"
        return " ".join([headline, performance, strengths, weaknesses, suggestions])

    def _get_llm_adapter(self) -> Optional[LLMToolAdapter]:
        if self._llm_adapter is not None:
            return self._llm_adapter
        try:
            self._llm_adapter = LLMToolAdapter(get_config())
        except Exception as exc:
            logger.warning("Failed to initialize LLM adapter for rule backtest: %s", exc)
            self._llm_adapter = None
        return self._llm_adapter

    @staticmethod
    def _parsed_to_dict(parsed: ParsedStrategy) -> Dict[str, Any]:
        return parsed.to_dict()

    @staticmethod
    def _is_supported_indicator_strategy_family(strategy_kind: Optional[str]) -> bool:
        return str(strategy_kind or "") in SUPPORTED_INDICATOR_STRATEGY_FAMILIES

    @staticmethod
    def _is_supported_deterministic_strategy_family(strategy_kind: Optional[str]) -> bool:
        return str(strategy_kind or "") in SUPPORTED_DETERMINISTIC_STRATEGY_FAMILIES

    def _resolve_supported_strategy_family(
        self,
        strategy_kind: Optional[str],
        family_hint: Optional[str],
    ) -> Optional[str]:
        return str(strategy_kind) if self._is_supported_deterministic_strategy_family(strategy_kind) else family_hint

    @staticmethod
    def _camelize_key(key: str) -> str:
        parts = str(key or "").split("_")
        if not parts:
            return str(key or "")
        return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])

    def _compat_mapping_value(self, payload: Optional[Dict[str, Any]], key: str) -> Any:
        if not isinstance(payload, dict):
            return None
        if key in payload:
            return payload.get(key)
        camel_key = self._camelize_key(key)
        if camel_key in payload:
            return payload.get(camel_key)
        return None

    def _normalize_compat_mapping(
        self,
        payload: Optional[Dict[str, Any]],
        *,
        fields: List[str],
        nested_fields: Optional[Dict[str, List[str]]] = None,
    ) -> Dict[str, Any]:
        normalized = dict(payload or {})
        for field in fields:
            value = self._compat_mapping_value(normalized, field)
            if value is not None:
                normalized[field] = value
        for field, child_fields in (nested_fields or {}).items():
            raw_child = self._compat_mapping_value(normalized, field)
            if isinstance(raw_child, dict):
                normalized[field] = self._normalize_compat_mapping(raw_child, fields=child_fields)
        return normalized

    def _normalize_request_setup_payload(self, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return self._normalize_compat_mapping(
            payload,
            fields=[
                "symbol",
                "start_date",
                "end_date",
                "initial_capital",
                "currency",
                "fee_bps",
                "slippage_bps",
                "order_mode",
                "quantity_per_trade",
                "amount_per_trade",
                "execution_frequency",
                "execution_timing",
                "action",
                "execution_price_basis",
                "exit_policy",
                "cash_policy",
                "indicator_family",
                "fast_period",
                "slow_period",
                "signal_period",
                "period",
                "lower_threshold",
                "upper_threshold",
                "fast_type",
                "slow_type",
            ],
        )

    def _normalize_request_strategy_spec_payload(self, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return self._normalize_compat_mapping(
            payload,
            fields=[
                "version",
                "strategy_type",
                "strategy_family",
                "symbol",
                "timeframe",
                "max_lookback",
            ],
            nested_fields={
                "date_range": ["start_date", "end_date"],
                "capital": ["initial_capital", "currency"],
                "costs": ["fee_bps", "slippage_bps"],
                "schedule": ["frequency", "timing"],
                "entry": ["side", "price_basis"],
                "exit": ["policy", "price_basis"],
                "position_behavior": ["accumulate", "cash_policy", "direction", "entry_sizing", "max_positions", "pyramiding"],
                "execution": ["frequency", "signal_timing", "fill_timing"],
                "end_behavior": ["policy", "price_basis"],
                "signal": [
                    "indicator_family",
                    "fast_period",
                    "slow_period",
                    "signal_period",
                    "period",
                    "lower_threshold",
                    "upper_threshold",
                    "fast_type",
                    "slow_type",
                    "entry_condition",
                    "exit_condition",
                ],
            },
        )

    def _dict_to_parsed_strategy(self, parsed_dict: Dict[str, Any], raw_text: str) -> ParsedStrategy:
        setup_payload = self._normalize_request_setup_payload(parsed_dict.get("setup") or {})
        strategy_spec_payload = self._normalize_request_strategy_spec_payload(
            parsed_dict.get("strategy_spec") or parsed_dict.get("strategySpec") or {}
        )
        entry = parsed_dict.get("entry") or {"type": "group", "op": "and", "rules": []}
        exit_rule = parsed_dict.get("exit") or {"type": "group", "op": "or", "rules": []}
        summary = parsed_dict.get("summary") or {}
        source_text = parsed_dict.get("source_text") or parsed_dict.get("sourceText") or raw_text
        normalized_text = parsed_dict.get("normalized_text") or parsed_dict.get("normalizedText") or raw_text
        confidence_value = parsed_dict.get("confidence")
        if confidence_value is None:
            confidence_value = parsed_dict.get("parsedConfidence")
        needs_confirmation_value = parsed_dict.get("needs_confirmation")
        if needs_confirmation_value is None:
            needs_confirmation_value = parsed_dict.get("needsConfirmation")
        max_lookback_value = parsed_dict.get("max_lookback")
        if max_lookback_value is None:
            max_lookback_value = parsed_dict.get("maxLookback")
        normalization_state = parsed_dict.get("normalization_state")
        if normalization_state is None:
            normalization_state = parsed_dict.get("normalizationState")
        executable = parsed_dict.get("executable")
        assumptions = parsed_dict.get("assumptions")
        assumption_groups = parsed_dict.get("assumption_groups")
        if assumption_groups is None:
            assumption_groups = parsed_dict.get("assumptionGroups")
        unsupported_reason = parsed_dict.get("unsupported_reason")
        if unsupported_reason is None:
            unsupported_reason = parsed_dict.get("unsupportedReason")
        unsupported_details = parsed_dict.get("unsupported_details")
        if unsupported_details is None:
            unsupported_details = parsed_dict.get("unsupportedDetails")
        unsupported_extensions = parsed_dict.get("unsupported_extensions")
        if unsupported_extensions is None:
            unsupported_extensions = parsed_dict.get("unsupportedExtensions")
        detected_strategy_family = parsed_dict.get("detected_strategy_family")
        if detected_strategy_family is None:
            detected_strategy_family = parsed_dict.get("detectedStrategyFamily")
        core_intent_summary = parsed_dict.get("core_intent_summary")
        if core_intent_summary is None:
            core_intent_summary = parsed_dict.get("coreIntentSummary")
        interpretation_confidence = parsed_dict.get("interpretation_confidence")
        if interpretation_confidence is None:
            interpretation_confidence = parsed_dict.get("interpretationConfidence")
        supported_portion_summary = parsed_dict.get("supported_portion_summary")
        if supported_portion_summary is None:
            supported_portion_summary = parsed_dict.get("supportedPortionSummary")
        rewrite_suggestions = parsed_dict.get("rewrite_suggestions")
        if rewrite_suggestions is None:
            rewrite_suggestions = parsed_dict.get("rewriteSuggestions")
        parse_warnings = parsed_dict.get("parse_warnings")
        if parse_warnings is None:
            parse_warnings = parsed_dict.get("parseWarnings")
        return ParsedStrategy(
            version=str(parsed_dict.get("version") or "v1"),
            timeframe=str(parsed_dict.get("timeframe") or "daily"),
            source_text=str(source_text),
            normalized_text=str(normalized_text),
            entry=entry,
            exit=exit_rule,
            confidence=float(confidence_value or 0.0),
            needs_confirmation=bool(needs_confirmation_value if needs_confirmation_value is not None else True),
            ambiguities=list(parsed_dict.get("ambiguities") or []),
            summary={
                "entry": str(summary.get("entry") or "买入条件：--"),
                "exit": str(summary.get("exit") or "卖出条件：--"),
                "strategy": str(summary.get("strategy") or ""),
            },
            max_lookback=int(max_lookback_value or 1),
            strategy_kind=str(
                parsed_dict.get("strategy_kind")
                or parsed_dict.get("strategyKind")
                or strategy_spec_payload.get("strategy_type")
                or "rule_conditions"
            ),
            setup=setup_payload,
            strategy_spec=strategy_spec_payload,
            executable=bool(executable) if executable is not None else False,
            normalization_state=str(normalization_state or "pending"),
            assumptions=list(assumptions or []),
            assumption_groups=list(assumption_groups or []),
            unsupported_reason=str(unsupported_reason) if unsupported_reason else None,
            unsupported_details=list(unsupported_details or []),
            unsupported_extensions=list(unsupported_extensions or []),
            detected_strategy_family=(str(detected_strategy_family) if detected_strategy_family else None),
            core_intent_summary=(str(core_intent_summary) if core_intent_summary else None),
            interpretation_confidence=float(interpretation_confidence or 0.0),
            supported_portion_summary=(str(supported_portion_summary) if supported_portion_summary else None),
            rewrite_suggestions=list(rewrite_suggestions or []),
            parse_warnings=list(parse_warnings or []),
        )

    def _normalize_parsed_strategy(
        self,
        parsed: ParsedStrategy,
        *,
        code: Optional[str] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        initial_capital: Optional[float] = None,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
    ) -> ParsedStrategy:
        if parsed.strategy_kind == "periodic_accumulation":
            normalized_spec = self._normalize_periodic_accumulation_spec(
                parsed,
                code=code,
                start_date=start_date,
                end_date=end_date,
                initial_capital=initial_capital,
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
            )
        elif self._is_supported_indicator_strategy_family(parsed.strategy_kind):
            normalized_spec = self._normalize_indicator_strategy_spec(
                parsed,
                code=code,
                start_date=start_date,
                end_date=end_date,
                initial_capital=initial_capital,
                fee_bps=fee_bps,
                slippage_bps=slippage_bps,
            )
        else:
            normalized_spec = dict(parsed.strategy_spec or {})
            normalized_spec["version"] = str(normalized_spec.get("version") or "v1")
            normalized_spec["strategy_type"] = str(normalized_spec.get("strategy_type") or parsed.strategy_kind or "rule_conditions")
            normalized_spec["timeframe"] = str(normalized_spec.get("timeframe") or parsed.timeframe)
            normalized_spec["entry_rule"] = parsed.entry
            normalized_spec["exit_rule"] = parsed.exit
            normalized_spec["max_lookback"] = int(normalized_spec.get("max_lookback") or parsed.max_lookback or 1)
            parsed.executable = self._has_meaningful_node(parsed.entry) and self._has_meaningful_node(parsed.exit)
            parsed.normalization_state = "assumed" if parsed.executable and (parsed.needs_confirmation or bool(parsed.ambiguities)) else ("ready" if parsed.executable else "unsupported")
            parsed.assumptions = list(parsed.assumptions or [])
            if not parsed.executable:
                parsed.unsupported_reason = "missing executable entry/exit rules"
            else:
                parsed.unsupported_reason = None
        self._enrich_confirmation_diagnostics(parsed)
        parsed.strategy_spec = self._finalize_strategy_spec(parsed, normalized_spec)
        return parsed

    def _finalize_strategy_spec(self, parsed: ParsedStrategy, strategy_spec: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(strategy_spec or {})
        payload["version"] = str(payload.get("version") or "v1")
        payload["strategy_family"] = str(payload.get("strategy_family") or parsed.strategy_kind)
        payload["max_lookback"] = int(payload.get("max_lookback") or parsed.max_lookback or 1)
        payload["support"] = asdict(
            _StrategySpecSupportPayload(
                executable=bool(parsed.executable),
                normalization_state=str(parsed.normalization_state or "pending"),
                requires_confirmation=bool(parsed.needs_confirmation),
                unsupported_reason=parsed.unsupported_reason,
                detected_strategy_family=parsed.detected_strategy_family,
            )
        )
        return payload

    @staticmethod
    def _periodic_strategy_spec_payload(
        *,
        symbol: str,
        timeframe: str,
        start_date: str,
        end_date: str,
        initial_capital: float,
        currency: str,
        frequency: str,
        timing: str,
        side: str,
        order_mode: str,
        quantity: Optional[float],
        amount: Optional[float],
        entry_price_basis: str,
        exit_policy: str,
        exit_price_basis: str,
        cash_policy: str,
        fee_bps: float,
        slippage_bps: float,
    ) -> Dict[str, Any]:
        return asdict(
            _PeriodicAccumulationStrategySpecPayload(
                strategy_type="periodic_accumulation",
                version="v1",
                symbol=symbol,
                timeframe=timeframe,
                date_range=_StrategySpecDateRangePayload(start_date=start_date, end_date=end_date),
                capital=_StrategySpecCapitalPayload(initial_capital=initial_capital, currency=currency),
                schedule=_PeriodicSchedulePayload(frequency=frequency, timing=timing),
                entry=_PeriodicEntryPayload(
                    side=side,
                    order=_PeriodicOrderPayload(mode=order_mode, quantity=quantity, amount=amount),
                    price_basis=entry_price_basis,
                ),
                exit=_PeriodicExitPayload(policy=exit_policy, price_basis=exit_price_basis),
                position_behavior=_PeriodicPositionBehaviorPayload(accumulate=True, cash_policy=cash_policy),
                costs=_StrategySpecCostsPayload(fee_bps=fee_bps, slippage_bps=slippage_bps),
            )
        )

    @staticmethod
    def _indicator_strategy_spec_payload(
        *,
        strategy_type: str,
        symbol: str,
        timeframe: str,
        start_date: str,
        end_date: str,
        initial_capital: float,
        currency: str,
        signal: Any,
        frequency: str,
        signal_timing: str,
        fill_timing: str,
        direction: str,
        entry_sizing: str,
        max_positions: int,
        pyramiding: bool,
        fee_bps: float,
        slippage_bps: float,
        end_policy: str,
        end_price_basis: str,
    ) -> Dict[str, Any]:
        return asdict(
            _IndicatorStrategySpecPayload(
                strategy_type=strategy_type,
                version="v1",
                symbol=symbol,
                timeframe=timeframe,
                date_range=_StrategySpecDateRangePayload(start_date=start_date, end_date=end_date),
                capital=_StrategySpecCapitalPayload(initial_capital=initial_capital, currency=currency),
                signal=signal,
                execution=_IndicatorExecutionPayload(
                    frequency=frequency,
                    signal_timing=signal_timing,
                    fill_timing=fill_timing,
                ),
                position_behavior=_IndicatorPositionBehaviorPayload(
                    direction=direction,
                    entry_sizing=entry_sizing,
                    max_positions=max_positions,
                    pyramiding=pyramiding,
                ),
                costs=_StrategySpecCostsPayload(fee_bps=fee_bps, slippage_bps=slippage_bps),
                end_behavior=_IndicatorEndBehaviorPayload(policy=end_policy, price_basis=end_price_basis),
            )
        )

    def _normalize_periodic_accumulation_spec(
        self,
        parsed: ParsedStrategy,
        *,
        code: Optional[str] = None,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        initial_capital: Optional[float] = None,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
    ) -> Dict[str, Any]:
        setup = dict(parsed.setup or {})
        existing_spec = dict(parsed.strategy_spec or {})

        def spec_value(*path: str) -> Any:
            return self._nested_value(existing_spec, *path)

        normalized_start_date, normalized_end_date = self._normalize_date_range(
            start_date=self._first_defined(start_date, spec_value("date_range", "start_date"), setup.get("start_date")),
            end_date=self._first_defined(end_date, spec_value("date_range", "end_date"), setup.get("end_date")),
        )
        symbol = str(self._first_defined(code, spec_value("symbol"), setup.get("symbol"), "")).strip().upper()
        if not symbol:
            raise ValueError("periodic accumulation requires a single symbol")

        order_mode = str(
            self._first_defined(
                spec_value("entry", "order", "mode"),
                setup.get("order_mode"),
                "fixed_shares",
            )
        ).strip().lower()
        if order_mode not in {"fixed_shares", "fixed_amount"}:
            raise ValueError(f"unsupported periodic accumulation order mode: {order_mode}")

        quantity_per_trade = _safe_float(self._first_defined(spec_value("entry", "order", "quantity"), setup.get("quantity_per_trade")))
        amount_per_trade = _safe_float(self._first_defined(spec_value("entry", "order", "amount"), setup.get("amount_per_trade")))
        if order_mode == "fixed_shares":
            if quantity_per_trade is None or quantity_per_trade <= 0:
                raise ValueError("fixed_shares periodic accumulation requires quantity_per_trade")
            amount_per_trade = None
        else:
            if amount_per_trade is None or amount_per_trade <= 0:
                raise ValueError("fixed_amount periodic accumulation requires amount_per_trade")
            quantity_per_trade = None

        resolved_initial_capital = float(
            initial_capital
            if initial_capital is not None
            else (
                _safe_float(self._first_defined(spec_value("capital", "initial_capital"), setup.get("initial_capital")))
                or 100000.0
            )
        )
        resolved_fee_bps = _safe_float(self._first_defined(spec_value("costs", "fee_bps"), setup.get("fee_bps")))
        resolved_slippage_bps = _safe_float(self._first_defined(spec_value("costs", "slippage_bps"), setup.get("slippage_bps")))
        normalized_spec = self._periodic_strategy_spec_payload(
            symbol=symbol,
            timeframe=str(parsed.timeframe or "daily"),
            start_date=normalized_start_date.isoformat(),
            end_date=normalized_end_date.isoformat(),
            initial_capital=resolved_initial_capital,
            currency=str(self._first_defined(spec_value("capital", "currency"), setup.get("currency"), "USD")),
            frequency=str(self._first_defined(spec_value("schedule", "frequency"), setup.get("execution_frequency"), "daily")),
            timing=str(self._first_defined(spec_value("schedule", "timing"), setup.get("execution_timing"), "session_open")),
            side=str(self._first_defined(spec_value("entry", "side"), setup.get("action"), "buy")),
            order_mode=order_mode,
            quantity=quantity_per_trade,
            amount=amount_per_trade,
            entry_price_basis=str(self._first_defined(spec_value("entry", "price_basis"), setup.get("execution_price_basis"), "open")),
            exit_policy=str(self._first_defined(spec_value("exit", "policy"), setup.get("exit_policy"), "close_at_end")),
            exit_price_basis=str(spec_value("exit", "price_basis") or "close"),
            cash_policy=str(
                self._first_defined(
                    spec_value("position_behavior", "cash_policy"),
                    setup.get("cash_policy"),
                    "stop_when_insufficient_cash",
                )
            ),
            fee_bps=float(resolved_fee_bps if resolved_fee_bps is not None else fee_bps),
            slippage_bps=float(resolved_slippage_bps if resolved_slippage_bps is not None else slippage_bps),
        )
        parsed.executable = True
        parsed.normalization_state = "assumed" if (parsed.needs_confirmation or bool(parsed.ambiguities)) else "ready"
        parsed.assumptions = self._build_periodic_assumptions(parsed, normalized_spec)
        parsed.assumption_groups = self._group_assumptions(parsed.assumptions)
        parsed.unsupported_reason = None
        return normalized_spec

    def _normalize_indicator_strategy_spec(
        self,
        parsed: ParsedStrategy,
        *,
        code: Optional[str],
        start_date: Optional[Any],
        end_date: Optional[Any],
        initial_capital: Optional[float],
        fee_bps: float,
        slippage_bps: float,
    ) -> Dict[str, Any]:
        setup = dict(parsed.setup or {})
        existing_spec = dict(parsed.strategy_spec or {})
        symbol = str(
            self._first_defined(code, self._nested_value(existing_spec, "symbol"), setup.get("symbol"), "")
        ).strip().upper()
        normalized_start_date, normalized_end_date = self._normalize_date_range(
            start_date=start_date or self._nested_value(existing_spec, "date_range", "start_date"),
            end_date=end_date or self._nested_value(existing_spec, "date_range", "end_date"),
        )
        if normalized_start_date is None or normalized_end_date is None:
            parsed.executable = False
            parsed.normalization_state = "unsupported"
            parsed.assumptions = []
            parsed.assumption_groups = []
            parsed.unsupported_reason = "missing_date_range"
            return {
                "strategy_type": parsed.strategy_kind,
                "symbol": symbol or None,
                "timeframe": parsed.timeframe,
            }
        if not symbol:
            parsed.executable = False
            parsed.normalization_state = "unsupported"
            parsed.assumptions = []
            parsed.assumption_groups = []
            parsed.unsupported_reason = "missing_symbol"
            return {
                "strategy_type": parsed.strategy_kind,
                "timeframe": parsed.timeframe,
            }

        resolved_initial_capital = float(
            initial_capital
            if initial_capital is not None
            else (
                _safe_float(self._first_defined(self._nested_value(existing_spec, "capital", "initial_capital"), setup.get("initial_capital")))
                or 100000.0
            )
        )
        signal_spec, summary_entry, summary_exit = self._build_indicator_signal_spec(parsed, setup, existing_spec)
        resolved_fee_bps = _safe_float(self._nested_value(existing_spec, "costs", "fee_bps"))
        resolved_slippage_bps = _safe_float(self._nested_value(existing_spec, "costs", "slippage_bps"))
        normalized_spec = self._indicator_strategy_spec_payload(
            strategy_type=parsed.strategy_kind,
            symbol=symbol,
            timeframe=str(parsed.timeframe or "daily"),
            start_date=normalized_start_date.isoformat(),
            end_date=normalized_end_date.isoformat(),
            initial_capital=resolved_initial_capital,
            currency=str(self._nested_value(existing_spec, "capital", "currency") or "USD"),
            signal=signal_spec,
            frequency=str(self._nested_value(existing_spec, "execution", "frequency") or "daily"),
            signal_timing=str(self._nested_value(existing_spec, "execution", "signal_timing") or "bar_close"),
            fill_timing=str(self._nested_value(existing_spec, "execution", "fill_timing") or "next_bar_open"),
            direction=str(self._nested_value(existing_spec, "position_behavior", "direction") or "long_only"),
            entry_sizing=str(self._nested_value(existing_spec, "position_behavior", "entry_sizing") or "all_in"),
            max_positions=int(self._nested_value(existing_spec, "position_behavior", "max_positions") or 1),
            pyramiding=bool(self._nested_value(existing_spec, "position_behavior", "pyramiding") or False),
            fee_bps=float(resolved_fee_bps if resolved_fee_bps is not None else fee_bps),
            slippage_bps=float(resolved_slippage_bps if resolved_slippage_bps is not None else slippage_bps),
            end_policy=str(self._nested_value(existing_spec, "end_behavior", "policy") or "liquidate_at_end"),
            end_price_basis=str(self._nested_value(existing_spec, "end_behavior", "price_basis") or "close"),
        )
        parsed.summary = {
            "entry": summary_entry,
            "exit": summary_exit,
            "strategy": str(parsed.summary.get("strategy") or self._strategy_kind_label(parsed.strategy_kind)),
        }
        parsed.executable = True
        parsed.assumptions = self._build_indicator_assumptions(parsed, normalized_spec)
        parsed.assumption_groups = self._group_assumptions(parsed.assumptions)
        parsed.normalization_state = "assumed" if parsed.assumptions or parsed.needs_confirmation or bool(parsed.ambiguities) else "ready"
        parsed.unsupported_reason = None
        return normalized_spec

    def _build_indicator_signal_spec(
        self,
        parsed: ParsedStrategy,
        setup: Dict[str, Any],
        existing_spec: Optional[Dict[str, Any]] = None,
    ) -> tuple[Dict[str, Any], str, str]:
        existing_spec = dict(existing_spec or {})
        indicator_family = str(
            self._first_defined(
                self._nested_value(existing_spec, "signal", "indicator_family"),
                setup.get("indicator_family"),
                "",
            )
        ).strip().lower()
        if parsed.strategy_kind == "moving_average_crossover":
            fast_period = int(self._first_defined(self._nested_value(existing_spec, "signal", "fast_period"), setup.get("fast_period"), 5))
            slow_period = int(self._first_defined(self._nested_value(existing_spec, "signal", "slow_period"), setup.get("slow_period"), 20))
            fast_type = str(self._first_defined(self._nested_value(existing_spec, "signal", "fast_type"), setup.get("fast_type"), "simple"))
            slow_type = str(self._first_defined(self._nested_value(existing_spec, "signal", "slow_type"), setup.get("slow_type"), "simple"))
            fast_label = self._format_average_label(fast_type, fast_period)
            slow_label = self._format_average_label(slow_type, slow_period)
            return (
                asdict(
                    _MovingAverageSignalPayload(
                        indicator_family=indicator_family or "moving_average",
                        fast_period=fast_period,
                        slow_period=slow_period,
                        fast_type=fast_type,
                        slow_type=slow_type,
                        entry_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "entry_condition"), "fast_crosses_above_slow")),
                        exit_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "exit_condition"), "fast_crosses_below_slow")),
                    )
                ),
                f"买入条件：{fast_label} 上穿 {slow_label}",
                f"卖出条件：{fast_label} 下穿 {slow_label}",
            )
        if parsed.strategy_kind == "macd_crossover":
            fast_period = int(self._first_defined(self._nested_value(existing_spec, "signal", "fast_period"), setup.get("fast_period"), 12))
            slow_period = int(self._first_defined(self._nested_value(existing_spec, "signal", "slow_period"), setup.get("slow_period"), 26))
            signal_period = int(self._first_defined(self._nested_value(existing_spec, "signal", "signal_period"), setup.get("signal_period"), 9))
            label = f"MACD({fast_period},{slow_period},{signal_period})"
            return (
                asdict(
                    _MacdSignalPayload(
                        indicator_family=indicator_family or "macd",
                        fast_period=fast_period,
                        slow_period=slow_period,
                        signal_period=signal_period,
                        entry_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "entry_condition"), "macd_crosses_above_signal")),
                        exit_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "exit_condition"), "macd_crosses_below_signal")),
                    )
                ),
                f"买入条件：{label} 金叉",
                f"卖出条件：{label} 死叉",
            )
        if parsed.strategy_kind == "rsi_threshold":
            period = int(self._first_defined(self._nested_value(existing_spec, "signal", "period"), setup.get("period"), 14))
            lower_threshold = float(self._first_defined(self._nested_value(existing_spec, "signal", "lower_threshold"), setup.get("lower_threshold"), 30.0))
            upper_threshold = float(self._first_defined(self._nested_value(existing_spec, "signal", "upper_threshold"), setup.get("upper_threshold"), 70.0))
            label = f"RSI{period}"
            return (
                asdict(
                    _RsiSignalPayload(
                        indicator_family=indicator_family or "rsi",
                        period=period,
                        lower_threshold=lower_threshold,
                        upper_threshold=upper_threshold,
                        entry_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "entry_condition"), "rsi_crosses_below_lower_threshold")),
                        exit_condition=str(self._first_defined(self._nested_value(existing_spec, "signal", "exit_condition"), "rsi_crosses_above_upper_threshold")),
                    )
                ),
                f"买入条件：{label} 低于 {lower_threshold:g}",
                f"卖出条件：{label} 高于 {upper_threshold:g}",
            )
        raise ValueError(f"unsupported deterministic strategy kind: {parsed.strategy_kind}")

    def _build_periodic_assumptions(self, parsed: ParsedStrategy, strategy_spec: Dict[str, Any]) -> List[Dict[str, Any]]:
        assumptions: List[Dict[str, Any]] = []
        for ambiguity in parsed.ambiguities:
            code = str(ambiguity.get("code") or "")
            if code == "default_initial_capital":
                assumptions.append(self._build_assumption("capital", "初始资金", "100000", "未显式写出，默认使用 100000。", group="capital_defaults", group_label="资金默认值"))
        price_basis = self._nested_value(strategy_spec, "entry", "price_basis")
        if price_basis == "open":
            assumptions.append(self._build_assumption("fill_timing", "成交时点", "当日开盘价", "按定投计划在交易日开盘执行。", group="execution_defaults", group_label="执行默认值"))
        return assumptions

    def _build_indicator_assumptions(self, parsed: ParsedStrategy, strategy_spec: Dict[str, Any]) -> List[Dict[str, Any]]:
        assumptions: List[Dict[str, Any]] = []
        signal = dict(self._nested_value(strategy_spec, "signal") or {})
        execution = dict(self._nested_value(strategy_spec, "execution") or {})
        position_behavior = dict(self._nested_value(strategy_spec, "position_behavior") or {})
        end_behavior = dict(self._nested_value(strategy_spec, "end_behavior") or {})

        assumptions.extend(
            [
                self._build_assumption("frequency", "执行频率", execution.get("frequency"), "未显式写出时，默认按日线逐 bar 评估。", group="data_defaults", group_label="数据与周期"),
                self._build_assumption("signal_timing", "信号时点", execution.get("signal_timing"), "默认在 bar close 判定信号。", group="execution_defaults", group_label="执行默认值"),
                self._build_assumption("fill_timing", "成交时点", execution.get("fill_timing"), "默认在下一根 bar 开盘成交。", group="execution_defaults", group_label="执行默认值"),
                self._build_assumption("position_behavior", "仓位行为", "单标的多头 / 单次满仓 / 最多一笔持仓", "当前 deterministic MVP 不支持做空或加仓。", group="position_defaults", group_label="仓位默认值"),
                self._build_assumption("end_behavior", "期末处理", end_behavior.get("policy"), "区间结束仍持仓时默认统一平仓。", group="end_behavior_defaults", group_label="期末处理"),
            ]
        )

        for ambiguity in parsed.ambiguities:
            code = str(ambiguity.get("code") or "")
            if code == "default_fast_ma_type":
                assumptions.append(self._build_assumption("fast_type", "快线类型", self._nested_value(signal, "fast_type"), "未显式写出，默认使用 SMA。", group="indicator_defaults", group_label="指标默认值"))
            elif code == "default_slow_ma_type":
                assumptions.append(self._build_assumption("slow_type", "慢线类型", self._nested_value(signal, "slow_type"), "未显式写出，默认使用 SMA。", group="indicator_defaults", group_label="指标默认值"))
            elif code == "default_reverse_exit":
                assumptions.append(self._build_assumption("exit_condition", "离场条件", "反向交叉", "未显式写出离场条件，默认使用反向信号离场。", group="indicator_defaults", group_label="指标默认值"))
            elif code == "default_macd_periods":
                assumptions.append(self._build_assumption("macd_periods", "MACD 参数", f"{signal.get('fast_period')},{signal.get('slow_period')},{signal.get('signal_period')}", "未显式写出，默认使用 (12,26,9)。", group="indicator_defaults", group_label="指标默认值"))
            elif code == "default_rsi_period":
                assumptions.append(self._build_assumption("rsi_period", "RSI 周期", signal.get("period"), "未显式写出，默认使用 RSI14。", group="indicator_defaults", group_label="指标默认值"))
            elif code == "mixed_rsi_period":
                assumptions.append(self._build_assumption("rsi_period", "RSI 周期", signal.get("period"), str(ambiguity.get("message") or "已统一使用单一 RSI 周期。"), group="indicator_defaults", group_label="指标默认值"))

        if position_behavior.get("entry_sizing") == "all_in":
            assumptions.append(self._build_assumption("entry_sizing", "入场仓位", "all_in", "入场时使用全部可用资金买入。", group="position_defaults", group_label="仓位默认值"))

        deduped: List[Dict[str, Any]] = []
        seen = set()
        for item in assumptions:
            key = (item.get("key"), item.get("value"), item.get("reason"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    @staticmethod
    def _build_assumption(
        key: str,
        label: str,
        value: Any,
        reason: str,
        *,
        group: str = "general_defaults",
        group_label: str = "默认假设",
    ) -> Dict[str, Any]:
        return {
            "key": key,
            "label": label,
            "value": value,
            "reason": reason,
            "group": group,
            "group_label": group_label,
        }

    @staticmethod
    def _group_assumptions(assumptions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        grouped: List[Dict[str, Any]] = []
        groups: Dict[str, Dict[str, Any]] = {}
        for item in assumptions or []:
            group_key = str(item.get("group") or "general_defaults")
            group_label = str(item.get("group_label") or "默认假设")
            bucket = groups.get(group_key)
            if bucket is None:
                bucket = {
                    "key": group_key,
                    "label": group_label,
                    "items": [],
                }
                groups[group_key] = bucket
                grouped.append(bucket)
            bucket["items"].append(item)
        return grouped

    def _enrich_confirmation_diagnostics(self, parsed: ParsedStrategy) -> None:
        if not parsed.assumption_groups and parsed.assumptions:
            parsed.assumption_groups = self._group_assumptions(parsed.assumptions)

        semantic_interpretation = self._build_semantic_interpretation(parsed)
        parsed.detected_strategy_family = semantic_interpretation.get("detected_strategy_family")
        parsed.core_intent_summary = semantic_interpretation.get("core_intent_summary")
        parsed.interpretation_confidence = float(semantic_interpretation.get("interpretation_confidence") or 0.0)

        parsed.parse_warnings = self._build_parse_warnings(parsed)
        supported_summary = self._build_supported_portion_summary(parsed)
        if supported_summary:
            parsed.supported_portion_summary = supported_summary

        taxonomy = self._classify_unsupported_input(parsed)
        if taxonomy is None:
            parsed.unsupported_details = []
            parsed.unsupported_extensions = []
            parsed.rewrite_suggestions = []
            if parsed.normalization_state != "unsupported":
                parsed.unsupported_reason = None
            return

        parsed.executable = False
        parsed.normalization_state = "unsupported"
        parsed.unsupported_reason = str(taxonomy["reason"])
        parsed.unsupported_details = list(taxonomy.get("details") or [])
        parsed.unsupported_extensions = list(taxonomy.get("unsupported_extensions") or [])
        parsed.rewrite_suggestions = list(taxonomy.get("rewrite_suggestions") or [])
        if not parsed.supported_portion_summary:
            parsed.supported_portion_summary = taxonomy.get("supported_portion_summary")
        if not parsed.core_intent_summary:
            parsed.core_intent_summary = taxonomy.get("core_intent_summary")
        if not parsed.detected_strategy_family:
            parsed.detected_strategy_family = taxonomy.get("detected_strategy_family")

    def _classify_unsupported_input(self, parsed: ParsedStrategy) -> Optional[Dict[str, Any]]:
        raw_text = str(parsed.source_text or "")
        upper_text = raw_text.upper()
        tickers = self._extract_uppercase_tickers(raw_text)
        details: List[Dict[str, Any]] = []

        if (
            self._contains_any(upper_text, ["OPTIMIZE", "OPTIMISE", "最优参数", "最佳参数", "参数优化"])
            or ("优化" in raw_text and "参数" in raw_text)
            or ("最佳" in raw_text and "参数" in raw_text)
        ):
            details.append(self._build_unsupported_detail("unsupported_parameter_optimization", "参数优化", "当前 deterministic backtest 只支持单次固定参数执行，不支持自动搜索最优参数。"))

        if self._contains_any(upper_text, ["做空", "SHORT", "SELL SHORT", "SHORT SELL"]):
            details.append(self._build_unsupported_detail("unsupported_short_selling", "做空方向", "当前 deterministic MVP 仅支持 long-only，不支持做空。"))

        if len(tickers) > 1:
            details.append(self._build_unsupported_detail("unsupported_multi_symbol", "多标的输入", f"当前一次只能回测单一标的，已识别到 {', '.join(tickers[:3])}。"))

        if self._contains_any(upper_text, ["分三批", "三批", "分批", "分三次", "三次", "HALF POSITION", "HALF-POSITION", "HALF POSITION", "半仓", "EACH HALF", "EACH 50%", "SCALE IN", "PYRAMID"]):
            details.append(self._build_unsupported_detail("unsupported_position_scaling", "分批建仓 / 仓位缩放", "当前只支持单次入场，不支持分批买入、半仓或逐级加仓。"))

        if self._contains_any(upper_text, ["STOP LOSS", "STOP-LOSS", "止损", "TAKE PROFIT", "止盈", "TRAILING", "移动止损"]):
            details.append(self._build_unsupported_detail("unsupported_strategy_combination", "组合执行语义", "当前已支持技术信号主规则，但不支持叠加固定止损 / 止盈 / trailing stop。"))

        if self._contains_any(upper_text, ["如果", "否则", "IF ", "THEN ", "ELSE ", "否则如果"]) and not self._is_supported_deterministic_strategy_family(parsed.strategy_kind):
            details.append(self._build_unsupported_detail("unsupported_nested_logic", "嵌套条件", "当前不支持带 if/else 分支的策略逻辑，请改写成单一入场条件 + 单一离场条件。"))

        unsupported_codes = {str(item.get("code") or "") for item in parsed.ambiguities}
        if "missing_exit" in unsupported_codes:
            details.append(self._build_unsupported_detail("unsupported_missing_exit_rule", "缺少离场规则", "当前 deterministic backtest 需要明确离场条件或使用已支持的默认离场模板。"))

        if parsed.normalization_state == "unsupported" or parsed.unsupported_reason:
            details.append(self._build_unsupported_detail("unsupported_parse_ambiguity", "解析不完整", "当前输入没有被稳定归一化成可执行的 deterministic strategy spec。"))

        deduped_details = self._dedupe_unsupported_details(details)
        if not deduped_details:
            return None
        return self._unsupported_taxonomy_payload(parsed, deduped_details, symbols=tickers[:2])

    def _unsupported_taxonomy_payload(
        self,
        parsed: ParsedStrategy,
        details: List[Dict[str, Any]],
        *,
        symbols: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        primary = self._pick_primary_unsupported_detail(details)
        semantic_interpretation = self._build_semantic_interpretation(parsed)
        return {
            "reason": str(primary.get("message") or "当前输入还不能稳定执行。"),
            "details": details,
            "unsupported_extensions": details,
            "detected_strategy_family": semantic_interpretation.get("detected_strategy_family"),
            "core_intent_summary": semantic_interpretation.get("core_intent_summary"),
            "supported_portion_summary": self._build_supported_portion_summary(parsed),
            "rewrite_suggestions": self._build_rewrite_suggestions(parsed, str(primary.get("code") or ""), symbols=symbols),
        }

    def _build_supported_portion_summary(self, parsed: ParsedStrategy) -> Optional[str]:
        raw_text = str(parsed.source_text or "").upper()
        family_hint = self._guess_strategy_family_from_text(raw_text)
        extracted = self._extract_family_semantic_details(str(parsed.source_text or ""), family_hint)
        if parsed.strategy_kind == "periodic_accumulation":
            symbol = self._nested_value(parsed.strategy_spec, "symbol") or self._nested_value(parsed.setup, "symbol")
            if symbol:
                return f"已识别为单标的区间定投：{symbol}，按固定频率买入。"
            return "已识别为单标的区间定投规则。"
        if parsed.strategy_kind == "moving_average_crossover":
            fast = self._nested_value(parsed.strategy_spec, "signal", "fast_period") or parsed.setup.get("fast_period")
            slow = self._nested_value(parsed.strategy_spec, "signal", "slow_period") or parsed.setup.get("slow_period")
            if fast and slow:
                return f"已识别为均线交叉主规则：快线 {fast}、慢线 {slow}。"
            return "已识别为均线交叉主规则。"
        if parsed.strategy_kind == "macd_crossover":
            return "已识别为 MACD 金叉 / 死叉主规则。"
        if parsed.strategy_kind == "rsi_threshold":
            lower = self._nested_value(parsed.strategy_spec, "signal", "lower_threshold") or parsed.setup.get("lower_threshold")
            upper = self._nested_value(parsed.strategy_spec, "signal", "upper_threshold") or parsed.setup.get("upper_threshold")
            if lower is not None and upper is not None:
                return f"已识别为 RSI 阈值主规则：低于 {lower:g} 买入，高于 {upper:g} 卖出。"
            return "已识别为 RSI 阈值主规则。"
        if family_hint == "moving_average_crossover":
            fast_period = extracted.get("fast_period")
            slow_period = extracted.get("slow_period")
            if fast_period and slow_period:
                return f"已识别到均线交叉主意图：快线 {fast_period}、慢线 {slow_period}，但完整执行语义仍不支持。"
            return "已识别到均线交叉主意图，但缺少可执行的进出场细节。"
        if family_hint == "macd_crossover":
            return "已识别到 MACD 主规则意图，但缺少可执行的进出场细节。"
        if family_hint == "rsi_threshold":
            lower = extracted.get("lower_threshold")
            upper = extracted.get("upper_threshold")
            if lower is not None or upper is not None:
                return f"已识别到 RSI 阈值主意图：低于 {lower if lower is not None else '--'} 买入，高于 {upper if upper is not None else '--'} 卖出，但完整执行语义仍不支持。"
            return "已识别到 RSI 阈值主意图，但缺少可执行的进出场细节。"
        if family_hint == "periodic_accumulation":
            return "已识别到区间定投主意图，但还缺少可执行的标的或执行细节。"
        if "MACD" in raw_text and self._contains_any(raw_text, ["金叉", "GOLDEN CROSS", "CROSS ABOVE"]):
            return "已识别到 MACD 金叉入场主意图。"
        if "RSI" in raw_text and self._contains_any(raw_text, ["买入", "BUY"]):
            return "已识别到 RSI 阈值入场主意图。"
        if self._contains_any(raw_text, ["上穿", "金叉"]) and self._contains_any(raw_text, ["MA", "EMA", "SMA", "均线"]):
            return "已识别到均线交叉入场主意图。"
        if self._has_meaningful_node(parsed.entry):
            return "已识别到入场规则骨架，但还不能稳定归一化为可执行策略。"
        return None

    def _build_rewrite_suggestions(
        self,
        parsed: ParsedStrategy,
        unsupported_code: str,
        *,
        symbols: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        family_hint = self._guess_strategy_family_from_text(str(parsed.source_text or ""))
        canonical = self._canonical_rewrite_templates(parsed, family_hint=family_hint)
        suggestions: List[Dict[str, Any]] = []
        if unsupported_code == "unsupported_multi_symbol":
            for symbol in symbols or []:
                rewritten = self._canonical_rewrite_templates(parsed, symbol=symbol, family_hint=family_hint)
                if not rewritten:
                    rewritten = f"单独回测 {symbol}"
                suggestions.append(self._build_rewrite_suggestion(rewritten, "拆成单标的执行"))
            return self._dedupe_rewrite_suggestions(suggestions)[:2]
        if unsupported_code in {
            "unsupported_strategy_combination",
            "unsupported_position_scaling",
            "unsupported_short_selling",
            "unsupported_parameter_optimization",
            "unsupported_missing_exit_rule",
        }:
            if canonical:
                label = "补成可执行版本" if unsupported_code == "unsupported_missing_exit_rule" else "改写成当前可执行版本"
                suggestions.append(self._build_rewrite_suggestion(canonical, label))
            effective_family = self._resolve_supported_strategy_family(parsed.strategy_kind, family_hint)
            if effective_family == "macd_crossover":
                suggestions.append(self._build_rewrite_suggestion("MACD金叉买入，死叉卖出", "使用固定 MACD 参数"))
            elif effective_family == "moving_average_crossover":
                suggestions.append(self._build_rewrite_suggestion("5日均线上穿20日均线买入，下穿卖出", "使用标准均线交叉"))
            elif effective_family == "rsi_threshold":
                suggestions.append(self._build_rewrite_suggestion("RSI14 低于30买入，高于70卖出", "使用单次入场 RSI 阈值"))
            elif effective_family == "periodic_accumulation":
                suggestions.append(self._build_rewrite_suggestion("从2025-01-01到2025-12-31，每月定投1000美元AAPL", "使用单标的固定金额定投"))
            return self._dedupe_rewrite_suggestions(suggestions)[:3]
        if unsupported_code == "unsupported_parse_ambiguity":
            if canonical:
                suggestions.append(self._build_rewrite_suggestion(canonical.replace("{symbol}", "{symbol}"), "按当前已支持格式重写"))
            return self._dedupe_rewrite_suggestions(suggestions)[:2]
        return self._dedupe_rewrite_suggestions(suggestions)[:3]

    def _build_semantic_interpretation(self, parsed: ParsedStrategy) -> Dict[str, Any]:
        family = self._resolve_supported_strategy_family(
            parsed.strategy_kind,
            self._guess_strategy_family_from_text(str(parsed.source_text or "")),
        )
        core_intent_summary = self._build_supported_portion_summary(parsed)
        interpretation_confidence = 0.0
        if self._is_supported_deterministic_strategy_family(parsed.strategy_kind):
            interpretation_confidence = 0.96 if parsed.executable else 0.9
        elif family:
            extracted = self._extract_family_semantic_details(str(parsed.source_text or ""), family)
            has_specifics = any(value is not None for value in extracted.values())
            interpretation_confidence = 0.84 if has_specifics else 0.72

        return {
            "detected_strategy_family": family,
            "core_intent_summary": core_intent_summary,
            "interpretation_confidence": interpretation_confidence,
        }

    @staticmethod
    def _build_rewrite_suggestion(strategy_text: str, label: str) -> Dict[str, Any]:
        return {
            "label": label,
            "strategy_text": strategy_text,
        }

    def _canonical_rewrite_templates(
        self,
        parsed: ParsedStrategy,
        *,
        symbol: Optional[str] = None,
        family_hint: Optional[str] = None,
    ) -> str:
        resolved_symbol = str(symbol or self._nested_value(parsed.strategy_spec, "symbol") or self._nested_value(parsed.setup, "symbol") or "AAPL").upper()
        effective_family = self._resolve_supported_strategy_family(parsed.strategy_kind, family_hint)
        if effective_family == "moving_average_crossover":
            return f"{resolved_symbol}，5日均线上穿20日均线买入，下穿卖出"
        if effective_family == "macd_crossover":
            return f"{resolved_symbol}，MACD金叉买入，死叉卖出"
        if effective_family == "rsi_threshold":
            return f"{resolved_symbol}，RSI14 低于30买入，高于70卖出"
        if effective_family == "periodic_accumulation":
            return f"从2025-01-01到2025-12-31，每月定投1000美元{resolved_symbol}"
        return ""

    @staticmethod
    def _guess_strategy_family_from_text(text: str) -> Optional[str]:
        raw_text = str(text or "")
        upper_text = raw_text.upper()
        if "MACD" in upper_text:
            return "macd_crossover"
        if "RSI" in upper_text:
            return "rsi_threshold"
        if any(keyword in raw_text for keyword in ["均线", "日线"]) and any(keyword in raw_text for keyword in ["上穿", "下穿", "金叉", "死叉", "跌破"]):
            return "moving_average_crossover"
        if any(token in upper_text for token in ["MA", "EMA", "SMA", "均线"]):
            return "moving_average_crossover"
        if any(token in raw_text for token in ["定投", "每月", "每天", "每周"]):
            return "periodic_accumulation"
        return None

    @staticmethod
    def _dedupe_rewrite_suggestions(suggestions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for item in suggestions:
            strategy_text = str(item.get("strategy_text") or "").strip()
            if not strategy_text or strategy_text in seen:
                continue
            seen.add(strategy_text)
            deduped.append(item)
        return deduped

    @staticmethod
    def _dedupe_unsupported_details(details: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for item in details:
            code = str(item.get("code") or "").strip()
            if not code or code in seen:
                continue
            seen.add(code)
            deduped.append(item)
        return deduped

    @staticmethod
    def _pick_primary_unsupported_detail(details: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not details:
            return {"code": "unsupported_parse_ambiguity", "message": "当前输入还不能稳定执行。"}
        priority = {
            "unsupported_multi_symbol": 0,
            "unsupported_position_scaling": 1,
            "unsupported_strategy_combination": 2,
            "unsupported_parameter_optimization": 3,
            "unsupported_short_selling": 4,
            "unsupported_nested_logic": 5,
            "unsupported_missing_exit_rule": 6,
            "unsupported_parse_ambiguity": 7,
        }
        return sorted(details, key=lambda item: priority.get(str(item.get("code") or ""), 99))[0]

    @staticmethod
    def _extract_family_semantic_details(text: str, family: Optional[str]) -> Dict[str, Any]:
        raw_text = str(text or "")
        details: Dict[str, Any] = {}
        if family == "moving_average_crossover":
            matches = re.findall(r"(\d+)\s*日?(?:均线|线|MA|EMA|SMA)", raw_text, flags=re.IGNORECASE)
            if matches:
                unique = []
                for match in matches:
                    value = int(match)
                    if value not in unique:
                        unique.append(value)
                if unique:
                    details["fast_period"] = unique[0]
                if len(unique) > 1:
                    details["slow_period"] = unique[1]
        elif family == "rsi_threshold":
            lower_match = re.search(r"RSI\d*\s*(?:小于|低于|<)\s*(\d+(?:\.\d+)?)", raw_text, flags=re.IGNORECASE)
            upper_match = re.search(r"(?:大于|高于|>)\s*(\d+(?:\.\d+)?)\s*卖出", raw_text, flags=re.IGNORECASE)
            if lower_match:
                details["lower_threshold"] = float(lower_match.group(1))
            if upper_match:
                details["upper_threshold"] = float(upper_match.group(1))
        return details

    def _build_parse_warnings(self, parsed: ParsedStrategy) -> List[Dict[str, Any]]:
        warnings: List[Dict[str, Any]] = []
        for item in parsed.ambiguities[:4]:
            warnings.append({
                "code": str(item.get("code") or "parse_warning"),
                "message": str(item.get("message") or item.get("suggestion") or "请人工确认。"),
            })
        return warnings

    @staticmethod
    def _build_unsupported_detail(code: str, title: str, message: str) -> Dict[str, Any]:
        return {
            "code": code,
            "title": title,
            "message": message,
        }

    @staticmethod
    def _extract_uppercase_tickers(text: str) -> List[str]:
        matches = re.findall(r"(?<![A-Z])[A-Z]{1,5}(?![A-Z])", str(text or "").upper())
        filtered = [item for item in matches if item not in {"MACD", "RSI", "SMA", "EMA", "MA", "BUY", "SELL", "IF", "THEN", "ELSE"}]
        ordered: List[str] = []
        seen = set()
        for item in filtered:
            if item in seen:
                continue
            seen.add(item)
            ordered.append(item)
        return ordered

    @staticmethod
    def _contains_any(text: str, patterns: List[str]) -> bool:
        upper_text = str(text or "").upper()
        return any(pattern.upper() in upper_text for pattern in patterns)

    @staticmethod
    def _strategy_kind_label(strategy_kind: str) -> str:
        return {
            "moving_average_crossover": "均线交叉策略",
            "macd_crossover": "MACD 交叉策略",
            "rsi_threshold": "RSI 阈值策略",
            "periodic_accumulation": "区间定投策略",
            "rule_conditions": "条件规则策略",
        }.get(strategy_kind, strategy_kind)

    @staticmethod
    def _format_average_label(average_type: str, period: int) -> str:
        return f"{'EMA' if str(average_type).lower() == 'ema' else 'SMA'}{int(period)}"

    @staticmethod
    def _nested_value(payload: Any, *path: str) -> Any:
        current = payload
        for segment in path:
            if not isinstance(current, dict):
                return None
            camel_segment = segment.replace("_", " ").title().replace(" ", "")
            camel_segment = camel_segment[0].lower() + camel_segment[1:] if camel_segment else camel_segment
            if segment in current:
                current = current.get(segment)
            elif camel_segment in current:
                current = current.get(camel_segment)
            else:
                return None
        return current

    @staticmethod
    def _first_defined(*values: Any) -> Any:
        for value in values:
            if value is None:
                continue
            if isinstance(value, str) and value == "":
                continue
            return value
        return None

    @staticmethod
    def _has_meaningful_node(node: Optional[Dict[str, Any]]) -> bool:
        if not node:
            return False
        if node.get("type") == "comparison":
            return True
        if node.get("type") == "group":
            return any(RuleBacktestService._has_meaningful_node(child) for child in node.get("rules", []) or [])
        return False

    @staticmethod
    def _parse_optional_date(value: Any) -> Optional[date]:
        if value in (None, ""):
            return None
        if isinstance(value, date):
            return value
        try:
            return datetime.fromisoformat(str(value)).date()
        except ValueError as exc:
            raise ValueError("start_date/end_date must use YYYY-MM-DD format") from exc

    def _normalize_date_range(self, *, start_date: Optional[Any], end_date: Optional[Any]) -> tuple[Optional[date], Optional[date]]:
        normalized_start = self._parse_optional_date(start_date)
        normalized_end = self._parse_optional_date(end_date)
        if normalized_start is None and normalized_end is None:
            return None, None
        if normalized_start is None or normalized_end is None:
            raise ValueError("start_date and end_date must be provided together")
        if normalized_start > normalized_end:
            raise ValueError("start_date must be earlier than or equal to end_date")
        return normalized_start, normalized_end

    @staticmethod
    def _canonical_signal_evaluation_timing(value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"scheduled_trading_day_open", "execute scheduled accumulation on each trading day"}:
            return "scheduled_trading_day_open"
        return "bar_close"

    @staticmethod
    def _canonical_entry_timing(value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if "same_bar_open" in normalized:
            return "same_bar_open"
        return "next_bar_open"

    @staticmethod
    def _canonical_exit_timing(value: Any) -> str:
        normalized = str(value or "").strip().lower()
        if "forced_close_at_window_end_close" in normalized:
            return "forced_close_at_window_end_close"
        if ";" in normalized:
            normalized = normalized.split(";", 1)[0].strip()
        return normalized or "next_bar_open"

    @staticmethod
    @staticmethod
    def _describe_execution_assumptions_source(summary: Dict[str, Any]) -> str:
        snapshot = RuleBacktestService._extract_execution_assumptions_snapshot_payload(summary)
        if snapshot is not None:
            return str(snapshot.get("source") or "summary.execution_assumptions_snapshot")
        stored = summary.get("execution_assumptions")
        if isinstance(stored, dict) and stored:
            return "summary.execution_assumptions"
        return "derived_from_execution_model"

    def _build_derived_execution_model_payload(
        self,
        *,
        summary: Dict[str, Any],
        row: RuleBacktestRun,
        parsed_strategy: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        execution_assumptions = dict(summary.get("execution_assumptions") or {})
        request = dict(summary.get("request") or {})
        parsed_payload = parsed_strategy if isinstance(parsed_strategy, dict) else {}
        strategy_spec = dict(parsed_payload.get("strategy_spec") or parsed_payload.get("strategySpec") or {})
        strategy_kind = str(strategy_spec.get("strategy_type") or parsed_payload.get("strategy_kind") or parsed_payload.get("strategyKind") or "rule_conditions")

        derived = self.engine._build_execution_model(
            timeframe=str(execution_assumptions.get("timeframe") or row.timeframe or "daily"),
            fee_bps=float(_safe_float(execution_assumptions.get("fee_bps_per_side")) or row.fee_bps or 0.0),
            slippage_bps=float(_safe_float(execution_assumptions.get("slippage_bps_per_side")) or request.get("slippage_bps") or 0.0),
            strategy_type=strategy_kind,
        ).to_dict()

        if execution_assumptions:
            derived["signal_evaluation_timing"] = self._canonical_signal_evaluation_timing(
                execution_assumptions.get("signal_evaluation_timing")
            )
            derived["entry_timing"] = self._canonical_entry_timing(execution_assumptions.get("entry_fill_timing"))
            derived["exit_timing"] = self._canonical_exit_timing(execution_assumptions.get("exit_fill_timing"))
            if execution_assumptions.get("default_fill_price_basis"):
                derived["entry_fill_price_basis"] = str(execution_assumptions.get("default_fill_price_basis"))
            if derived["exit_timing"] == "forced_close_at_window_end_close":
                derived["exit_fill_price_basis"] = "close"
            else:
                derived["exit_fill_price_basis"] = derived["entry_fill_price_basis"]
            if execution_assumptions.get("position_sizing"):
                derived["position_sizing"] = str(execution_assumptions.get("position_sizing"))
            if execution_assumptions.get("fee_model"):
                derived["fee_model"] = str(execution_assumptions.get("fee_model"))
            if execution_assumptions.get("slippage_model"):
                derived["slippage_model"] = str(execution_assumptions.get("slippage_model"))
            market_rules = dict(derived.get("market_rules") or {})
            if "same-bar close" in str(execution_assumptions.get("exit_fill_timing") or "").lower():
                market_rules["terminal_bar_fill_fallback"] = "same_bar_close"
            derived["market_rules"] = market_rules

        return derived

    @staticmethod
    def _merge_execution_model_payload(
        *,
        derived_payload: Dict[str, Any],
        stored_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        resolved_payload = dict(derived_payload or {})
        resolved_payload.update(
            {
                key: value
                for key, value in dict(stored_payload or {}).items()
                if key != "market_rules" and value is not None
            }
        )
        resolved_market_rules = dict(derived_payload.get("market_rules") or {})
        stored_market_rules = stored_payload.get("market_rules")
        if isinstance(stored_market_rules, dict):
            resolved_market_rules.update(
                {key: value for key, value in stored_market_rules.items() if value is not None}
            )
        resolved_payload["market_rules"] = resolved_market_rules
        resolved_model = ExecutionModelConfig.from_dict(resolved_payload)
        return resolved_model.to_dict() if resolved_model is not None else dict(derived_payload or {})

    @staticmethod
    def _collect_missing_execution_model_fields(
        *,
        derived_payload: Dict[str, Any],
        stored_payload: Dict[str, Any],
    ) -> List[str]:
        missing_fields: List[str] = []
        for key, value in (derived_payload or {}).items():
            if key == "market_rules":
                expected_market_rules = dict(value or {})
                stored_market_rules = stored_payload.get("market_rules")
                if not isinstance(stored_market_rules, dict):
                    missing_fields.extend(
                        [f"market_rules.{sub_key}" for sub_key in expected_market_rules.keys()]
                    )
                    continue
                for sub_key in expected_market_rules.keys():
                    if stored_market_rules.get(sub_key) is None:
                        missing_fields.append(f"market_rules.{sub_key}")
                continue
            if stored_payload.get(key) is None:
                missing_fields.append(key)
        return missing_fields

    def _resolve_execution_model_payload(
        self,
        *,
        summary: Dict[str, Any],
        row: RuleBacktestRun,
        parsed_strategy: Optional[Dict[str, Any]] = None,
    ) -> tuple[Dict[str, Any], str, str, List[str]]:
        derived_payload = self._build_derived_execution_model_payload(
            summary=summary,
            row=row,
            parsed_strategy=parsed_strategy,
        )
        request_payload = dict(summary.get("request") or {})
        for source, stored_payload in (
            ("summary.execution_model", summary.get("execution_model")),
            ("summary.request.execution_model", request_payload.get("execution_model")),
        ):
            if isinstance(stored_payload, dict) and stored_payload:
                missing_fields = self._collect_missing_execution_model_fields(
                    derived_payload=derived_payload,
                    stored_payload=stored_payload,
                )
                resolved_payload = self._merge_execution_model_payload(
                    derived_payload=derived_payload,
                    stored_payload=stored_payload,
                )
                if missing_fields:
                    return (
                        resolved_payload,
                        f"{source}+repaired_fields",
                        "stored_partial_repaired",
                        missing_fields,
                    )
                return resolved_payload, source, "complete", []

        if summary.get("execution_assumptions"):
            return (
                derived_payload,
                "derived_from_execution_assumptions_and_request",
                "derived",
                ["stored_execution_model"],
            )
        return (
            derived_payload,
            "derived_from_row_and_request",
            "derived",
            ["stored_execution_model", "execution_assumptions"],
        )

    @staticmethod
    def _dedupe_trade_row_missing_fields(fields: List[str]) -> List[str]:
        deduped: List[str] = []
        seen: set[str] = set()
        for field in fields or []:
            normalized = str(field or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    @staticmethod
    def _normalize_trade_row_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        row = dict(payload or {})
        return {
            "id": row.get("id"),
            "run_id": row.get("run_id"),
            "trade_index": row.get("trade_index"),
            "code": row.get("code"),
            "entry_signal_date": row.get("entry_signal_date"),
            "exit_signal_date": row.get("exit_signal_date"),
            "entry_date": row.get("entry_date"),
            "exit_date": row.get("exit_date"),
            "entry_price": row.get("entry_price"),
            "exit_price": row.get("exit_price"),
            "entry_signal": row.get("entry_signal"),
            "exit_signal": row.get("exit_signal"),
            "entry_trigger": row.get("entry_trigger"),
            "exit_trigger": row.get("exit_trigger"),
            "return_pct": row.get("return_pct"),
            "holding_days": row.get("holding_days"),
            "holding_bars": row.get("holding_bars"),
            "holding_calendar_days": row.get("holding_calendar_days"),
            "entry_rule": dict(row.get("entry_rule") or {}),
            "exit_rule": dict(row.get("exit_rule") or {}),
            "entry_indicators": dict(row.get("entry_indicators") or {}),
            "exit_indicators": dict(row.get("exit_indicators") or {}),
            "entry_fill_basis": row.get("entry_fill_basis"),
            "exit_fill_basis": row.get("exit_fill_basis"),
            "signal_price_basis": row.get("signal_price_basis"),
            "price_basis": row.get("price_basis"),
            "fee_bps": row.get("fee_bps"),
            "slippage_bps": row.get("slippage_bps"),
            "entry_fee_amount": row.get("entry_fee_amount"),
            "exit_fee_amount": row.get("exit_fee_amount"),
            "entry_slippage_amount": row.get("entry_slippage_amount"),
            "exit_slippage_amount": row.get("exit_slippage_amount"),
            "notes": row.get("notes"),
        }

    @staticmethod
    def _collect_trade_row_missing_fields(
        *,
        trade: RuleBacktestTrade,
        entry_payload: Dict[str, Any],
        exit_payload: Dict[str, Any],
        notes_payload: Dict[str, Any],
    ) -> List[str]:
        missing_fields: List[str] = []
        if trade.entry_date is None:
            missing_fields.append("entry_date")
        if trade.exit_date is None:
            missing_fields.append("exit_date")
        if trade.entry_price is None:
            missing_fields.append("entry_price")
        if trade.exit_price is None:
            missing_fields.append("exit_price")
        if trade.entry_signal is None:
            missing_fields.append("entry_signal")
        if trade.exit_signal is None:
            missing_fields.append("exit_signal")
        if trade.return_pct is None:
            missing_fields.append("return_pct")
        if trade.holding_days is None:
            missing_fields.append("holding_days")

        if not entry_payload:
            missing_fields.extend(
                ["entry_rule", "entry_signal_date", "entry_trigger", "entry_indicators"]
            )
        else:
            entry_rule = entry_payload.get("rule") or entry_payload
            if not isinstance(entry_rule, dict) or not entry_rule:
                missing_fields.append("entry_rule")
            if entry_payload.get("signal_date") is None:
                missing_fields.append("entry_signal_date")
            if entry_payload.get("trigger") is None:
                missing_fields.append("entry_trigger")
            if entry_payload.get("indicators") is None:
                missing_fields.append("entry_indicators")

        if not exit_payload:
            missing_fields.extend(
                ["exit_rule", "exit_signal_date", "exit_trigger", "exit_indicators"]
            )
        else:
            exit_rule = exit_payload.get("rule") or exit_payload
            if not isinstance(exit_rule, dict) or not exit_rule:
                missing_fields.append("exit_rule")
            if exit_payload.get("signal_date") is None:
                missing_fields.append("exit_signal_date")
            if exit_payload.get("trigger") is None:
                missing_fields.append("exit_trigger")
            if exit_payload.get("indicators") is None:
                missing_fields.append("exit_indicators")

        note_backed_fields = [
            "holding_bars",
            "holding_calendar_days",
            "entry_fill_basis",
            "exit_fill_basis",
            "signal_price_basis",
            "price_basis",
            "fee_bps",
            "slippage_bps",
            "entry_fee_amount",
            "exit_fee_amount",
            "entry_slippage_amount",
            "exit_slippage_amount",
            "notes",
        ]
        if not notes_payload:
            missing_fields.extend(note_backed_fields)
        else:
            for field in note_backed_fields:
                if notes_payload.get(field) is None:
                    missing_fields.append(field)

        return RuleBacktestService._dedupe_trade_row_missing_fields(missing_fields)

    @staticmethod
    def _dedupe_parsed_strategy_missing_fields(missing_fields: List[str]) -> List[str]:
        requested = [str(item or "").strip() for item in (missing_fields or []) if str(item or "").strip()]
        ordered_fields = [field for field in PARSED_STRATEGY_FIELD_ORDER + ["stored_parsed_strategy"] if field in requested]
        seen = set()
        deduped: List[str] = []
        for field in ordered_fields + requested:
            normalized = str(field or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    def _parsed_strategy_expected_fields(self, parsed_payload: Dict[str, Any]) -> List[str]:
        strategy_type = str(
            self._nested_value(parsed_payload, "strategy_spec", "strategy_type")
            or parsed_payload.get("strategy_kind")
            or ""
        )
        expected_fields = list(PARSED_STRATEGY_FIELD_ORDER)
        if strategy_type == "periodic_accumulation":
            expected_fields.extend(
                [
                    "strategy_spec.symbol",
                    "strategy_spec.date_range.start_date",
                    "strategy_spec.date_range.end_date",
                    "strategy_spec.capital.initial_capital",
                    "strategy_spec.costs.fee_bps",
                    "strategy_spec.costs.slippage_bps",
                    "strategy_spec.schedule.frequency",
                    "strategy_spec.entry.side",
                    "strategy_spec.entry.order.mode",
                    "strategy_spec.exit.policy",
                    "strategy_spec.position_behavior.cash_policy",
                ]
            )
        elif strategy_type == "moving_average_crossover":
            expected_fields.extend(
                [
                    "strategy_spec.symbol",
                    "strategy_spec.date_range.start_date",
                    "strategy_spec.date_range.end_date",
                    "strategy_spec.capital.initial_capital",
                    "strategy_spec.costs.fee_bps",
                    "strategy_spec.costs.slippage_bps",
                    "strategy_spec.signal.indicator_family",
                    "strategy_spec.signal.fast_period",
                    "strategy_spec.signal.slow_period",
                    "strategy_spec.signal.fast_type",
                    "strategy_spec.signal.slow_type",
                    "strategy_spec.execution.signal_timing",
                    "strategy_spec.execution.fill_timing",
                    "strategy_spec.position_behavior.direction",
                    "strategy_spec.end_behavior.policy",
                ]
            )
        elif strategy_type == "macd_crossover":
            expected_fields.extend(
                [
                    "strategy_spec.symbol",
                    "strategy_spec.date_range.start_date",
                    "strategy_spec.date_range.end_date",
                    "strategy_spec.capital.initial_capital",
                    "strategy_spec.costs.fee_bps",
                    "strategy_spec.costs.slippage_bps",
                    "strategy_spec.signal.indicator_family",
                    "strategy_spec.signal.fast_period",
                    "strategy_spec.signal.slow_period",
                    "strategy_spec.signal.signal_period",
                    "strategy_spec.execution.signal_timing",
                    "strategy_spec.execution.fill_timing",
                    "strategy_spec.position_behavior.direction",
                    "strategy_spec.end_behavior.policy",
                ]
            )
        elif strategy_type == "rsi_threshold":
            expected_fields.extend(
                [
                    "strategy_spec.symbol",
                    "strategy_spec.date_range.start_date",
                    "strategy_spec.date_range.end_date",
                    "strategy_spec.capital.initial_capital",
                    "strategy_spec.costs.fee_bps",
                    "strategy_spec.costs.slippage_bps",
                    "strategy_spec.signal.indicator_family",
                    "strategy_spec.signal.period",
                    "strategy_spec.signal.lower_threshold",
                    "strategy_spec.signal.upper_threshold",
                    "strategy_spec.execution.signal_timing",
                    "strategy_spec.execution.fill_timing",
                    "strategy_spec.position_behavior.direction",
                    "strategy_spec.end_behavior.policy",
                ]
            )
        return self._dedupe_parsed_strategy_missing_fields(expected_fields)

    def _collect_missing_parsed_strategy_fields(
        self,
        *,
        stored_payload: Dict[str, Any],
        normalized_payload: Dict[str, Any],
    ) -> List[str]:
        missing_fields: List[str] = []
        for field in self._parsed_strategy_expected_fields(normalized_payload):
            stored_value = self._nested_value(stored_payload, *field.split("."))
            normalized_value = self._nested_value(normalized_payload, *field.split("."))
            if stored_value is None:
                missing_fields.append(field)
                continue
            if isinstance(normalized_value, dict) and normalized_value and not isinstance(stored_value, dict):
                missing_fields.append(field)
        return self._dedupe_parsed_strategy_missing_fields(missing_fields)

    @staticmethod
    def _build_default_parsed_strategy_summary(summary_payload: Optional[Dict[str, Any]]) -> Dict[str, str]:
        summary_payload = dict(summary_payload or {})
        return {
            "entry": str(summary_payload.get("entry") or "买入条件：--"),
            "exit": str(summary_payload.get("exit") or "卖出条件：--"),
            "strategy": str(summary_payload.get("strategy") or ""),
        }

    def _build_summary_only_parsed_strategy_payload(
        self,
        *,
        row: RuleBacktestRun,
        parsed_strategy_summary: Optional[Dict[str, Any]],
        warnings: List[Dict[str, Any]],
        source: str,
    ) -> Dict[str, Any]:
        support_payload = {
            "executable": False,
            "normalization_state": "unavailable",
            "requires_confirmation": bool(row.needs_confirmation),
            "unsupported_reason": "stored_parsed_strategy_missing",
            "detected_strategy_family": None,
        }
        return {
            "version": "v1",
            "timeframe": str(row.timeframe or "daily"),
            "source_text": str(row.strategy_text or ""),
            "normalized_text": str(row.strategy_text or ""),
            "entry": {},
            "exit": {},
            "confidence": float(row.parsed_confidence or 0.0),
            "needs_confirmation": bool(row.needs_confirmation),
            "ambiguities": list(warnings or []),
            "summary": self._build_default_parsed_strategy_summary(parsed_strategy_summary),
            "max_lookback": 1,
            "strategy_kind": "rule_conditions",
            "setup": {},
            "strategy_spec": {
                "version": "v1",
                "strategy_type": "rule_conditions",
                "strategy_family": "rule_conditions",
                "timeframe": str(row.timeframe or "daily"),
                "max_lookback": 1,
                "support": support_payload,
            },
            "executable": False,
            "normalization_state": "unavailable",
            "assumptions": [],
            "assumption_groups": [],
            "detected_strategy_family": None,
            "unsupported_reason": "stored_parsed_strategy_missing",
            "unsupported_details": [],
            "unsupported_extensions": [],
            "core_intent_summary": None,
            "interpretation_confidence": 0.0,
            "supported_portion_summary": None,
            "rewrite_suggestions": [],
            "parse_warnings": [],
            "source": source,
        }

    def _resolve_parsed_strategy_payload(
        self,
        *,
        row: RuleBacktestRun,
        summary: Dict[str, Any],
        warnings: List[Dict[str, Any]],
        parsed_override: Optional[Dict[str, Any]] = None,
    ) -> tuple[Dict[str, Any], str, str, List[str]]:
        request = dict(summary.get("request") or {})
        raw_text = str(row.strategy_text or "")
        stored_payload = parsed_override if isinstance(parsed_override, dict) else None

        if stored_payload is None and row.parsed_strategy_json:
            try:
                loaded_payload = json.loads(row.parsed_strategy_json)
                if isinstance(loaded_payload, dict):
                    stored_payload = loaded_payload
            except Exception:
                stored_payload = None

        if isinstance(stored_payload, dict) and stored_payload:
            parsed = self._dict_to_parsed_strategy(stored_payload, raw_text)
            normalized = self._normalize_parsed_strategy(
                parsed,
                code=row.code,
                start_date=request.get("start_date"),
                end_date=request.get("end_date"),
                initial_capital=float(request.get("initial_capital") or row.initial_capital or 100000.0),
                fee_bps=float(request.get("fee_bps") or row.fee_bps or 0.0),
                slippage_bps=float(request.get("slippage_bps") or 0.0),
            )
            normalized_payload = self._parsed_to_dict(normalized)
            missing_fields = self._collect_missing_parsed_strategy_fields(
                stored_payload=stored_payload,
                normalized_payload=normalized_payload,
            )
            if missing_fields:
                return (
                    normalized_payload,
                    "row.parsed_strategy_json+repaired_fields",
                    "stored_partial_repaired",
                    missing_fields,
                )
            return normalized_payload, "row.parsed_strategy_json", "complete", []

        parsed_strategy_summary = summary.get("parsed_strategy_summary")
        if isinstance(parsed_strategy_summary, dict) and parsed_strategy_summary:
            return (
                self._build_summary_only_parsed_strategy_payload(
                    row=row,
                    parsed_strategy_summary=parsed_strategy_summary,
                    warnings=warnings,
                    source="summary.parsed_strategy_summary+row_defaults",
                ),
                "summary.parsed_strategy_summary+row_defaults",
                "legacy_summary_only",
                [
                    "stored_parsed_strategy",
                    "strategy_kind",
                    "entry",
                    "exit",
                    "setup",
                    "strategy_spec.strategy_type",
                    "strategy_spec.strategy_family",
                    "strategy_spec.support.detected_strategy_family",
                ],
            )

        return (
            self._build_summary_only_parsed_strategy_payload(
                row=row,
                parsed_strategy_summary=None,
                warnings=warnings,
                source="unavailable",
            ),
            "unavailable",
            "unavailable",
            ["stored_parsed_strategy"],
        )

    @staticmethod
    def _dedupe_summary_missing_fields(missing_fields: List[str]) -> List[str]:
        requested = [str(item or "").strip() for item in (missing_fields or []) if str(item or "").strip()]
        ordered_fields = [field for field in SUMMARY_FIELD_ORDER + ["stored_summary"] if field in requested]
        seen: set[str] = set()
        deduped: List[str] = []
        for field in ordered_fields + requested:
            normalized = str(field or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    def _build_summary_request_payload(
        self,
        *,
        row: RuleBacktestRun,
        stored_request: Dict[str, Any],
    ) -> tuple[Dict[str, Any], List[str]]:
        request_payload = {
            "start_date": stored_request.get("start_date"),
            "end_date": stored_request.get("end_date"),
            "lookback_bars": int(stored_request.get("lookback_bars") or row.lookback_bars or 252),
            "initial_capital": float(stored_request.get("initial_capital") or row.initial_capital or 100000.0),
            "fee_bps": float(stored_request.get("fee_bps") or row.fee_bps or 0.0),
            "slippage_bps": float(stored_request.get("slippage_bps") or 0.0),
            "benchmark_mode": str(stored_request.get("benchmark_mode")) if "benchmark_mode" in stored_request else None,
            "benchmark_code": (
                str(stored_request.get("benchmark_code") or "").strip() or None
                if "benchmark_code" in stored_request
                else None
            ),
            "confirmed": bool(stored_request.get("confirmed", False)),
            "execution_model": dict(stored_request.get("execution_model") or {}),
        }

        missing_fields: List[str] = []
        if not stored_request:
            missing_fields.append("request")
        request_keys = [
            "start_date",
            "end_date",
            "lookback_bars",
            "initial_capital",
            "fee_bps",
            "slippage_bps",
            "benchmark_mode",
            "benchmark_code",
            "confirmed",
            "execution_model",
        ]
        for key in request_keys:
            if key not in stored_request:
                missing_fields.append(f"request.{key}")
                continue
            if key == "execution_model" and not isinstance(stored_request.get("execution_model"), dict):
                missing_fields.append("request.execution_model")
        return request_payload, self._dedupe_summary_missing_fields(missing_fields)

    def _build_summary_visualization_payload(
        self,
        *,
        stored_visualization: Dict[str, Any],
        comparison: Dict[str, Any],
        benchmark_curve: List[Dict[str, Any]],
        benchmark_summary: Dict[str, Any],
        buy_and_hold_curve: List[Dict[str, Any]],
        buy_and_hold_summary: Dict[str, Any],
        audit_rows: List[Dict[str, Any]],
        daily_return_series: List[Dict[str, Any]],
        exposure_curve: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        resolved = dict(stored_visualization or {})
        resolved["comparison"] = dict(comparison or {})
        resolved["benchmark_curve"] = list(benchmark_curve or [])
        resolved["benchmark_summary"] = dict(benchmark_summary or {})
        resolved["buy_and_hold_curve"] = list(buy_and_hold_curve or [])
        resolved["buy_and_hold_summary"] = dict(buy_and_hold_summary or {})
        resolved["audit_rows"] = list(audit_rows or [])
        resolved["daily_return_series"] = list(daily_return_series or [])
        resolved["exposure_curve"] = list(exposure_curve or [])
        return resolved

    def _resolve_summary_payload(
        self,
        *,
        row: RuleBacktestRun,
        stored_summary: Dict[str, Any],
        parsed_strategy: Dict[str, Any],
        metrics: Dict[str, Any],
        execution_model: Dict[str, Any],
        execution_assumptions: Dict[str, Any],
        execution_assumptions_snapshot: Dict[str, Any],
        comparison: Dict[str, Any],
        benchmark_curve: List[Dict[str, Any]],
        benchmark_summary: Dict[str, Any],
        buy_and_hold_curve: List[Dict[str, Any]],
        buy_and_hold_summary: Dict[str, Any],
        audit_rows: List[Dict[str, Any]],
        daily_return_series: List[Dict[str, Any]],
        exposure_curve: List[Dict[str, Any]],
        execution_trace: Dict[str, Any],
        ai_summary: Optional[str],
    ) -> tuple[Dict[str, Any], str, str, List[str]]:
        stored_payload = dict(stored_summary or {})
        stored_request_raw = stored_payload.get("request")
        stored_request = dict(stored_request_raw or {}) if isinstance(stored_request_raw, dict) else {}
        request_payload, request_missing_fields = self._build_summary_request_payload(
            row=row,
            stored_request=stored_request,
        )

        stored_visualization_raw = stored_payload.get("visualization")
        stored_visualization = (
            dict(stored_visualization_raw or {})
            if isinstance(stored_visualization_raw, dict)
            else {}
        )

        resolved_payload = dict(stored_payload)
        resolved_payload["request"] = request_payload
        resolved_payload["parsed_strategy_summary"] = dict(
            stored_payload.get("parsed_strategy_summary")
            or parsed_strategy.get("summary")
            or {}
        )
        resolved_payload["metrics"] = dict(metrics or {})
        resolved_payload["execution_model"] = dict(execution_model or {})
        resolved_payload["execution_assumptions"] = dict(execution_assumptions or {})
        resolved_payload["execution_assumptions_snapshot"] = dict(execution_assumptions_snapshot or {})
        resolved_payload["visualization"] = self._build_summary_visualization_payload(
            stored_visualization=stored_visualization,
            comparison=comparison,
            benchmark_curve=benchmark_curve,
            benchmark_summary=benchmark_summary,
            buy_and_hold_curve=buy_and_hold_curve,
            buy_and_hold_summary=buy_and_hold_summary,
            audit_rows=audit_rows,
            daily_return_series=daily_return_series,
            exposure_curve=exposure_curve,
        )
        resolved_payload["execution_trace"] = dict(execution_trace or {})
        resolved_payload["no_result_reason"] = stored_payload.get("no_result_reason", row.no_result_reason)
        resolved_payload["no_result_message"] = stored_payload.get("no_result_message", row.no_result_message)
        resolved_payload["ai_summary"] = stored_payload.get("ai_summary", ai_summary)
        resolved_payload["status_message"] = stored_payload.get("status_message")
        resolved_payload["status_history"] = list(stored_payload.get("status_history") or [])

        missing_fields = list(request_missing_fields)
        if not stored_payload:
            missing_fields.append("stored_summary")
        if not isinstance(stored_payload.get("parsed_strategy_summary"), dict) or not stored_payload.get("parsed_strategy_summary"):
            missing_fields.append("parsed_strategy_summary")
        if not isinstance(stored_payload.get("metrics"), dict) or not stored_payload.get("metrics"):
            missing_fields.append("metrics")
        if not isinstance(stored_payload.get("execution_model"), dict) or not stored_payload.get("execution_model"):
            missing_fields.append("execution_model")
        if not isinstance(stored_payload.get("execution_assumptions"), dict) or not stored_payload.get("execution_assumptions"):
            missing_fields.append("execution_assumptions")
        if not isinstance(stored_payload.get("execution_assumptions_snapshot"), dict) or not stored_payload.get("execution_assumptions_snapshot"):
            missing_fields.append("execution_assumptions_snapshot")
        if not isinstance(stored_visualization_raw, dict) or not stored_visualization:
            missing_fields.append("visualization")
        if not isinstance(stored_payload.get("execution_trace"), dict) or not stored_payload.get("execution_trace"):
            missing_fields.append("execution_trace")
        if "no_result_reason" not in stored_payload:
            missing_fields.append("no_result_reason")
        if "no_result_message" not in stored_payload:
            missing_fields.append("no_result_message")
        if "ai_summary" not in stored_payload:
            missing_fields.append("ai_summary")
        if "status_message" not in stored_payload:
            missing_fields.append("status_message")
        if "status_history" not in stored_payload or not isinstance(stored_payload.get("status_history"), list):
            missing_fields.append("status_history")

        deduped_missing_fields = self._dedupe_summary_missing_fields(missing_fields)
        if stored_payload:
            if deduped_missing_fields:
                return (
                    resolved_payload,
                    "row.summary_json+repaired_fields",
                    "stored_partial_repaired",
                    deduped_missing_fields,
                )
            return resolved_payload, "row.summary_json", "complete", []

        return (
            resolved_payload,
            "derived_from_stored_domains+row_columns",
            "legacy_derived",
            deduped_missing_fields,
        )

    def _trade_row_to_dict_with_diagnostics(
        self,
        trade: RuleBacktestTrade,
    ) -> tuple[Dict[str, Any], List[str]]:
        entry_payload = self._load_summary_payload(trade.entry_rule_json)
        exit_payload = self._load_summary_payload(trade.exit_rule_json)
        notes_payload = self._load_summary_payload(trade.notes)
        entry_rule = entry_payload.get("rule") or entry_payload
        exit_rule = exit_payload.get("rule") or exit_payload
        row = self._normalize_trade_row_payload(
            {
                "id": trade.id,
                "run_id": trade.run_id,
                "trade_index": trade.trade_index,
                "code": trade.code,
                "entry_signal_date": entry_payload.get("signal_date"),
                "exit_signal_date": exit_payload.get("signal_date"),
                "entry_date": trade.entry_date.isoformat() if trade.entry_date else None,
                "exit_date": trade.exit_date.isoformat() if trade.exit_date else None,
                "entry_price": trade.entry_price,
                "exit_price": trade.exit_price,
                "entry_signal": trade.entry_signal,
                "exit_signal": trade.exit_signal,
                "entry_trigger": entry_payload.get("trigger") or trade.entry_signal,
                "exit_trigger": exit_payload.get("trigger") or trade.exit_signal,
                "return_pct": trade.return_pct,
                "holding_days": trade.holding_days,
                "holding_bars": notes_payload.get("holding_bars", trade.holding_days),
                "holding_calendar_days": notes_payload.get("holding_calendar_days"),
                "entry_rule": entry_rule if isinstance(entry_rule, dict) else {},
                "exit_rule": exit_rule if isinstance(exit_rule, dict) else {},
                "entry_indicators": entry_payload.get("indicators") or {},
                "exit_indicators": exit_payload.get("indicators") or {},
                "entry_fill_basis": notes_payload.get("entry_fill_basis"),
                "exit_fill_basis": notes_payload.get("exit_fill_basis"),
                "signal_price_basis": notes_payload.get("signal_price_basis"),
                "price_basis": notes_payload.get("price_basis"),
                "fee_bps": notes_payload.get("fee_bps"),
                "slippage_bps": notes_payload.get("slippage_bps"),
                "entry_fee_amount": notes_payload.get("entry_fee_amount"),
                "exit_fee_amount": notes_payload.get("exit_fee_amount"),
                "entry_slippage_amount": notes_payload.get("entry_slippage_amount"),
                "exit_slippage_amount": notes_payload.get("exit_slippage_amount"),
                "notes": notes_payload.get("notes"),
            }
        )
        missing_fields = self._collect_trade_row_missing_fields(
            trade=trade,
            entry_payload=entry_payload,
            exit_payload=exit_payload,
            notes_payload=notes_payload,
        )
        return row, missing_fields

    def _resolve_trade_rows_payload(
        self,
        *,
        include_trades: bool,
        row: RuleBacktestRun,
        trades_override: Optional[List[Any]] = None,
    ) -> tuple[List[Dict[str, Any]], str, str, List[str]]:
        if not include_trades:
            return [], "omitted_without_detail_read", "omitted", []

        if trades_override is not None:
            normalized_rows = [
                self._normalize_trade_row_payload(dict(item or {}))
                for item in list(trades_override or [])
            ]
            if normalized_rows:
                return normalized_rows, "stored_rule_backtest_trades", "complete", []
            if int(row.trade_count or 0) > 0:
                return [], "unavailable", "unavailable", ["stored_trade_rows"]
            return [], "stored_rule_backtest_trades", "empty", []

        stored_trades = self.repo.get_trades_by_run(row.id)
        if stored_trades:
            normalized_rows: List[Dict[str, Any]] = []
            missing_fields: List[str] = []
            for trade in stored_trades:
                trade_row, trade_missing_fields = self._trade_row_to_dict_with_diagnostics(trade)
                normalized_rows.append(trade_row)
                missing_fields.extend(trade_missing_fields)
            deduped_missing_fields = self._dedupe_trade_row_missing_fields(missing_fields)
            if deduped_missing_fields:
                return (
                    normalized_rows,
                    "stored_rule_backtest_trades+compat_repair",
                    "stored_partial_repaired",
                    deduped_missing_fields,
                )
            return normalized_rows, "stored_rule_backtest_trades", "complete", []

        if int(row.trade_count or 0) > 0:
            return [], "unavailable", "unavailable", ["stored_trade_rows"]
        return [], "stored_rule_backtest_trades", "empty", []

    def _run_row_to_dict(
        self,
        row: RuleBacktestRun,
        *,
        include_trades: bool,
        trades_override: Optional[List[Any]] = None,
        equity_override: Optional[List[Any]] = None,
        parsed_override: Optional[Dict[str, Any]] = None,
        ai_summary_override: Optional[str] = None,
        summary_override: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        stored_summary = summary_override if summary_override is not None else self._load_summary_payload(row.summary_json)
        warnings = []
        if row.warnings_json:
            try:
                warnings = json.loads(row.warnings_json)
            except Exception:
                warnings = []
        (
            parsed_strategy,
            parsed_strategy_source,
            parsed_strategy_completeness,
            parsed_strategy_missing_fields,
        ) = self._resolve_parsed_strategy_payload(
            row=row,
            summary=stored_summary,
            warnings=warnings,
            parsed_override=parsed_override,
        )
        visualization = stored_summary.get("visualization") or {}
        trade_rows_override = trades_override if trades_override is not None else None
        (
            trade_rows,
            trade_rows_source,
            trade_rows_completeness,
            trade_rows_missing_fields,
        ) = self._resolve_trade_rows_payload(
            include_trades=include_trades,
            row=row,
            trades_override=trade_rows_override,
        )
        (
            equity_curve,
            equity_curve_source,
            equity_curve_completeness,
            equity_curve_missing_fields,
        ) = self._resolve_equity_curve_payload(
            include_trades=include_trades,
            row=row,
            visualization=visualization,
            equity_override=equity_override,
        )

        request = stored_summary.get("request") or {}
        (
            execution_model,
            execution_model_source,
            execution_model_completeness,
            execution_model_missing_fields,
        ) = self._resolve_execution_model_payload(
            summary=stored_summary,
            row=row,
            parsed_strategy=parsed_strategy,
        )
        derived_execution_assumptions = self._build_execution_assumptions_payload(
            execution_model=execution_model,
        )
        execution_assumptions_snapshot = self._resolve_execution_assumptions_snapshot(
            summary=stored_summary,
            derived_payload=derived_execution_assumptions,
        )
        execution_assumptions_source = str(
            execution_assumptions_snapshot.get("source")
            or self._describe_execution_assumptions_source(stored_summary)
        )
        execution_assumptions = dict(execution_assumptions_snapshot.get("payload") or {})
        (
            metrics,
            metrics_source,
            metrics_completeness,
            metrics_missing_fields,
        ) = self._resolve_run_metrics_payload(row=row, summary=stored_summary)
        stored_audit_rows = list(visualization.get("audit_rows") or [])
        replay_visualization = self._resolve_replay_visualization_payload(
            include_trades=include_trades,
            visualization=visualization,
            metrics=metrics,
            equity_curve=list(equity_curve or []),
            trade_rows=list(trade_rows or []),
        )
        comparison_metrics = dict((replay_visualization.get("comparison") or {}).get("metrics") or {})
        benchmark_curve = list(replay_visualization.get("benchmark_curve") or [])
        benchmark_summary = dict(replay_visualization.get("benchmark_summary") or {})
        buy_and_hold_curve = list(replay_visualization.get("buy_and_hold_curve") or [])
        buy_and_hold_summary = dict(replay_visualization.get("buy_and_hold_summary") or {})
        comparison_source = str(replay_visualization.get("comparison_source") or "unknown")
        comparison_completeness = str(replay_visualization.get("comparison_completeness") or "unknown")
        comparison_missing_sections = list(replay_visualization.get("comparison_missing_sections") or [])
        replay_payload_source = str(replay_visualization.get("replay_payload_source") or "unknown")
        replay_payload_completeness = str(replay_visualization.get("replay_payload_completeness") or "unknown")
        replay_payload_missing_sections = list(replay_visualization.get("replay_payload_missing_sections") or [])
        audit_rows = list(replay_visualization.get("audit_rows") or [])
        daily_return_series = list(replay_visualization.get("daily_return_series") or [])
        exposure_curve = list(replay_visualization.get("exposure_curve") or [])
        (
            execution_trace,
            execution_trace_source,
            execution_trace_completeness,
            execution_trace_missing_fields,
        ) = self._resolve_execution_trace_payload(
            include_trades=include_trades,
            summary=stored_summary,
            parsed_strategy=parsed_strategy or {},
            stored_audit_rows=stored_audit_rows,
            execution_model=execution_model,
            execution_assumptions=execution_assumptions,
            benchmark_summary=benchmark_summary,
        )
        (
            summary,
            summary_source,
            summary_completeness,
            summary_missing_fields,
        ) = self._resolve_summary_payload(
            row=row,
            stored_summary=stored_summary,
            parsed_strategy=parsed_strategy or {},
            metrics=metrics,
            execution_model=execution_model,
            execution_assumptions=execution_assumptions,
            execution_assumptions_snapshot=execution_assumptions_snapshot,
            comparison=dict(replay_visualization.get("comparison") or {}),
            benchmark_curve=benchmark_curve,
            benchmark_summary=benchmark_summary,
            buy_and_hold_curve=buy_and_hold_curve,
            buy_and_hold_summary=buy_and_hold_summary,
            audit_rows=audit_rows,
            daily_return_series=daily_return_series,
            exposure_curve=exposure_curve,
            execution_trace=execution_trace,
            ai_summary=ai_summary_override if ai_summary_override is not None else row.ai_summary,
        )
        request = summary.get("request") or {}
        result_authority = self._build_result_authority_payload(
            include_trades=include_trades,
            row=row,
            summary=summary,
            summary_source=summary_source,
            summary_completeness=summary_completeness,
            summary_missing_fields=summary_missing_fields,
            parsed_strategy_source=parsed_strategy_source,
            parsed_strategy_completeness=parsed_strategy_completeness,
            parsed_strategy_missing_fields=parsed_strategy_missing_fields,
            comparison_source=comparison_source,
            comparison_completeness=comparison_completeness,
            comparison_missing_sections=comparison_missing_sections,
            replay_payload_source=replay_payload_source,
            replay_payload_completeness=replay_payload_completeness,
            replay_payload_missing_sections=replay_payload_missing_sections,
            audit_rows_source=str(replay_visualization.get("audit_rows_source") or "unknown"),
            daily_return_series_source=str(
                replay_visualization.get("daily_return_series_source") or "unknown"
            ),
            exposure_curve_source=str(replay_visualization.get("exposure_curve_source") or "unknown"),
            metrics_source=metrics_source,
            metrics_completeness=metrics_completeness,
            metrics_missing_fields=metrics_missing_fields,
            execution_model_source=execution_model_source,
            execution_model_completeness=execution_model_completeness,
            execution_model_missing_fields=execution_model_missing_fields,
            execution_assumptions_source=execution_assumptions_source,
            execution_assumptions_snapshot_completeness=str(
                execution_assumptions_snapshot.get("completeness") or "unknown"
            ),
            execution_assumptions_snapshot_missing_keys=list(
                execution_assumptions_snapshot.get("missing_keys") or []
            ),
            trade_rows_source=trade_rows_source,
            trade_rows_completeness=trade_rows_completeness,
            trade_rows_missing_fields=trade_rows_missing_fields,
            equity_curve_source=equity_curve_source,
            equity_curve_completeness=equity_curve_completeness,
            equity_curve_missing_fields=equity_curve_missing_fields,
            execution_trace_source=execution_trace_source,
            execution_trace_completeness=execution_trace_completeness,
            execution_trace_missing_fields=execution_trace_missing_fields,
        )
        return {
            "id": row.id,
            "code": row.code,
            "strategy_text": row.strategy_text,
            "parsed_strategy": parsed_strategy or {},
            "strategy_hash": row.strategy_hash,
            "timeframe": row.timeframe,
            "start_date": request.get("start_date"),
            "end_date": request.get("end_date"),
            "period_start": metrics.get("period_start"),
            "period_end": metrics.get("period_end"),
            "lookback_bars": row.lookback_bars,
            "initial_capital": row.initial_capital,
            "fee_bps": row.fee_bps,
            "slippage_bps": float(request.get("slippage_bps") or 0.0),
            "parsed_confidence": row.parsed_confidence,
            "needs_confirmation": row.needs_confirmation,
            "warnings": warnings,
            "run_at": row.run_at.isoformat() if row.run_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "status": row.status,
            "status_message": summary.get("status_message"),
            "status_history": list(summary.get("status_history") or []),
            "no_result_reason": row.no_result_reason,
            "no_result_message": row.no_result_message,
            "trade_count": metrics.get("trade_count"),
            "win_count": metrics.get("win_count"),
            "loss_count": metrics.get("loss_count"),
            "total_return_pct": metrics.get("total_return_pct"),
            "annualized_return_pct": metrics.get("annualized_return_pct"),
            "benchmark_mode": request.get("benchmark_mode"),
            "benchmark_code": request.get("benchmark_code"),
            "benchmark_return_pct": comparison_metrics.get("benchmark_return_pct"),
            "excess_return_vs_benchmark_pct": comparison_metrics.get("excess_return_vs_benchmark_pct"),
            "buy_and_hold_return_pct": comparison_metrics.get("buy_and_hold_return_pct"),
            "excess_return_vs_buy_and_hold_pct": comparison_metrics.get("excess_return_vs_buy_and_hold_pct"),
            "win_rate_pct": metrics.get("win_rate_pct"),
            "avg_trade_return_pct": metrics.get("avg_trade_return_pct"),
            "max_drawdown_pct": metrics.get("max_drawdown_pct"),
            "avg_holding_days": metrics.get("avg_holding_days"),
            "avg_holding_bars": metrics.get("avg_holding_bars"),
            "avg_holding_calendar_days": metrics.get("avg_holding_calendar_days"),
            "final_equity": metrics.get("final_equity"),
            "summary": summary,
            "execution_model": execution_model,
            "execution_assumptions": execution_assumptions,
            "execution_assumptions_snapshot": execution_assumptions_snapshot,
            "benchmark_curve": benchmark_curve,
            "benchmark_summary": benchmark_summary,
            "buy_and_hold_curve": buy_and_hold_curve,
            "buy_and_hold_summary": buy_and_hold_summary,
            "audit_rows": audit_rows,
            "daily_return_series": daily_return_series,
            "exposure_curve": exposure_curve,
            "ai_summary": ai_summary_override if ai_summary_override is not None else row.ai_summary,
            "equity_curve": equity_curve,
            "trades": trade_rows,
            "execution_trace": execution_trace,
            "result_authority": result_authority,
        }

    def _trade_row_to_dict(self, trade: RuleBacktestTrade) -> Dict[str, Any]:
        trade_row, _ = self._trade_row_to_dict_with_diagnostics(trade)
        return trade_row

    @staticmethod
    def _dedupe_equity_curve_missing_fields(missing_fields: List[str]) -> List[str]:
        requested = [str(item or "").strip() for item in (missing_fields or []) if str(item or "").strip()]
        ordered_fields = [field for field in list(EQUITY_CURVE_FIELD_ORDER) + ["stored_equity_curve"] if field in requested]
        seen = set()
        deduped: List[str] = []
        for field in ordered_fields + requested:
            normalized = str(field or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped

    @classmethod
    def _normalize_equity_curve_point_payload(
        cls,
        point: Dict[str, Any],
    ) -> tuple[Optional[Dict[str, Any]], List[str]]:
        payload = dict(point or {})
        missing_fields: List[str] = []

        def _normalize_date(value: Any) -> Optional[str]:
            if value in (None, ""):
                return None
            if hasattr(value, "isoformat"):
                try:
                    return str(value.isoformat())
                except Exception:
                    return str(value)
            return str(value)

        def _normalize_text(value: Any) -> Optional[str]:
            if value is None:
                return None
            normalized = str(value).strip()
            return normalized or None

        def _normalize_float(value: Any) -> Optional[float]:
            normalized = _safe_float(value)
            return round(float(normalized), 6) if normalized is not None else None

        def _resolve_field(
            field: str,
            *,
            aliases: Optional[List[str]] = None,
            value_type: str = "float",
        ) -> Any:
            candidates = [field] + [alias for alias in (aliases or []) if alias]
            for index, candidate in enumerate(candidates):
                if candidate not in payload:
                    continue
                raw_value = payload.get(candidate)
                if value_type == "text":
                    normalized_value = _normalize_text(raw_value)
                elif value_type == "date":
                    normalized_value = _normalize_date(raw_value)
                else:
                    normalized_value = _normalize_float(raw_value)
                if index > 0:
                    missing_fields.append(field)
                return normalized_value

            missing_fields.append(field)
            return None

        normalized: Dict[str, Any] = {
            "date": _resolve_field("date", value_type="date"),
            "equity": _resolve_field("equity", aliases=["total_portfolio_value"]),
            "cumulative_return_pct": _resolve_field("cumulative_return_pct", aliases=["cumulative_return"]),
            "drawdown_pct": _resolve_field("drawdown_pct"),
            "close": _resolve_field("close", aliases=["symbol_close"]),
            "signal_summary": _resolve_field("signal_summary", value_type="text"),
            "target_position": _resolve_field("target_position", aliases=["position"]),
            "executed_action": _resolve_field("executed_action", aliases=["action", "event_type"], value_type="text"),
            "fill_price": _resolve_field("fill_price"),
            "shares_held": _resolve_field("shares_held", aliases=["shares"]),
            "cash": _resolve_field("cash"),
            "holdings_value": _resolve_field("holdings_value"),
            "total_portfolio_value": _resolve_field("total_portfolio_value", aliases=["equity"]),
            "position_state": _resolve_field("position_state", value_type="text"),
            "exposure_pct": _resolve_field("exposure_pct", aliases=["position", "target_position"]),
            "fee_amount": _resolve_field("fee_amount", aliases=["fees"]),
            "slippage_amount": _resolve_field("slippage_amount", aliases=["slippage"]),
            "notes": _resolve_field("notes", value_type="text"),
        }

        if not normalized.get("date"):
            return None, cls._dedupe_equity_curve_missing_fields(missing_fields)

        if normalized.get("equity") is None and normalized.get("total_portfolio_value") is None:
            missing_fields.extend(["equity", "total_portfolio_value"])
            return None, cls._dedupe_equity_curve_missing_fields(missing_fields)

        if normalized.get("equity") is None and normalized.get("total_portfolio_value") is not None:
            normalized["equity"] = normalized["total_portfolio_value"]
            missing_fields.append("equity")
        if normalized.get("total_portfolio_value") is None and normalized.get("equity") is not None:
            normalized["total_portfolio_value"] = normalized["equity"]
            missing_fields.append("total_portfolio_value")

        return normalized, cls._dedupe_equity_curve_missing_fields(missing_fields)

    @classmethod
    def _normalize_equity_curve_payload(
        cls,
        equity_curve: List[Any],
    ) -> tuple[List[Dict[str, Any]], List[str]]:
        normalized_rows: List[Dict[str, Any]] = []
        missing_fields: List[str] = []
        for point in list(equity_curve or []):
            if not isinstance(point, dict):
                missing_fields.append("stored_equity_curve")
                continue
            normalized_point, point_missing_fields = cls._normalize_equity_curve_point_payload(point)
            missing_fields.extend(point_missing_fields)
            if normalized_point is not None:
                normalized_rows.append(normalized_point)
        return normalized_rows, cls._dedupe_equity_curve_missing_fields(missing_fields)

    @classmethod
    def _build_equity_curve_from_audit_rows(
        cls,
        audit_rows: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        curve: List[Dict[str, Any]] = []
        for audit_row in list(audit_rows or []):
            point_date = audit_row.get("date")
            total_portfolio_value = _safe_float(audit_row.get("total_portfolio_value"))
            if not point_date or total_portfolio_value is None:
                continue
            position_value = _safe_float(audit_row.get("position"))
            normalized_point, _ = cls._normalize_equity_curve_point_payload(
                {
                    "date": point_date,
                    "equity": total_portfolio_value,
                    "cumulative_return_pct": audit_row.get("cumulative_return"),
                    "drawdown_pct": audit_row.get("drawdown_pct"),
                    "close": audit_row.get("symbol_close"),
                    "signal_summary": audit_row.get("signal_summary"),
                    "target_position": position_value,
                    "executed_action": audit_row.get("action"),
                    "fill_price": audit_row.get("fill_price"),
                    "shares_held": audit_row.get("shares"),
                    "cash": audit_row.get("cash"),
                    "holdings_value": audit_row.get("holdings_value"),
                    "total_portfolio_value": total_portfolio_value,
                    "position_state": audit_row.get("position_state"),
                    "exposure_pct": position_value,
                    "fee_amount": audit_row.get("fees"),
                    "slippage_amount": audit_row.get("slippage"),
                    "notes": audit_row.get("notes"),
                }
            )
            if normalized_point is not None:
                curve.append(normalized_point)
        return curve

    def _resolve_equity_curve_payload(
        self,
        *,
        include_trades: bool,
        row: RuleBacktestRun,
        visualization: Dict[str, Any],
        equity_override: Optional[List[Any]] = None,
    ) -> tuple[List[Dict[str, Any]], str, str, List[str]]:
        if not include_trades:
            return [], "omitted_without_detail_read", "omitted", []

        stored_audit_rows_raw = visualization.get("audit_rows")
        stored_audit_rows = list(stored_audit_rows_raw or []) if isinstance(stored_audit_rows_raw, list) else []

        stored_payload = equity_override if equity_override is not None else None
        stored_payload_present = equity_override is not None
        if stored_payload is None and row.equity_curve_json:
            try:
                loaded_payload = json.loads(row.equity_curve_json)
                if isinstance(loaded_payload, list):
                    stored_payload = loaded_payload
                    stored_payload_present = True
                else:
                    stored_payload_present = True
            except Exception:
                stored_payload_present = True

        if isinstance(stored_payload, list):
            normalized_curve, missing_fields = self._normalize_equity_curve_payload(list(stored_payload or []))
            if normalized_curve:
                source = "row.equity_curve_json+repaired_fields" if missing_fields else "row.equity_curve_json"
                completeness = "stored_partial_repaired" if missing_fields else "complete"
                return normalized_curve, source, completeness, missing_fields
            if stored_payload == []:
                if stored_audit_rows:
                    return (
                        self._build_equity_curve_from_audit_rows(stored_audit_rows),
                        "derived_from_summary.visualization.audit_rows",
                        "legacy_rebuilt",
                        [],
                    )
                return [], "row.equity_curve_json", "empty", []

        if stored_audit_rows:
            derived_curve = self._build_equity_curve_from_audit_rows(stored_audit_rows)
            if derived_curve:
                return (
                    derived_curve,
                    "derived_from_summary.visualization.audit_rows",
                    "legacy_rebuilt",
                    [],
                )

        if stored_payload_present:
            return [], "unavailable", "unavailable", ["stored_equity_curve"]
        return [], "unavailable", "unavailable", ["stored_equity_curve"]

    def export_execution_trace_csv(self, run_id: int, output_path: str) -> str:
        run = self.get_run(run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found.")

        destination = Path(output_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        execution_trace = dict(run.get("execution_trace") or {})
        export_rows = self._build_execution_trace_export_rows(execution_trace)
        if not export_rows:
            raise ValueError(f"Run {run_id} has no audit rows to export.")

        import csv

        fieldnames = [label for _, label in TRACE_EXPORT_COLUMNS]
        with destination.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(export_rows)
        return str(destination)

    def export_execution_trace_json(self, run_id: int, output_path: str) -> str:
        run = self.get_run(run_id)
        if run is None:
            raise ValueError(f"Run {run_id} not found.")

        destination = Path(output_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        execution_trace = dict(run.get("execution_trace") or {})
        export_rows = self._build_execution_trace_export_rows(execution_trace)
        if not export_rows:
            raise ValueError(f"Run {run_id} has no audit rows to export.")

        destination.write_text(
            json.dumps(
                {
                    "version": execution_trace.get("version"),
                    "source": execution_trace.get("source"),
                    "completeness": execution_trace.get("completeness"),
                    "missing_fields": list(execution_trace.get("missing_fields") or []),
                    "trace_rows": export_rows,
                    "assumptions": dict(execution_trace.get("assumptions_defaults") or {}),
                    "execution_model": dict(execution_trace.get("execution_model") or {}),
                    "execution_assumptions": dict(execution_trace.get("execution_assumptions") or {}),
                    "fallback": dict(execution_trace.get("fallback") or {}),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return str(destination)

    def parse_and_run_automated(
        self,
        *,
        code: str,
        strategy_text: str,
        start_date: Optional[Any] = None,
        end_date: Optional[Any] = None,
        lookback_bars: int = 252,
        initial_capital: float = 100000.0,
        fee_bps: float = 0.0,
        slippage_bps: float = 0.0,
        benchmark_mode: str = BENCHMARK_MODE_AUTO,
        benchmark_code: Optional[str] = None,
        confirmed: bool = True,
    ) -> Dict[str, Any]:
        return self.run_backtest(
            code=code,
            strategy_text=strategy_text,
            parsed_strategy=None,
            start_date=start_date,
            end_date=end_date,
            lookback_bars=lookback_bars,
            initial_capital=initial_capital,
            fee_bps=fee_bps,
            slippage_bps=slippage_bps,
            benchmark_mode=benchmark_mode,
            benchmark_code=benchmark_code,
            confirmed=confirmed,
        )


def run_backtest_automated(
    symbol: str,
    scenario: str,
    initial_capital: float = 100000.0,
    output_dir: str = "./backtest_outputs",
) -> Dict[str, Any]:
    service = RuleBacktestService()
    strategy_text = AUTOMATED_SCENARIO_STRATEGIES.get(str(scenario or "").strip(), str(scenario or "").strip())
    if not strategy_text:
        raise ValueError("scenario is required")

    result = service.parse_and_run_automated(
        code=symbol,
        strategy_text=strategy_text,
        initial_capital=initial_capital,
        confirmed=True,
    )
    run_id = int(result["id"])
    output_root = Path(output_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    stem = f"{str(symbol).upper()}_{run_id}"
    csv_path = output_root / f"{stem}_execution_trace.csv"
    json_path = output_root / f"{stem}_execution_trace.json"
    service.export_execution_trace_csv(run_id, str(csv_path))
    service.export_execution_trace_json(run_id, str(json_path))
    return {
        "run_id": run_id,
        "scenario": scenario,
        "result": result,
        "csv_path": str(csv_path),
        "json_path": str(json_path),
    }
