# -*- coding: utf-8 -*-
"""Contract tests for the advisory-only portfolio scenario risk read model."""

from __future__ import annotations

import copy
import inspect
import json
from decimal import Decimal

import pytest

from src.services.portfolio_scenario_risk import PortfolioScenarioRiskService


def _position(
    symbol: str,
    market_value: str,
    bucket: str | None = None,
    *,
    base_currency: str = "USD",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "symbol": symbol,
        "marketValueBase": market_value,
        "baseCurrency": base_currency,
    }
    if bucket is not None:
        payload["bucket"] = bucket
    return payload


def _exposure(
    symbol: str,
    label: str,
    *,
    exposure: str = "1",
    label_type: str = "explicit_label",
) -> dict[str, object]:
    return {
        "symbol": symbol,
        "label": label,
        "label_type": label_type,
        "exposure": exposure,
    }


def _scenario(name: str, shocks: dict[str, str]) -> dict[str, object]:
    return {"name": name, "shocks": shocks}


def test_portfolio_scenario_risk_calculates_symbol_and_proxy_shock_impacts() -> None:
    service = PortfolioScenarioRiskService()

    projection = service.build_projection(
        as_of="2026-05-18T09:30:00Z",
        base_currency="USD",
        positions=[
            _position("NVDA", "1000.00", "AI Semis"),
            _position("MSFT", "500.00", "Mega Cap Software"),
            _position("BND", "500.00", "Defensive Bonds"),
        ],
        exposures=[
            _exposure("NVDA", "QQQ", label_type="index_proxy"),
            _exposure("MSFT", "QQQ", exposure="0.8", label_type="index_proxy"),
        ],
        scenario_shocks=[
            _scenario("nvda_gap_down", {"NVDA": "-0.10"}),
            _scenario("qqq_proxy_down", {"QQQ": "-0.05"}),
        ],
    ).model_dump()

    assert projection["readModelType"] == "portfolio_scenario_risk_advisory_v1"
    assert projection["advisoryOnly"] is True
    assert projection["accountingMutation"] is False
    assert projection["brokerIntegration"] is False
    assert projection["tradeExecution"] is False
    assert projection["executionReadiness"] == "advisory_only_not_trade_execution"
    assert projection["asOf"] == "2026-05-18T09:30:00Z"

    coverage = projection["coverage"]
    assert coverage["totalPositions"] == 3
    assert coverage["positionsWithUsableWeight"] == 3
    assert coverage["positionsWithMarketValue"] == 3
    assert coverage["totalMarketValue"] == Decimal("2000.00")
    assert coverage["effectiveWeightSum"] == Decimal("1.00000000")
    assert coverage["explicitExposureRows"] == 2
    assert coverage["labelsWithExplicitCoverage"] == ["QQQ"]

    symbol_scenario = projection["scenarios"][0]
    assert symbol_scenario["name"] == "nvda_gap_down"
    assert symbol_scenario["portfolioImpactPct"] == Decimal("-5.00000000")
    assert symbol_scenario["portfolioImpactAmount"] == Decimal("-100.00")
    assert symbol_scenario["coveredWeight"] == Decimal("0.50000000")
    assert symbol_scenario["coveredMarketValue"] == Decimal("1000.00")
    assert symbol_scenario["missingCoverage"] == []
    assert [item["symbol"] for item in symbol_scenario["positionContributions"]] == [
        "NVDA",
        "BND",
        "MSFT",
    ]
    assert symbol_scenario["positionContributions"][0]["impactAmount"] == Decimal("-100.00")
    assert symbol_scenario["positionContributions"][0]["contributionToScenarioLoss"] == Decimal("1.00000000")

    proxy_scenario = projection["scenarios"][1]
    assert proxy_scenario["name"] == "qqq_proxy_down"
    assert proxy_scenario["portfolioImpactPct"] == Decimal("-3.50000000")
    assert proxy_scenario["portfolioImpactAmount"] == Decimal("-70.00")
    assert proxy_scenario["coveredWeight"] == Decimal("0.75000000")
    assert proxy_scenario["coveredMarketValue"] == Decimal("1500.00")
    assert proxy_scenario["warnings"] == ["missing_scenario_coverage"]
    assert proxy_scenario["missingCoverage"] == [
        {"label": "QQQ", "labelType": "index_proxy", "missingSymbols": ["BND"]}
    ]

    assert [item["symbol"] for item in proxy_scenario["positionContributions"]] == [
        "NVDA",
        "MSFT",
        "BND",
    ]
    nvda, msft, bnd = proxy_scenario["positionContributions"]
    assert nvda["impactPct"] == Decimal("-2.50000000")
    assert nvda["impactAmount"] == Decimal("-50.00")
    assert nvda["contributionToScenarioLoss"] == Decimal("0.71428571")
    assert nvda["appliedShocks"] == [
        {
            "label": "QQQ",
            "labelType": "index_proxy",
            "shockPct": Decimal("-5.00000000"),
            "exposure": Decimal("1.00000000"),
            "impactPct": Decimal("-2.50000000"),
            "impactAmount": Decimal("-50.00"),
        }
    ]
    assert msft["impactPct"] == Decimal("-1.00000000")
    assert msft["impactAmount"] == Decimal("-20.00")
    assert msft["contributionToScenarioLoss"] == Decimal("0.28571429")
    assert bnd["impactPct"] is None
    assert bnd["impactAmount"] is None
    assert bnd["warnings"] == ["missing_scenario_coverage"]

    assert [item["bucket"] for item in proxy_scenario["bucketContributions"]] == [
        "AI Semis",
        "Mega Cap Software",
    ]
    assert proxy_scenario["bucketContributions"][0]["impactAmount"] == Decimal("-50.00")
    assert proxy_scenario["bucketContributions"][1]["impactAmount"] == Decimal("-20.00")


