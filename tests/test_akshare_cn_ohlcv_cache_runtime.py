from __future__ import annotations

import json
from decimal import Decimal
from datetime import date

import pandas as pd

from src.config import Config
from src.repositories.stock_repo import StockRepository
from src.services.akshare_cn_ohlcv_cache import (
    AKSHARE_CN_DAILY_SOURCE,
    LOCAL_CN_DB_SOURCE,
    AkshareCnOhlcvRuntime,
    _normalize_ohlcv_frame,
    build_akshare_cn_ohlcv_runtime_status,
    historical_ohlcv_runtime_enabled,
)
from src.portfolio_exact_numeric import STOCK_DAILY_CLOSE_PROVENANCE_ATTR
from src.services.historical_ohlcv_readiness import (
    HistoricalOhlcvReadinessRequest,
    HistoricalOhlcvReadinessService,
)
from src.services.historical_ohlcv_runtime_adapter import HistoricalOhlcvRuntimeAdapter
from src.services.stock_service import StockService
from src.storage import DatabaseManager
from unittest.mock import patch


class _FakeAkshareFetcher:
    def __init__(self, frame: pd.DataFrame | None = None, error: Exception | None = None) -> None:
        self.frame = frame if frame is not None else _akshare_frame(5)
        self.error = error
        self.calls: list[dict[str, object]] = []

    def get_daily_data(self, stock_code: str, start_date=None, end_date=None, days: int = 30) -> pd.DataFrame:
        self.calls.append(
            {
                "stock_code": stock_code,
                "start_date": start_date,
                "end_date": end_date,
                "days": days,
            }
        )
        if self.error is not None:
            raise self.error
        return self.frame.copy()


def _repo(tmp_path) -> StockRepository:
    DatabaseManager.reset_instance()
    db = DatabaseManager(db_url=f"sqlite:///{tmp_path / 'stock-cache.db'}")
    return StockRepository(db)


def _akshare_frame(
    count: int,
    *,
    start: str = "2026-01-01",
    close_tokens: list[str | Decimal] | None = None,
) -> pd.DataFrame:
    dates = pd.date_range(start=start, periods=count, freq="D")
    close = close_tokens if close_tokens is not None else [100.5 + index for index in range(count)]
    return pd.DataFrame(
        {
            "date": dates,
            "code": ["600519"] * count,
            "open": [100.0 + index for index in range(count)],
            "high": [101.0 + index for index in range(count)],
            "low": [99.0 + index for index in range(count)],
            "close": close,
            "volume": [1000.0 + index for index in range(count)],
            "amount": [100_000.0 + index for index in range(count)],
            "pct_chg": [0.0] * count,
        }
    )


def test_default_disabled_runtime_returns_safe_status_without_provider_call(tmp_path) -> None:
    fetcher = _FakeAkshareFetcher(error=AssertionError("provider call attempted"))
    runtime = AkshareCnOhlcvRuntime(
        enabled=False,
        repository=_repo(tmp_path),
        dependency_checker=lambda: True,
        fetcher_factory=lambda: fetcher,
    )

    payload = runtime.get_history_data("600519", days=30)
    status = build_akshare_cn_ohlcv_runtime_status(enabled=False, dependency_checker=lambda: True)

    assert fetcher.calls == []
    assert payload["data"] == []
    assert payload["source"] == "unavailable"
    assert payload["diagnostics"]["status"] == "disabled"
    assert payload["diagnostics"]["reason"] == "disabled_by_config"
    assert status["runtimeStatus"] == "disabled"
    assert status["externalProviderCalls"] is False
    assert status["consumerSafe"] is True


