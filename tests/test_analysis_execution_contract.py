from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import main as runtime_main
from src.contracts.analysis_execution import (
    AnalysisExecutionResult,
    AnalysisExecutionStatus,
)
from src.core.pipeline import StockAnalysisPipeline


def _args(**overrides: object) -> SimpleNamespace:
    values = {
        "force_run": False,
        "no_market_review": True,
        "workers": 1,
        "dry_run": False,
        "no_notify": True,
        "single_notify": False,
        "no_context_snapshot": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _config(**overrides: object) -> SimpleNamespace:
    values = {
        "log_dir": None,
        "log_level": "INFO",
        "trading_day_check_enabled": True,
        "market_review_enabled": False,
        "market_review_region": "cn",
        "merge_email_notification": False,
        "single_stock_notify": False,
        "analysis_delay": 0,
        "backtest_enabled": False,
        "stock_list": ["000001"],
        "schedule_enabled": False,
        "scanner_schedule_enabled": False,
        "watchlist_score_refresh_enabled": False,
        "schedule_time": "09:00",
        "schedule_run_immediately": False,
        "run_immediately": False,
        "webui_enabled": False,
        "validate": lambda: [],
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _main_args(**overrides: object) -> SimpleNamespace:
    values = {
        "debug": False,
        "stocks": None,
        "serve": False,
        "serve_only": False,
        "host": "127.0.0.1",
        "port": 8123,
        "backtest": False,
        "backtest_code": None,
        "backtest_force": False,
        "backtest_days": None,
        "market_review": False,
        "scanner": False,
        "scanner_schedule": False,
        "schedule": False,
        "no_run_immediately": True,
        "force_run": False,
        "no_notify": True,
        "no_market_review": True,
        "dry_run": False,
        "single_notify": False,
        "workers": 1,
        "no_context_snapshot": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _pipeline(process_result: object, report_path: object = "/tmp/report.md") -> StockAnalysisPipeline:
    pipeline = StockAnalysisPipeline.__new__(StockAnalysisPipeline)
    pipeline.max_workers = 1
    pipeline.fetcher_manager = MagicMock()
    pipeline.db = MagicMock()
    pipeline.db.has_today_data.return_value = True
    pipeline.notifier = MagicMock()
    pipeline.notifier.save_report_to_file.return_value = report_path
    pipeline._generate_aggregate_report = MagicMock(return_value="# report")
    pipeline.process_single_stock = MagicMock(return_value=process_result)
    pipeline.config = SimpleNamespace(
        stock_list=["000001"],
        refresh_stock_list=lambda: None,
        single_stock_notify=False,
        report_type="simple",
        analysis_delay=0,
    )
    return pipeline


def test_pipeline_total_stock_analysis_failure_is_failed() -> None:
    result = _pipeline(None).run(stock_codes=["000001"], send_notification=False)

    assert result.status is AnalysisExecutionStatus.FAILED
    assert result.reason == "no_valid_stock_results"


def test_pipeline_report_persistence_failure_is_failed() -> None:
    pipeline = _pipeline(SimpleNamespace(success=True))
    pipeline.notifier.save_report_to_file.side_effect = OSError("disk full")

    result = pipeline.run(stock_codes=["000001"], send_notification=False)

    assert result.status is AnalysisExecutionStatus.FAILED
    assert result.reason == "stock_report_persistence_failed"
    assert len(result.results) == 1


def test_pipeline_success_requires_a_durable_report_path() -> None:
    result = _pipeline(SimpleNamespace(success=True)).run(
        stock_codes=["000001"], send_notification=False
    )

    assert result.status is AnalysisExecutionStatus.SUCCESS
    assert result.report_path == "/tmp/report.md"


def test_pipeline_partial_stock_failure_preserves_report_but_fails_execution() -> None:
    pipeline = _pipeline(SimpleNamespace(success=True))
    pipeline.process_single_stock.side_effect = [
        SimpleNamespace(success=True),
        None,
    ]

    result = pipeline.run(
        stock_codes=["000001", "000002"],
        send_notification=False,
    )

    assert result.status is AnalysisExecutionStatus.FAILED
    assert result.reason == "stock_analysis_partial_failure"
    assert result.report_path == "/tmp/report.md"
    assert len(result.results) == 1
    assert result.failed_count == 1


def test_run_full_analysis_preserves_market_closed_skip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runtime_main,
        "_compute_trading_day_filter",
        lambda _config, _args, _codes: ([], None, True),
    )

    result = runtime_main.run_full_analysis(
        _config(stock_list=[]), _args(), stock_codes=[]
    )

    assert result.status is AnalysisExecutionStatus.SKIPPED
    assert result.reason == "markets_closed"


def test_run_full_analysis_market_review_without_report_is_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.core import market_review as market_review_module

    review_notifier = MagicMock()
    review_notifier.save_report_to_file.return_value = None
    review_analyzer = MagicMock()
    review_analyzer.run_daily_review.return_value = "generated report"
    monkeypatch.setattr(
        market_review_module,
        "get_config",
        lambda: SimpleNamespace(market_review_region="cn"),
    )
    monkeypatch.setattr(
        market_review_module,
        "MarketAnalyzer",
        lambda **_kwargs: review_analyzer,
    )
    assert market_review_module.run_market_review(review_notifier, send_notification=False) is None

    pipeline = _pipeline(None)
    pipeline.notifier = MagicMock()
    pipeline.analyzer = None
    pipeline.search_service = None
    monkeypatch.setattr(runtime_main, "StockAnalysisPipeline", lambda **_kwargs: pipeline)
    monkeypatch.setattr(
        runtime_main,
        "_compute_trading_day_filter",
        lambda _config, _args, codes: (list(codes), "cn", False),
    )
    monkeypatch.setattr(runtime_main, "run_market_review", lambda **_kwargs: None)

    result = runtime_main.run_full_analysis(
        _config(market_review_enabled=True),
        _args(no_market_review=False),
        stock_codes=[],
    )

    assert result.status is AnalysisExecutionStatus.FAILED
    assert result.reason == "market_review_report_missing"


def test_run_full_analysis_combined_failure_keeps_successful_market_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline = _pipeline(None)
    pipeline.notifier = MagicMock()
    pipeline.analyzer = None
    pipeline.search_service = None
    monkeypatch.setattr(runtime_main, "StockAnalysisPipeline", lambda **_kwargs: pipeline)
    monkeypatch.setattr(
        runtime_main,
        "_compute_trading_day_filter",
        lambda _config, _args, codes: (list(codes), "cn", False),
    )
    monkeypatch.setattr(runtime_main, "run_market_review", lambda **_kwargs: "market report")

    result = runtime_main.run_full_analysis(
        _config(market_review_enabled=True),
        _args(no_market_review=False),
        stock_codes=["000001"],
    )

    assert result.status is AnalysisExecutionStatus.FAILED
    assert "no_valid_stock_results" in (result.reason or "")
    assert result.market_report == "market report"


def test_run_full_analysis_notification_failure_does_not_discard_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valid_result = SimpleNamespace(
        success=True,
        sentiment_score=1,
        name="Test",
        code="000001",
        operation_advice="observe",
        trend_prediction="flat",
        get_emoji=lambda: "-",
    )
    pipeline = _pipeline(valid_result, report_path="/tmp/stock.md")
    pipeline.notifier.is_available.return_value = True
    pipeline.notifier.send.return_value = False
    pipeline.analyzer = None
    pipeline.search_service = None
    monkeypatch.setattr(runtime_main, "StockAnalysisPipeline", lambda **_kwargs: pipeline)
    monkeypatch.setattr(
        runtime_main,
        "_compute_trading_day_filter",
        lambda _config, _args, codes: (list(codes), "cn", False),
    )
    monkeypatch.setattr(runtime_main, "run_market_review", lambda **_kwargs: "market report")

    result = runtime_main.run_full_analysis(
        _config(market_review_enabled=True, merge_email_notification=True),
        _args(no_market_review=False, no_notify=False),
        stock_codes=["000001"],
    )

    assert result.status is AnalysisExecutionStatus.SUCCESS
    assert result.report_path == "/tmp/stock.md"
    assert result.market_report == "market report"


def test_scheduler_observes_failed_analysis_result() -> None:
    from src.scheduler import Scheduler

    scheduler = Scheduler.__new__(Scheduler)
    scheduler._failed_task_labels = []
    scheduler_result = AnalysisExecutionResult.failed("no_valid_stock_results")

    result = scheduler._safe_run_task(lambda: scheduler_result, "analysis")

    assert result is scheduler_result
    assert scheduler.failed_task_labels == ("analysis",)


def test_bot_batch_consumes_typed_analysis_result(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from bot.commands.batch import BatchCommand

    class FakePipeline:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def run(self, **_kwargs: object) -> AnalysisExecutionResult:
            return AnalysisExecutionResult.success(
                results=[SimpleNamespace(success=True)],
                report_path="/tmp/report.md",
            )

    monkeypatch.setattr(runtime_main, "StockAnalysisPipeline", FakePipeline)
    monkeypatch.setattr(
        "src.config.get_config",
        lambda: SimpleNamespace(),
    )

    with caplog.at_level("INFO"):
        BatchCommand()._run_batch_analysis(["000001"], SimpleNamespace())

    assert "成功 1 只" in caplog.text


def test_main_maps_failed_one_shot_analysis_to_nonzero_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    args = _main_args()
    config = _config(run_immediately=True, webui_enabled=False)
    monkeypatch.setattr(runtime_main, "parse_arguments", lambda: args)
    monkeypatch.setattr(runtime_main, "get_config", lambda: config)
    monkeypatch.setattr(runtime_main, "setup_logging", lambda **_kwargs: None)
    monkeypatch.setattr(
        runtime_main,
        "run_full_analysis",
        lambda *_args: AnalysisExecutionResult.failed("no_valid_stock_results"),
    )

    assert runtime_main.main() == 1


def test_main_maps_market_review_without_report_to_nonzero_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    args = _main_args(market_review=True, no_market_review=False)
    config = _config(
        run_immediately=False,
        trading_day_check_enabled=False,
        gemini_api_key=None,
        openai_api_key=None,
        has_search_capability_enabled=lambda: False,
    )
    monkeypatch.setattr(runtime_main, "parse_arguments", lambda: args)
    monkeypatch.setattr(runtime_main, "get_config", lambda: config)
    monkeypatch.setattr(runtime_main, "setup_logging", lambda **_kwargs: None)
    monkeypatch.setattr("src.notification.NotificationService", lambda: MagicMock())
    monkeypatch.setattr("src.core.market_review.run_market_review", lambda **_kwargs: None)

    assert runtime_main.main() == 1


def test_service_stays_alive_but_reports_startup_analysis_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    args = _main_args(serve=True)
    config = _config(run_immediately=True, webui_enabled=False)
    monkeypatch.setattr(runtime_main, "parse_arguments", lambda: args)
    monkeypatch.setattr(runtime_main, "get_config", lambda: config)
    monkeypatch.setattr(runtime_main, "setup_logging", lambda **_kwargs: None)

    class Handle:
        def __init__(self) -> None:
            self.stop_calls = 0

        def stop_and_join(self, timeout: float = 10.0) -> bool:
            self.stop_calls += 1
            return True

    handle = Handle()
    monkeypatch.setattr(runtime_main, "prepare_webui_frontend_assets", lambda: True)
    monkeypatch.setattr(runtime_main, "start_api_server", lambda **_kwargs: handle)
    monkeypatch.setattr(runtime_main, "start_bot_stream_clients", lambda _config: None)
    monkeypatch.setattr(
        runtime_main,
        "run_full_analysis",
        lambda *_args: AnalysisExecutionResult.failed("no_valid_stock_results"),
    )
    monkeypatch.setattr(
        runtime_main.time,
        "sleep",
        lambda _seconds: (_ for _ in ()).throw(KeyboardInterrupt()),
    )

    assert runtime_main.main() == 1
    assert handle.stop_calls == 1