def test_portfolio_scenario_risk_reports_missing_coverage_without_inferring_labels() -> None:
    service = PortfolioScenarioRiskService()
    positions = [
        {"symbol": "AAA", "weight": "0.60"},
        {"symbol": "BBB", "weight": "0.40"},
    ]
    exposures = [_exposure("AAA", "growth_theme", label_type="theme")]
    scenario_shocks = [_scenario("theme_and_currency", {"growth_theme": "-0.10", "USD": "0.02"})]

    original_positions = copy.deepcopy(positions)
    original_exposures = copy.deepcopy(exposures)
    original_scenarios = copy.deepcopy(scenario_shocks)

    projection = service.build_projection(
        base_currency="USD",
        positions=positions,
        exposures=exposures,
        scenario_shocks=scenario_shocks,
    ).model_dump()

    assert positions == original_positions
    assert exposures == original_exposures
    assert scenario_shocks == original_scenarios

    scenario = projection["scenarios"][0]
    assert scenario["portfolioImpactPct"] == Decimal("-6.00000000")
    assert scenario["portfolioImpactAmount"] is None
    assert scenario["coveredWeight"] == Decimal("0.60000000")
    assert scenario["coveredMarketValue"] is None
    assert scenario["warnings"] == ["missing_scenario_coverage"]
    assert scenario["missingCoverage"] == [
        {"label": "GROWTH_THEME", "labelType": "theme", "missingSymbols": ["BBB"]},
        {"label": "USD", "labelType": "explicit_label", "missingSymbols": ["AAA", "BBB"]},
    ]
    assert [item["symbol"] for item in scenario["positionContributions"]] == ["AAA", "BBB"]
    assert scenario["positionContributions"][0]["appliedShocks"][0]["label"] == "GROWTH_THEME"
    assert scenario["positionContributions"][1]["warnings"] == ["missing_scenario_coverage"]


def test_portfolio_scenario_risk_exposes_advisory_no_mutation_flags() -> None:
    service = PortfolioScenarioRiskService()

    projection = service.build_projection(
        base_currency="USD",
        positions=[_position("NVDA", "1000.00")],
        scenario_shocks=[_scenario("nvda_gap_down", {"NVDA": "-0.10"})],
    ).model_dump()

    metadata = projection["metadata"]
    assert metadata["deterministic"] is True
    assert metadata["sideEffectFree"] is True
    assert metadata["inputSource"] == "caller_supplied_positions_exposures_and_scenarios"
    assert metadata["noBrokerSync"] is True
    assert metadata["noAccountingMutation"] is True
    assert metadata["noOrderPlacement"] is True
    assert metadata["notInvestmentAdvice"] is True
    assert metadata["noProviderRuntime"] is True

    serialized = json.dumps(projection, default=str, sort_keys=True).lower()
    for forbidden in (
        "broker_sync",
        "cash_ledger_mutation",
        "holdings_mutation",
        "cost_basis_mutation",
        "account_snapshot_write",
        "order_placement",
    ):
        assert forbidden not in serialized