def test_stock_service_default_disabled_cn_history_skips_general_fetcher_manager(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "stock-service.db"
    monkeypatch.delenv("WOLFYSTOCK_HISTORICAL_OHLCV_RUNTIME_ENABLED", raising=False)
    monkeypatch.setenv("DATABASE_PATH", str(database_path))
    Config.reset_instance()
    DatabaseManager.reset_instance()

    try:
        with patch("data_provider.base.DataFetcherManager", side_effect=AssertionError("general provider manager called")):
            payload = StockService().get_history_data("600519", days=30)
        assert database_path.is_file()
    finally:
        DatabaseManager.reset_instance()
        Config.reset_instance()

    assert payload["data"] == []
    assert payload["source"] == "unavailable"
    assert payload["diagnostics"]["status"] == "disabled"
    assert payload["diagnostics"]["reason"] == "disabled_by_config"


def test_process_scoped_cn_runtime_activation_is_read_without_cached_settings(tmp_path) -> None:
    fetcher = _FakeAkshareFetcher(error=AssertionError("provider call attempted"))
    runtime = AkshareCnOhlcvRuntime(
        repository=_repo(tmp_path),
        dependency_checker=lambda: False,
        fetcher_factory=lambda: fetcher,
    )

    payload = runtime.get_history_data("600519", days=30)

    expected_status = "dependency_missing" if historical_ohlcv_runtime_enabled() else "disabled"
    assert payload["diagnostics"]["status"] == expected_status
    assert fetcher.calls == []


def test_enabled_runtime_dependency_missing_returns_safe_status_without_provider_call(tmp_path) -> None:
    fetcher = _FakeAkshareFetcher(error=AssertionError("provider call attempted"))
    runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=_repo(tmp_path),
        dependency_checker=lambda: False,
        fetcher_factory=lambda: fetcher,
    )

    payload = runtime.get_history_data("600519", days=30)
    status = build_akshare_cn_ohlcv_runtime_status(enabled=True, dependency_checker=lambda: False)

    assert fetcher.calls == []
    assert payload["data"] == []
    assert payload["source"] == "unavailable"
    assert payload["diagnostics"]["status"] == "dependency_missing"
    assert payload["diagnostics"]["reason"] == "dependency_missing"
    assert status["runtimeStatus"] == "dependency_missing"
    assert "token" not in json.dumps(status, ensure_ascii=False).lower()


def test_fake_akshare_response_normalizes_persists_and_flows_through_historical_adapter(tmp_path) -> None:
    close_tokens = [Decimal("100.5") + Decimal(index) for index in range(8)]
    fetcher = _FakeAkshareFetcher(_akshare_frame(8, close_tokens=close_tokens))
    runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=_repo(tmp_path),
        dependency_checker=lambda: True,
        fetcher_factory=lambda: fetcher,
    )

    adapter = HistoricalOhlcvRuntimeAdapter(history_runtime=runtime)
    result = HistoricalOhlcvReadinessService(provider=adapter).fetch(
        HistoricalOhlcvReadinessRequest(
            symbol="600519",
            market="cn",
            timeframe="1d",
            required_bars=5,
            require_adjusted=True,
        )
    )

    assert fetcher.calls == [{"stock_code": "600519", "start_date": None, "end_date": None, "days": 5}]
    assert len(result.bars) == 5
    assert result.bars[0].as_dict() == {
        "date": "2026-01-04",
        "open": 103.0,
        "high": 104.0,
        "low": 102.0,
        "close": 103.5,
        "volume": 1003.0,
        "adjustedClose": 103.5,
    }
    assert result.readiness["providerState"] == "available"
    assert result.readiness["adjustmentState"] == "available"
    assert result.readiness["overallState"] == "ready"


def test_malformed_close_provenance_is_not_reconstructed() -> None:
    frame = _akshare_frame(2, close_tokens=["9007199254740993.12345678", "9007199254740994.12345678"])
    frame.attrs[STOCK_DAILY_CLOSE_PROVENANCE_ATTR] = ["not", "a mapping"]

    normalized = _normalize_ohlcv_frame(frame, "600519")

    assert normalized.empty


def test_local_cache_hit_avoids_second_akshare_provider_call(tmp_path) -> None:
    repo = _repo(tmp_path)
    close_tokens = [f"{9007199254740993 + index}.12345678" for index in range(6)]
    first_fetcher = _FakeAkshareFetcher(_akshare_frame(6, close_tokens=close_tokens))
    first_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: first_fetcher,
    )
    first_payload = first_runtime.get_history_data("600519", days=5)

    second_fetcher = _FakeAkshareFetcher(error=AssertionError("provider call attempted"))
    second_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: second_fetcher,
    )
    second_payload = second_runtime.get_history_data("600519", days=5)

    assert first_fetcher.calls == [{"stock_code": "600519", "start_date": None, "end_date": None, "days": 5}]
    assert second_fetcher.calls == []
    assert first_payload["source"] == AKSHARE_CN_DAILY_SOURCE
    assert first_payload["diagnostics"]["cacheWriteState"] == "persisted"
    assert second_payload["source"] == LOCAL_CN_DB_SOURCE
    assert second_payload["diagnostics"]["cacheWriteState"] == "not_applicable"
    assert repo.get_recent_daily_rows(code="600519", limit=1)[0].close == Decimal(close_tokens[-1])
    assert [row["date"] for row in second_payload["data"]] == [
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
        "2026-01-06",
    ]


