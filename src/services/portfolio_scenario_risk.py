# -*- coding: utf-8 -*-
"""Advisory-only portfolio scenario risk projection helpers."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping, Sequence

from pydantic import BaseModel, Field

from src.portfolio_exact_numeric import (
    PortfolioExactNumericError,
    parse_portfolio_decimal,
    resolve_portfolio_precision,
    round_portfolio_decimal_value,
)


ZERO = Decimal("0")
ONE = Decimal("1")
HUNDRED = Decimal("100")


class PortfolioScenarioRiskCoverage(BaseModel):
    totalPositions: int = 0
    positionsWithUsableWeight: int = 0
    positionsWithMarketValue: int = 0
    effectiveWeightSum: Decimal = ZERO
    totalMarketValue: Decimal | None = None
    explicitExposureRows: int = 0
    labelsWithExplicitCoverage: list[str] = Field(default_factory=list)


class PortfolioScenarioRiskAppliedShock(BaseModel):
    label: str
    labelType: str = "explicit_label"
    shockPct: Decimal = ZERO
    exposure: Decimal = ONE
    impactPct: Decimal | None = None
    impactAmount: Decimal | None = None


class PortfolioScenarioRiskPositionContribution(BaseModel):
    symbol: str
    bucket: str | None = None
    weight: Decimal = ZERO
    marketValue: Decimal | None = None
    impactPct: Decimal | None = None
    impactAmount: Decimal | None = None
    contributionToScenarioLoss: Decimal | None = None
    warnings: list[str] = Field(default_factory=list)
    appliedShocks: list[PortfolioScenarioRiskAppliedShock] = Field(default_factory=list)


class PortfolioScenarioRiskBucketContribution(BaseModel):
    bucket: str
    positionCount: int = 0
    impactPct: Decimal | None = None
    impactAmount: Decimal | None = None
    contributionToScenarioLoss: Decimal | None = None


class PortfolioScenarioRiskMissingCoverage(BaseModel):
    label: str
    labelType: str = "explicit_label"
    missingSymbols: list[str] = Field(default_factory=list)


class PortfolioScenarioRiskScenarioResult(BaseModel):
    name: str
    portfolioImpactPct: Decimal = ZERO
    portfolioImpactAmount: Decimal | None = None
    coveredWeight: Decimal = ZERO
    coveredMarketValue: Decimal | None = None
    warnings: list[str] = Field(default_factory=list)
    missingCoverage: list[PortfolioScenarioRiskMissingCoverage] = Field(default_factory=list)
    positionContributions: list[PortfolioScenarioRiskPositionContribution] = Field(default_factory=list)
    bucketContributions: list[PortfolioScenarioRiskBucketContribution] = Field(default_factory=list)


class PortfolioScenarioRiskMetadata(BaseModel):
    deterministic: bool = True
    sideEffectFree: bool = True
    inputSource: str = "caller_supplied_positions_exposures_and_scenarios"
    noLivePrices: bool = True
    noBrokerSync: bool = True
    noAccountingMutation: bool = True
    noOrderPlacement: bool = True
    notInvestmentAdvice: bool = True
    noProviderRuntime: bool = True
    advisoryOnly: bool = True


class PortfolioScenarioRiskReadModel(BaseModel):
    readModelType: str = "portfolio_scenario_risk_advisory_v1"
    advisoryOnly: bool = True
    accountingMutation: bool = False
    brokerIntegration: bool = False
    tradeExecution: bool = False
    executionReadiness: str = "advisory_only_not_trade_execution"
    asOf: str | None = None
    baseCurrency: str
    coverage: PortfolioScenarioRiskCoverage = Field(default_factory=PortfolioScenarioRiskCoverage)
    scenarios: list[PortfolioScenarioRiskScenarioResult] = Field(default_factory=list)
    insufficientDataReasons: list[str] = Field(default_factory=list)
    missingDataWarnings: list[str] = Field(default_factory=list)
    metadata: PortfolioScenarioRiskMetadata = Field(default_factory=PortfolioScenarioRiskMetadata)


@dataclass(frozen=True)
class _Position:
    symbol: str
    weight: Decimal
    market_value: Decimal | None
    bucket: str | None


@dataclass(frozen=True)
class _AppliedShock:
    value: PortfolioScenarioRiskAppliedShock
    raw_impact_pct: Decimal
    raw_impact_amount: Decimal | None


@dataclass(frozen=True)
class _PositionRow:
    value: PortfolioScenarioRiskPositionContribution
    raw_impact_pct: Decimal | None
    raw_impact_amount: Decimal | None


@dataclass(frozen=True)
class _Exposure:
    symbol: str
    label: str
    label_type: str
    exposure: Decimal


class PortfolioScenarioRiskService:
    """Build deterministic advisory-only scenario projections from caller inputs."""

    def build_projection(
        self,
        *,
        positions: Sequence[Mapping[str, Any] | object] | Mapping[str, Any],
        scenario_shocks: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None,
        exposures: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None = None,
        as_of: str | None = None,
        base_currency: str,
    ) -> PortfolioScenarioRiskReadModel:
        currency = self._base_currency(base_currency)
        normalized_positions, total_market_value = self._positions(positions, base_currency=currency)
        normalized_exposures = self._exposures(exposures)
        scenarios = [
            self._scenario_result(
                name=name,
                positions=normalized_positions,
                exposures=normalized_exposures,
                shocks=shocks,
                total_market_value=total_market_value,
                base_currency=currency,
            )
            for name, shocks in self._scenario_inputs(scenario_shocks)
        ]

        return PortfolioScenarioRiskReadModel(
            asOf=self._text(as_of),
            baseCurrency=currency,
            coverage=PortfolioScenarioRiskCoverage(
                totalPositions=len(normalized_positions),
                positionsWithUsableWeight=sum(1 for item in normalized_positions if item.weight > 0),
                positionsWithMarketValue=sum(1 for item in normalized_positions if item.market_value is not None),
                effectiveWeightSum=self._ratio_round(sum((item.weight for item in normalized_positions), ZERO)),
                totalMarketValue=self._money_round(total_market_value, currency) if total_market_value > ZERO else None,
                explicitExposureRows=len(normalized_exposures),
                labelsWithExplicitCoverage=sorted({item.label for item in normalized_exposures}),
            ),
            scenarios=scenarios,
            insufficientDataReasons=self._insufficient_reasons(normalized_positions, scenario_shocks, scenarios),
            missingDataWarnings=["scenario_coverage_incomplete"] if any(item.missingCoverage for item in scenarios) else [],
        )

    def _positions(
        self,
        positions: Sequence[Mapping[str, Any] | object] | Mapping[str, Any],
        *,
        base_currency: str,
    ) -> tuple[list[_Position], Decimal]:
        rows: dict[str, dict[str, Any]] = {}
        total_market_value = ZERO

        for item in self._items(positions, value_key="weight"):
            symbol = self._key(self._field(item, "symbol"))
            if not symbol:
                continue
            row = rows.setdefault(
                symbol,
                {"weight": ZERO, "has_weight": False, "market_value": ZERO, "has_market_value": False, "bucket": None},
            )
            weight = self._weight(item)
            if weight is not None and weight > ZERO:
                row["weight"] += weight
                row["has_weight"] = True
            market_value = self._market_value(item, base_currency=base_currency)
            if market_value is not None and market_value > ZERO:
                row["market_value"] += market_value
                row["has_market_value"] = True
                total_market_value += market_value
            bucket = self._text(self._first(item, "bucket", "bucketLabel", "theme", "factor"))
            if bucket and not row["bucket"]:
                row["bucket"] = bucket

        raw_weights: dict[str, Decimal] = {}
        for symbol, row in rows.items():
            market_value = row["market_value"] if row["has_market_value"] else None
            if row["has_weight"]:
                raw_weights[symbol] = row["weight"]
            elif market_value is not None and total_market_value > ZERO:
                raw_weights[symbol] = market_value / total_market_value

        weight_sum = sum(raw_weights.values(), ZERO)
        normalized = [
            _Position(
                symbol=symbol,
                weight=raw_weights.get(symbol, ZERO) / weight_sum if weight_sum > ZERO else ZERO,
                market_value=row["market_value"] if row["has_market_value"] else None,
                bucket=row["bucket"],
            )
            for symbol, row in sorted(
                rows.items(),
                key=lambda entry: (-(entry[1]["market_value"] or ZERO), -raw_weights.get(entry[0], ZERO), entry[0]),
            )
        ]
        return normalized, total_market_value

    def _exposures(
        self,
        exposures: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None,
    ) -> list[_Exposure]:
        merged: dict[tuple[str, str], _Exposure] = {}
        for item in self._exposure_items(exposures):
            symbol = self._key(self._field(item, "symbol"))
            label = self._key(self._first(item, "label", "shock_label", "proxy", "name"))
            if not symbol or not label:
                continue
            raw_exposure = self._first(item, "exposure", "weight", "coverage")
            exposure = ONE if raw_exposure is None else self._ratio(raw_exposure)
            if exposure < ZERO:
                continue
            label_type = self._text(self._first(item, "label_type", "labelType", "type")) or "explicit_label"
            existing = merged.get((label, symbol))
            merged[(label, symbol)] = _Exposure(
                symbol=symbol,
                label=label,
                label_type=label_type,
                exposure=self._ratio_round((existing.exposure if existing else ZERO) + exposure),
            )
        return sorted(merged.values(), key=lambda item: (item.label, item.symbol))

    def _scenario_result(
        self,
        *,
        name: str,
        positions: Sequence[_Position],
        exposures: Sequence[_Exposure],
        shocks: Mapping[str, tuple[Decimal, str]],
        total_market_value: Decimal,
        base_currency: str,
    ) -> PortfolioScenarioRiskScenarioResult:
        positions_by_symbol = {item.symbol: item for item in positions}
        exposures_by_label: dict[str, list[_Exposure]] = {}
        label_types: dict[str, str] = {}
        for exposure in exposures:
            exposures_by_label.setdefault(exposure.label, []).append(exposure)
            label_types.setdefault(exposure.label, exposure.label_type)

        applied: dict[str, list[_AppliedShock]] = {item.symbol: [] for item in positions}
        warnings: dict[str, set[str]] = {item.symbol: set() for item in positions}
        missing_coverage: list[PortfolioScenarioRiskMissingCoverage] = []

        for label, (shock, shock_label_type) in shocks.items():
            if label in positions_by_symbol:
                applied[label].append(
                    self._applied(positions_by_symbol[label], label, "symbol", shock, ONE, base_currency)
                )
                continue

            label_exposures = [item for item in exposures_by_label.get(label, []) if item.symbol in positions_by_symbol]
            covered = {item.symbol for item in label_exposures}
            missing = sorted(symbol for symbol in positions_by_symbol if symbol not in covered)
            if missing:
                label_type = label_types.get(label) or shock_label_type
                missing_coverage.append(
                    PortfolioScenarioRiskMissingCoverage(label=label, labelType=label_type, missingSymbols=missing)
                )
                for symbol in missing:
                    warnings[symbol].add("missing_scenario_coverage")
            for exposure in label_exposures:
                applied[exposure.symbol].append(
                    self._applied(
                        positions_by_symbol[exposure.symbol],
                        label,
                        label_types.get(label, exposure.label_type),
                        shock,
                        exposure.exposure,
                        base_currency,
                    )
                )

        position_records, amount_sum, pct_sum, covered_weight, covered_market_value = self._position_rows(
            positions,
            applied,
            warnings,
            base_currency,
        )
        has_amount = any(item.raw_impact_amount is not None for item in position_records)
        impact_amount = self._money_round(amount_sum, base_currency) if has_amount else None
        impact_pct = (
            self._ratio_round(amount_sum / total_market_value * HUNDRED)
            if total_market_value > ZERO and has_amount
            else self._ratio_round(pct_sum)
        )
        loss_basis = amount_sum if has_amount else pct_sum

        for item in position_records:
            item.value.contributionToScenarioLoss = self._loss_share(
                item.raw_impact_amount,
                item.raw_impact_pct,
                loss_basis,
                has_amount,
            )

        bucket_rows = self._bucket_rows(position_records, loss_basis, has_amount, base_currency)
        position_records.sort(key=self._position_sort_key)
        bucket_rows.sort(key=self._bucket_sort_key)

        return PortfolioScenarioRiskScenarioResult(
            name=name,
            portfolioImpactPct=impact_pct,
            portfolioImpactAmount=impact_amount,
            coveredWeight=self._ratio_round(covered_weight),
            coveredMarketValue=self._money_round(covered_market_value, base_currency) if has_amount else None,
            warnings=["missing_scenario_coverage"] if missing_coverage else [],
            missingCoverage=missing_coverage,
            positionContributions=[item.value for item in position_records],
            bucketContributions=bucket_rows,
        )

    def _position_rows(
        self,
        positions: Sequence[_Position],
        applied: Mapping[str, Sequence[_AppliedShock]],
        warnings: Mapping[str, set[str]],
        base_currency: str,
    ) -> tuple[list[_PositionRow], Decimal, Decimal, Decimal, Decimal]:
        rows: list[_PositionRow] = []
        amount_sum = ZERO
        pct_sum = ZERO
        covered_weight = ZERO
        covered_market_value = ZERO

        for position in positions:
            shocks = list(applied[position.symbol])
            raw_impact_pct = self._raw_sum(item.raw_impact_pct for item in shocks)
            raw_impact_amount = self._raw_sum(item.raw_impact_amount for item in shocks)
            impact_pct = self._ratio_round(raw_impact_pct) if raw_impact_pct is not None else None
            impact_amount = self._money_round(raw_impact_amount, base_currency) if raw_impact_amount is not None else None
            if shocks:
                covered_weight += position.weight
                pct_sum += raw_impact_pct or ZERO
                amount_sum += raw_impact_amount or ZERO
                if position.market_value is not None:
                    covered_market_value += position.market_value
            rows.append(
                _PositionRow(
                    value=PortfolioScenarioRiskPositionContribution(
                        symbol=position.symbol,
                        bucket=position.bucket,
                        weight=self._ratio_round(position.weight),
                        marketValue=self._money_round(position.market_value, base_currency)
                        if position.market_value is not None
                        else None,
                        impactPct=impact_pct,
                        impactAmount=impact_amount,
                        warnings=sorted(warnings[position.symbol]),
                        appliedShocks=[item.value for item in shocks],
                    ),
                    raw_impact_pct=raw_impact_pct,
                    raw_impact_amount=raw_impact_amount,
                )
            )
        return rows, amount_sum, pct_sum, covered_weight, covered_market_value

    def _bucket_rows(
        self,
        positions: Sequence[_PositionRow],
        loss_basis: Decimal | None,
        use_amount: bool,
        base_currency: str,
    ) -> list[PortfolioScenarioRiskBucketContribution]:
        grouped: dict[str, dict[str, Decimal | int | bool]] = {}
        for position in positions:
            if not position.value.bucket or (position.raw_impact_pct is None and position.raw_impact_amount is None):
                continue
            row = grouped.setdefault(position.value.bucket, {"count": 0, "pct": ZERO, "amount": ZERO, "has_amount": False})
            row["count"] = int(row["count"]) + 1
            row["pct"] = Decimal(row["pct"]) + (position.raw_impact_pct or ZERO)
            if position.raw_impact_amount is not None:
                row["amount"] = Decimal(row["amount"]) + position.raw_impact_amount
                row["has_amount"] = True

        rows = []
        for bucket, values in grouped.items():
            raw_impact_pct = Decimal(values["pct"])
            raw_impact_amount = Decimal(values["amount"]) if values["has_amount"] else None
            impact_pct = self._ratio_round(raw_impact_pct)
            impact_amount = self._money_round(raw_impact_amount, base_currency) if raw_impact_amount is not None else None
            rows.append(
                PortfolioScenarioRiskBucketContribution(
                    bucket=bucket,
                    positionCount=int(values["count"]),
                    impactPct=impact_pct,
                    impactAmount=impact_amount,
                    contributionToScenarioLoss=self._loss_share(
                        raw_impact_amount,
                        raw_impact_pct,
                        loss_basis,
                        use_amount,
                    ),
                )
            )
        return rows

    def _applied(
        self,
        position: _Position,
        label: str,
        label_type: str,
        shock: Decimal,
        exposure: Decimal,
        base_currency: str,
    ) -> _AppliedShock:
        raw_impact_pct = position.weight * shock * exposure * HUNDRED
        raw_impact_amount = position.market_value * shock * exposure if position.market_value is not None else None
        return _AppliedShock(
            value=PortfolioScenarioRiskAppliedShock(
            label=label,
            labelType=label_type,
            shockPct=self._ratio_round(shock * HUNDRED),
            exposure=self._ratio_round(exposure),
                impactPct=self._ratio_round(raw_impact_pct),
                impactAmount=self._money_round(raw_impact_amount, base_currency)
                if raw_impact_amount is not None
                else None,
            ),
            raw_impact_pct=raw_impact_pct,
            raw_impact_amount=raw_impact_amount,
        )

    def _scenario_inputs(
        self,
        scenario_shocks: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None,
    ) -> list[tuple[str, dict[str, tuple[Decimal, str]]]]:
        scenarios = []
        for index, item in enumerate(self._items(scenario_shocks, value_key="shocks")):
            shocks = self._shocks(self._field(item, "shocks"))
            if shocks:
                scenarios.append((self._text(self._field(item, "name")) or f"scenario_{index + 1}", shocks))
        return scenarios

    def _shocks(self, value: Any) -> dict[str, tuple[Decimal, str]]:
        if not isinstance(value, Mapping):
            return {}
        shocks: dict[str, tuple[Decimal, str]] = {}
        for raw_label, raw_value in value.items():
            label = self._key(raw_label)
            label_type = "explicit_label"
            shock_value = raw_value
            if isinstance(raw_value, Mapping):
                shock_value = self._first(raw_value, "shock", "shock_pct", "shockPct", "return")
                label_type = self._text(self._first(raw_value, "label_type", "labelType", "type")) or label_type
            shock = self._return_fraction(shock_value)
            if label and shock is not None:
                shocks[label] = (shock, label_type)
        return shocks

    def _items(
        self,
        value: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None,
        *,
        value_key: str,
    ) -> list[Any]:
        if value is None:
            return []
        if hasattr(value, "model_dump"):
            return [value]
        if not isinstance(value, Mapping):
            return list(value)
        if value_key in value:
            return [value]
        key_name = "symbol" if value_key == "weight" else "name"
        return [
            ({**item, key_name: key} if isinstance(item, Mapping) else {key_name: key, value_key: item})
            for key, item in value.items()
        ]

    def _exposure_items(self, value: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None) -> list[Any]:
        if value is None or not isinstance(value, Mapping):
            return list(value or [])
        items: list[Any] = []
        for label, covered in value.items():
            if isinstance(covered, Mapping) and isinstance(covered.get("symbols"), Sequence):
                for symbol in covered["symbols"]:
                    items.append(
                        {
                            "label": label,
                            "symbol": symbol,
                            "exposure": covered.get("exposure", "1"),
                            "label_type": covered.get("label_type") or covered.get("labelType"),
                        }
                    )
            elif isinstance(covered, Sequence) and not isinstance(covered, (str, bytes, bytearray)):
                items.extend({"label": label, "symbol": symbol, "exposure": "1"} for symbol in covered)
            elif isinstance(covered, Mapping):
                items.append({**covered, "label": label})
            else:
                items.append({"label": label, "symbol": covered, "exposure": "1"})
        return items

    def _insufficient_reasons(
        self,
        positions: Sequence[_Position],
        scenario_shocks: Sequence[Mapping[str, Any] | object] | Mapping[str, Any] | None,
        scenarios: Sequence[PortfolioScenarioRiskScenarioResult],
    ) -> list[str]:
        reasons = []
        if not positions:
            reasons.append("no_positions")
        if scenario_shocks and not scenarios:
            reasons.append("no_usable_scenario_shocks")
        return reasons

    def _weight(self, item: Any) -> Decimal | None:
        raw_explicit_pct = self._first(item, "weight_pct", "weightPct")
        if raw_explicit_pct is not None:
            explicit_pct = self._ratio(raw_explicit_pct)
            return self._ratio_round(explicit_pct / HUNDRED)
        raw_weight = self._field(item, "weight")
        if raw_weight is None:
            return None
        weight = self._ratio(raw_weight)
        if weight < ZERO:
            return None
        return self._ratio_round(weight / HUNDRED) if weight > ONE else weight

    def _market_value(self, item: Any, *, base_currency: str) -> Decimal | None:
        if self._first(item, "market_value", "marketValue") is not None:
            raise PortfolioExactNumericError("scenario risk positions require marketValueBase, not native marketValue")
        raw_value = self._first(item, "market_value_base", "marketValueBase")
        if raw_value is None:
            return None
        row_currency = self._text(self._first(item, "base_currency", "baseCurrency"))
        if row_currency is None:
            raise PortfolioExactNumericError("scenario risk marketValueBase requires row baseCurrency")
        if row_currency.upper() != base_currency:
            raise PortfolioExactNumericError(
                f"scenario risk position currency {row_currency!r} does not match base currency {base_currency!r}"
            )
        number = parse_portfolio_decimal(raw_value, kind="money", currency=base_currency)
        return number if number >= ZERO else None

    def _return_fraction(self, value: Any) -> Decimal:
        number = self._ratio(value)
        return self._ratio_round(number / HUNDRED) if abs(number) > ONE else number

    def _ratio(self, value: Any) -> Decimal:
        return parse_portfolio_decimal(value, kind="ratio")

    def _money_sum(self, values: Any, currency: str) -> Decimal | None:
        present = [value for value in values if value is not None]
        return self._money_round(sum(present, ZERO), currency) if present else None

    def _raw_sum(self, values: Any) -> Decimal | None:
        present = [value for value in values if value is not None]
        return sum(present, ZERO) if present else None

    def _loss_share(
        self,
        impact_amount: Decimal | None,
        impact_pct: Decimal | None,
        loss_basis: Decimal | None,
        use_amount: bool,
    ) -> Decimal | None:
        numerator = impact_amount if use_amount else impact_pct
        if loss_basis is None or loss_basis >= ZERO or numerator is None or numerator >= ZERO:
            return None
        return self._ratio_round(abs(numerator) / abs(loss_basis))

    def _position_sort_key(self, item: _PositionRow) -> tuple[bool, Decimal, str]:
        impact = item.raw_impact_amount if item.raw_impact_amount is not None else item.raw_impact_pct
        return (impact is None, impact if impact is not None else ZERO, item.value.symbol)

    def _bucket_sort_key(self, item: PortfolioScenarioRiskBucketContribution) -> tuple[bool, Decimal, str]:
        impact = item.impactAmount if item.impactAmount is not None else item.impactPct
        return (impact is None, impact if impact is not None else ZERO, item.bucket)

    def _field(self, value: Any, key: str) -> Any:
        if isinstance(value, Mapping):
            return value.get(key)
        return getattr(value, key, None)

    def _first(self, value: Any, *keys: str) -> Any:
        for key in keys:
            item = self._field(value, key)
            if item is not None:
                return item
        return None

    def _key(self, value: Any) -> str:
        return str(value or "").strip().upper()

    def _text(self, value: Any) -> str | None:
        text = str(value or "").strip()
        return text or None

    def _base_currency(self, value: str) -> str:
        precision = resolve_portfolio_precision(kind="money", currency=value)
        if precision.currency is None:
            raise PortfolioExactNumericError("scenario risk base currency is required")
        return precision.currency

    def _ratio_round(self, value: Decimal) -> Decimal:
        return round_portfolio_decimal_value(value, kind="ratio")

    def _money_round(self, value: Decimal, currency: str) -> Decimal:
        return round_portfolio_decimal_value(value, kind="money", currency=currency)


__all__ = [
    "PortfolioScenarioRiskAppliedShock",
    "PortfolioScenarioRiskBucketContribution",
    "PortfolioScenarioRiskCoverage",
    "PortfolioScenarioRiskMetadata",
    "PortfolioScenarioRiskMissingCoverage",
    "PortfolioScenarioRiskPositionContribution",
    "PortfolioScenarioRiskReadModel",
    "PortfolioScenarioRiskScenarioResult",
    "PortfolioScenarioRiskService",
]