def test_portfolio_scenario_risk_requires_base_currency_provenance_for_market_values() -> None:
    with pytest.raises(ValueError, match="baseCurrency"):
        PortfolioScenarioRiskService().build_projection(
            base_currency="USD",
            positions=[{"symbol": "AAA", "marketValueBase": "1.00"}],
            scenario_shocks=[_scenario("down", {"AAA": "-0.1"})],
        )


def test_portfolio_scenario_risk_aggregates_raw_money_before_terminal_rounding() -> None:
    projection = PortfolioScenarioRiskService().build_projection(
        base_currency="USD",
        positions=[
            _position("AAA", "0.01", "Micro"),
            _position("BBB", "0.01", "Micro"),
        ],
        scenario_shocks=[_scenario("half_cent_losses", {"AAA": "-0.5", "BBB": "-0.5"})],
    ).model_dump()

    scenario = projection["scenarios"][0]
    assert scenario["portfolioImpactAmount"] == Decimal("-0.01")
    assert scenario["portfolioImpactPct"] == Decimal("-50.00000000")
    assert scenario["bucketContributions"][0]["impactAmount"] == Decimal("-0.01")
    assert scenario["bucketContributions"][0]["contributionToScenarioLoss"] == Decimal("1.00000000")
    assert [item["contributionToScenarioLoss"] for item in scenario["positionContributions"]] == [
        Decimal("0.50000000"),
        Decimal("0.50000000"),
    ]


def test_portfolio_scenario_risk_uses_raw_bucket_money_for_loss_shares_before_rounding() -> None:
    projection = PortfolioScenarioRiskService().build_projection(
        base_currency="USD",
        positions=[
            _position("AAA", "0.01", "Alpha"),
            _position("BBB", "0.01", "Beta"),
        ],
        scenario_shocks=[_scenario("separate_half_cent_losses", {"AAA": "-0.5", "BBB": "-0.5"})],
    ).model_dump()

    scenario = projection["scenarios"][0]
    assert scenario["portfolioImpactAmount"] == Decimal("-0.01")
    buckets = {item["bucket"]: item for item in scenario["bucketContributions"]}
    assert buckets["Alpha"]["impactAmount"] == Decimal("0.00")
    assert buckets["Beta"]["impactAmount"] == Decimal("0.00")
    assert buckets["Alpha"]["contributionToScenarioLoss"] == Decimal("0.50000000")
    assert buckets["Beta"]["contributionToScenarioLoss"] == Decimal("0.50000000")


def test_portfolio_scenario_risk_aggregates_raw_percent_before_terminal_rounding() -> None:
    projection = PortfolioScenarioRiskService().build_projection(
        base_currency="USD",
        positions=[
            {"symbol": "AAA", "weight": "0.43464098"},
            {"symbol": "BBB", "weight": "0.20246634"},
        ],
        scenario_shocks=[
            _scenario(
                "weighted_precision",
                {"AAA": "-0.52992313", "BBB": "-0.87366947"},
            )
        ],
    ).model_dump()

    scenario = projection["scenarios"][0]
    assert scenario["portfolioImpactAmount"] is None
    assert scenario["portfolioImpactPct"] == Decimal("-63.91622820")