def test_cache_update_is_reported_as_persisted_after_exact_readback(tmp_path) -> None:
    repo = _repo(tmp_path)
    first_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: _FakeAkshareFetcher(
            _akshare_frame(2, close_tokens=["100.00000000", "101.00000000"])
        ),
    )
    first_runtime.get_history_data("600519", days=2)

    updated_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: _FakeAkshareFetcher(
            _akshare_frame(2, close_tokens=["110.00000000", "111.00000000"])
        ),
    )
    with patch.object(updated_runtime, "_load_cache", return_value=None):
        updated_payload = updated_runtime.get_history_data("600519", days=2)

    stored_rows = list(reversed(repo.get_recent_daily_rows(code="600519", limit=2)))
    assert updated_payload["diagnostics"]["cacheWriteState"] == "persisted"
    assert [row.close for row in stored_rows] == [Decimal("110.00000000"), Decimal("111.00000000")]


def test_float_origin_history_is_not_reported_as_a_persisted_cache(tmp_path) -> None:
    repo = _repo(tmp_path)
    first_fetcher = _FakeAkshareFetcher(_akshare_frame(6))
    first_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: first_fetcher,
    )
    first_payload = first_runtime.get_history_data("600519", days=5)

    second_fetcher = _FakeAkshareFetcher(_akshare_frame(6))
    second_runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=repo,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: second_fetcher,
    )
    second_payload = second_runtime.get_history_data("600519", days=5)

    assert first_payload["diagnostics"]["cacheWriteState"] == "not_persisted"
    assert second_payload["diagnostics"]["cacheWriteState"] == "not_persisted"
    assert first_fetcher.calls == [{"stock_code": "600519", "start_date": None, "end_date": None, "days": 5}]
    assert second_fetcher.calls == [{"stock_code": "600519", "start_date": None, "end_date": None, "days": 5}]
    assert repo.get_recent_daily_rows(code="600519", limit=5) == []


def test_provider_exception_is_redacted_and_reported_as_runtime_unavailable(tmp_path) -> None:
    fetcher = _FakeAkshareFetcher(
        error=RuntimeError("providerName=AkshareFetcher token=secret Traceback raw_payload={secret}")
    )
    runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=_repo(tmp_path),
        dependency_checker=lambda: True,
        fetcher_factory=lambda: fetcher,
    )

    payload = runtime.get_history_data("600519", days=30)
    serialized = json.dumps(payload, ensure_ascii=False).lower()

    assert payload["data"] == []
    assert payload["source"] == "unavailable"
    assert payload["diagnostics"]["status"] == "runtime_unavailable"
    assert payload["diagnostics"]["reason"] == "runtime_unavailable"
    assert payload["diagnostics"]["errorType"] == "RuntimeError"
    for forbidden in ("token", "secret", "traceback", "raw_payload", "aksharefetcher"):
        assert forbidden not in serialized


def test_insufficient_stale_and_missing_adjustments_classifications_remain_honest() -> None:
    runtime = AkshareCnOhlcvRuntime(
        enabled=True,
        repository=None,
        dependency_checker=lambda: True,
        fetcher_factory=lambda: _FakeAkshareFetcher(_akshare_frame(3, start="2026-01-01")),
        persist_cache=False,
    )
    adapter = HistoricalOhlcvRuntimeAdapter(history_runtime=runtime)

    result = HistoricalOhlcvReadinessService(provider=adapter).fetch(
        HistoricalOhlcvReadinessRequest(
            symbol="600519",
            market="cn",
            timeframe="1d",
            end=date(2026, 1, 10),
            required_bars=5,
            require_adjusted=False,
        )
    )

    assert result.readiness["usableBars"] == 3
    assert result.readiness["missingBars"] == 2
    assert result.readiness["freshnessState"] == "stale"
    assert result.readiness["adjustmentState"] == "not_required"
    assert "insufficient_history" in result.readiness["missingRequirements"]
    assert "stale_data" in result.readiness["missingRequirements"]