def test_portfolio_scenario_risk_preserves_high_scale_exact_arithmetic_and_strings() -> None:
    projection = PortfolioScenarioRiskService().build_projection(
        base_currency="USD",
        positions=[
            {
                "symbol": "ALPHA",
                "weight": "0.33333333",
                "marketValueBase": "12345678901234.56",
                "baseCurrency": "USD",
            },
            {
                "symbol": "BETA",
                "weight": "0.66666667",
                "marketValueBase": "0.01",
                "baseCurrency": "USD",
            },
        ],
        exposures=[_exposure("ALPHA", "FACTOR", exposure="0.33333333")],
        scenario_shocks=[_scenario("high_scale", {"FACTOR": "-0.12345678"})],
    ).model_dump(mode="json")

    assert projection["coverage"]["totalMarketValue"] == "12345678901234.57"
    assert projection["coverage"]["effectiveWeightSum"] == "1.00000000"

    scenario = projection["scenarios"][0]
    assert scenario["portfolioImpactPct"] == "-4.11522596"
    assert scenario["portfolioImpactAmount"] == "-508052582939.59"
    alpha = next(item for item in scenario["positionContributions"] if item["symbol"] == "ALPHA")
    assert alpha["weight"] == "0.33333333"
    assert alpha["impactPct"] == "-1.37174197"
    assert alpha["impactAmount"] == "-508052582939.59"
    assert alpha["appliedShocks"][0]["shockPct"] == "-12.34567800"
    assert alpha["appliedShocks"][0]["exposure"] == "0.33333333"


def test_portfolio_scenario_risk_rejects_native_market_values_without_base_provenance() -> None:
    with pytest.raises(ValueError, match="marketValueBase"):
        PortfolioScenarioRiskService().build_projection(
            base_currency="USD",
            positions=[{"symbol": "AAA", "marketValue": "1000.00", "currency": "USD"}],
            scenario_shocks=[_scenario("down", {"AAA": "-0.1"})],
        )


@pytest.mark.parametrize(
    ("positions", "exposures", "scenario_shocks"),
    [
        ([{"symbol": "AAA", "marketValueBase": 1.0, "baseCurrency": "USD"}], [], [_scenario("down", {"AAA": "-0.1"})]),
        ([{"symbol": "AAA", "weight": "0.123456789"}], [], [_scenario("down", {"AAA": "-0.1"})]),
        ([{"symbol": "AAA", "weight": "1"}], [], [_scenario("down", {"AAA": "1e-2"})]),
        (
            [{"symbol": "AAA", "weight": "1"}],
            [_exposure("AAA", "FACTOR", exposure="0.123456789")],
            [_scenario("down", {"FACTOR": "-0.1"})],
        ),
        ([{"symbol": "AAA", "marketValueBase": "1.001", "baseCurrency": "USD"}], [], [_scenario("down", {"AAA": "-0.1"})]),
    ],
)
def test_portfolio_scenario_risk_rejects_inexact_public_numeric_values(
    positions: list[dict[str, object]],
    exposures: list[dict[str, object]],
    scenario_shocks: list[dict[str, object]],
) -> None:
    with pytest.raises(ValueError):
        PortfolioScenarioRiskService().build_projection(
            base_currency="USD",
            positions=positions,
            exposures=exposures,
            scenario_shocks=scenario_shocks,
        )


def test_portfolio_scenario_risk_rejects_mixed_currency_market_values() -> None:
    with pytest.raises(ValueError, match="does not match base currency"):
        PortfolioScenarioRiskService().build_projection(
            base_currency="USD",
            positions=[
                {"symbol": "AAA", "marketValueBase": "1.00", "baseCurrency": "USD"},
                {"symbol": "BBB", "marketValueBase": "2.00", "baseCurrency": "EUR"},
            ],
            scenario_shocks=[_scenario("down", {"AAA": "-0.1"})],
        )


def test_portfolio_scenario_risk_has_no_broker_accounting_provider_or_runtime_imports() -> None:
    import src.services.portfolio_scenario_risk as module

    source = inspect.getsource(module)
    forbidden_fragments = (
        "src.repositories",
        "src.storage",
        "portfolio_service",
        "portfolio_import_service",
        "portfolio_ibkr_sync_service",
        "portfolio_risk_service",
        "PortfolioCashLedger",
        "PortfolioPositionLot",
        "create_trade_event",
        "create_cash_ledger_event",
        "sync_read_only_account_state",
        "scanner",
        "backtest",
        "api.v1.endpoints",
        "data_provider",
        "market_cache",
        "runtime",
    )

    for fragment in forbidden_fragments:
        assert fragment not in source
