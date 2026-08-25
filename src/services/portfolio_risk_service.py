# -*- coding: utf-8 -*-
"""Portfolio risk service for concentration, drawdown and stop-loss proximity."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from src.config import Config, get_config
from src.portfolio_exact_numeric import (
    parse_portfolio_decimal,
    round_portfolio_decimal_value,
)
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.portfolio_risk_board_lookup import PortfolioRiskBoardLookup
from src.services.portfolio_risk_diagnostics import build_portfolio_risk_diagnostics
from src.services.portfolio_service import PortfolioService


SECTOR_SOURCE_PROVENANCE_VERSION = "portfolio_sector_source_provenance_v1"
SECTOR_SOURCE_PROVENANCE_INTERNAL_FIELD = "_sectorSourceProvenance"
DRAWDOWN_CALCULATION_AVAILABLE = "available"
DRAWDOWN_CALCULATION_UNAVAILABLE = "unavailable"
DRAWDOWN_CALCULATION_NOT_EVALUATED = "not_evaluated"
DRAWDOWN_UNAVAILABLE_MISSING_EQUITY = "missing_equity"
DRAWDOWN_UNAVAILABLE_MISSING_FX = "missing_fx_rate"
DRAWDOWN_UNAVAILABLE_PORTFOLIO_VALUATION = "portfolio_valuation_unavailable"


class PortfolioRiskService:
    """Compute portfolio risk blocks on top of replayed snapshot data."""

    def __init__(
        self,
        *,
        repo: Optional[PortfolioRepository] = None,
        portfolio_service: Optional[PortfolioService] = None,
        config: Optional[Config] = None,
        board_lookup: Optional[PortfolioRiskBoardLookup] = None,
    ):
        self.repo = repo or getattr(portfolio_service, "repo", None) or PortfolioRepository()
        self.portfolio_service = portfolio_service or PortfolioService(repo=self.repo)
        self.config = config or get_config()
        self._board_lookup = board_lookup or PortfolioRiskBoardLookup()

    def _owner_kwargs(self) -> Dict[str, Any]:
        return {
            "owner_id": getattr(self.portfolio_service, "owner_id", None),
            "include_all_owners": bool(getattr(self.portfolio_service, "include_all_owners", False)),
        }

    @staticmethod
    def _required_currency(value: Any, *, field_name: str) -> str:
        currency = str(value or "").strip().upper()
        if not currency:
            raise ValueError(f"portfolio risk {field_name} currency is required")
        return currency

    @classmethod
    def _money(cls, value: Any, *, currency: str) -> Optional[Decimal]:
        if value is None or isinstance(value, bool):
            return None
        return round_portfolio_decimal_value(
            value,
            kind="money",
            currency=cls._required_currency(currency, field_name="money"),
        )

    @staticmethod
    def _weight_pct(numerator: Optional[Decimal], denominator: Optional[Decimal]) -> Optional[float]:
        if numerator is None or denominator is None or denominator <= 0:
            return None
        return float((numerator / denominator) * Decimal("100"))

    @staticmethod
    def _valuation_is_authoritative(snapshot: Dict[str, Any]) -> bool:
        truth = snapshot.get("portfolio_truth")
        return isinstance(truth, dict) and str(truth.get("value_semantics") or "") == "authoritative_total"

    @staticmethod
    def _copy_portfolio_truth(snapshot: Dict[str, Any]) -> Dict[str, Any]:
        truth = snapshot.get("portfolio_truth")
        return dict(truth) if isinstance(truth, dict) else {}

    def get_risk_report(
        self,
        *,
        account_id: Optional[int] = None,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
    ) -> Dict[str, Any]:
        as_of_date = as_of or date.today()
        snapshot = self.portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
        )

        thresholds = {
            "concentration_alert_pct": float(getattr(self.config, "portfolio_risk_concentration_alert_pct", 35.0)),
            "drawdown_alert_pct": float(getattr(self.config, "portfolio_risk_drawdown_alert_pct", 15.0)),
            "stop_loss_alert_pct": float(getattr(self.config, "portfolio_risk_stop_loss_alert_pct", 10.0)),
            "stop_loss_near_ratio": float(getattr(self.config, "portfolio_risk_stop_loss_near_ratio", 0.8)),
            "lookback_days": int(getattr(self.config, "portfolio_risk_lookback_days", 180)),
        }

        concentration = self._build_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        sector_concentration = self._build_sector_concentration(
            snapshot,
            thresholds["concentration_alert_pct"],
            as_of_date=as_of_date,
        )
        industry_attribution = self._build_industry_attribution(
            snapshot=snapshot,
            as_of_date=as_of_date,
            include_sector_source_provenance=True,
        )
        sector_source_provenance = industry_attribution.pop(
            SECTOR_SOURCE_PROVENANCE_INTERNAL_FIELD,
            self._build_sector_source_provenance([]),
        )
        self._ensure_drawdown_snapshot_window(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            lookback_days=thresholds["lookback_days"],
        )
        drawdown = self._build_drawdown(
            account_id=account_id,
            as_of_date=as_of_date,
            cost_method=cost_method,
            threshold_pct=thresholds["drawdown_alert_pct"],
            lookback_days=thresholds["lookback_days"],
            report_currency=str(snapshot.get("currency") or "CNY"),
        )
        stop_loss = self._build_stop_loss(snapshot, thresholds)
        account_attribution = self._build_account_attribution(
            snapshot=snapshot,
            as_of_date=as_of_date,
        )
        diagnostics = build_portfolio_risk_diagnostics(
            portfolio_service=self.portfolio_service,
            snapshot=snapshot,
            account_id=account_id,
            as_of=as_of_date,
            cost_method=cost_method,
        )

        report = {
            "as_of": as_of_date.isoformat(),
            "account_id": account_id,
            "cost_method": cost_method,
            "currency": snapshot["currency"],
            "data_status": snapshot.get("data_status"),
            "calculation_status": snapshot.get("calculation_status"),
            "availability": snapshot.get("availability"),
            "thresholds": thresholds,
            "concentration": concentration,
            "sector_concentration": sector_concentration,
            "industry_attribution": industry_attribution,
            "sectorSourceProvenance": sector_source_provenance,
            "drawdown": drawdown,
            "stop_loss": stop_loss,
            "account_attribution": account_attribution,
            "portfolio_truth": self._copy_portfolio_truth(snapshot),
        }
        report.update(diagnostics)
        self._apply_public_valuation_truth(report)
        return report

    @classmethod
    def _apply_public_valuation_truth(cls, report: Dict[str, Any]) -> None:
        """Prevent risk projections from strengthening the canonical valuation claim."""
        authoritative = cls._valuation_is_authoritative(report)
        if authoritative:
            return

        concentration = report.get("concentration")
        if isinstance(concentration, dict):
            concentration["total_market_value"] = None
            concentration["top_weight_pct"] = None
            concentration["alert"] = None
            for row in list(concentration.get("top_positions") or []):
                if isinstance(row, dict):
                    row["market_value_base"] = None
                    row["weight_pct"] = None
                    row["is_alert"] = None

        sector = report.get("sector_concentration")
        if isinstance(sector, dict):
            sector["total_market_value"] = None
            sector["top_weight_pct"] = None
            sector["alert"] = None
            for row in list(sector.get("top_sectors") or []):
                if isinstance(row, dict):
                    row["market_value_base"] = None
                    row["weight_pct"] = None
                    row["is_alert"] = None

        industry = report.get("industry_attribution")
        if isinstance(industry, dict):
            industry["total_market_value"] = None
            for row in list(industry.get("top_industries") or []):
                if isinstance(row, dict):
                    row["market_value_base"] = None
                    row["weight_pct"] = None

        attribution = report.get("account_attribution")
        if isinstance(attribution, dict):
            attribution["total_equity"] = None
            attribution["total_market_value"] = None
            for row in list(attribution.get("top_accounts") or []):
                if isinstance(row, dict):
                    for field_name in (
                        "total_equity_base",
                        "equity_weight_pct",
                        "total_market_value_base",
                        "market_value_weight_pct",
                    ):
                        row[field_name] = None

        drawdown = report.get("drawdown")
        if isinstance(drawdown, dict):
            for field_name in ("max_drawdown_pct", "current_drawdown_pct", "alert"):
                drawdown[field_name] = None
            drawdown["calculation_status"] = DRAWDOWN_CALCULATION_UNAVAILABLE
            drawdown["unavailable_reason"] = DRAWDOWN_UNAVAILABLE_PORTFOLIO_VALUATION

    def _ensure_drawdown_snapshot_window(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        lookback_days: int,
    ) -> None:
        if lookback_days <= 0:
            return

        start_date = self._resolve_backfill_start_date(
            account_id=account_id,
            as_of_date=as_of_date,
            lookback_days=lookback_days,
        )
        if start_date > as_of_date:
            return

        existing_rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
            **self._owner_kwargs(),
        )
        if account_id is not None:
            existing_dates = {row.snapshot_date for row in existing_rows if int(row.account_id) == int(account_id)}
            current_date = start_date
            while current_date <= as_of_date:
                if current_date not in existing_dates:
                    self.portfolio_service.get_portfolio_snapshot(
                        account_id=account_id,
                        as_of=current_date,
                        cost_method=cost_method,
                    )
                    existing_dates.add(current_date)
                current_date += timedelta(days=1)
            return

        account_ids = [int(account["id"]) for account in self.portfolio_service.list_accounts(include_inactive=False)]
        if not account_ids:
            return
        existing_pairs = {(int(row.account_id), row.snapshot_date) for row in existing_rows}
        current_date = start_date
        while current_date <= as_of_date:
            if not all((aid, current_date) in existing_pairs for aid in account_ids):
                self.portfolio_service.get_portfolio_snapshot(
                    account_id=None,
                    as_of=current_date,
                    cost_method=cost_method,
                )
                for aid in account_ids:
                    existing_pairs.add((aid, current_date))
            current_date += timedelta(days=1)

    def _resolve_backfill_start_date(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        lookback_days: int,
    ) -> date:
        window_start = as_of_date - timedelta(days=lookback_days)
        if account_id is not None:
            first_activity = self.repo.get_first_activity_date(
                account_id=account_id,
                as_of=as_of_date,
                **self._owner_kwargs(),
            )
            return max(window_start, first_activity or as_of_date)

        first_activity_candidates: List[date] = []
        for account in self.portfolio_service.list_accounts(include_inactive=False):
            first_activity = self.repo.get_first_activity_date(
                account_id=int(account["id"]),
                as_of=as_of_date,
                **self._owner_kwargs(),
            )
            if first_activity is not None:
                first_activity_candidates.append(first_activity)
        if not first_activity_candidates:
            return as_of_date
        return max(window_start, min(first_activity_candidates))

    def _build_concentration(self, snapshot: Dict[str, Any], threshold_pct: float, *, as_of_date: date) -> Dict[str, Any]:
        report_currency = self._required_currency(snapshot.get("currency"), field_name="snapshot")
        total_mv = self._money(snapshot.get("total_market_value"), currency=report_currency)
        exposure_by_symbol: Dict[str, Decimal] = {}
        observed_symbols: set[str] = set()
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                observed_symbols.add(symbol)
                valuation_currency = self._required_currency(
                    pos.get("valuation_currency") or account.get("base_currency"),
                    field_name="position valuation",
                )
                market_value = self._money(pos.get("market_value_base"), currency=valuation_currency)
                if market_value is None:
                    continue
                converted, _, source = self.portfolio_service.convert_amount_exact(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
                if source == "missing_rate":
                    continue
                exposure_by_symbol[symbol] = exposure_by_symbol.get(symbol, Decimal("0")) + converted

        rows = []
        for symbol in sorted(observed_symbols):
            exposure = exposure_by_symbol.get(symbol)
            market_value_base = self._money(exposure, currency=report_currency)
            weight = self._weight_pct(market_value_base, total_mv)
            rows.append(
                {
                    "symbol": symbol,
                    "market_value_base": market_value_base,
                    "weight_pct": round(weight, 4) if weight is not None else None,
                    "is_alert": bool(weight >= threshold_pct) if weight is not None else None,
                }
            )
        rows.sort(
            key=lambda item: (
                item["market_value_base"] is None,
                -(item["market_value_base"] or Decimal("0")),
                item["symbol"],
            )
        )

        top_weight = rows[0]["weight_pct"] if rows else None
        return {
            "total_market_value": total_mv,
            "top_weight_pct": round(float(top_weight), 4) if top_weight is not None else None,
            "alert": bool(top_weight >= threshold_pct) if top_weight is not None else None,
            "top_positions": rows[:10],
        }

    def _build_sector_concentration(
        self,
        snapshot: Dict[str, Any],
        threshold_pct: float,
        *,
        as_of_date: date,
    ) -> Dict[str, Any]:
        total_mv, industry_rows, coverage, errors, _ = self._collect_industry_rows(
            snapshot=snapshot,
            as_of_date=as_of_date,
        )
        rows = []
        for item in industry_rows:
            weight = item["weight_pct"]
            rows.append(
                {
                    "sector": item["industry"],
                    "market_value_base": item["market_value_base"],
                    "weight_pct": weight,
                    "symbol_count": item["symbol_count"],
                    "is_alert": bool(float(weight) >= threshold_pct) if weight is not None else None,
                }
            )
        top_weight = rows[0]["weight_pct"] if rows else None

        return {
            "total_market_value": total_mv,
            "top_weight_pct": round(float(top_weight), 4) if top_weight is not None else None,
            "alert": bool(top_weight >= threshold_pct) if top_weight is not None else None,
            "top_sectors": rows[:10],
            "coverage": coverage,
            "errors": errors[:20],
        }

    def _build_industry_attribution(
        self,
        *,
        snapshot: Dict[str, Any],
        as_of_date: date,
        include_sector_source_provenance: bool = False,
    ) -> Dict[str, Any]:
        total_mv, rows, coverage, errors, provenance = self._collect_industry_rows(
            snapshot=snapshot,
            as_of_date=as_of_date,
            include_sector_source_provenance=include_sector_source_provenance,
        )
        payload = {
            "total_market_value": total_mv,
            "top_industries": rows[:10],
            "coverage": coverage,
            "errors": errors[:20],
        }
        if include_sector_source_provenance:
            payload[SECTOR_SOURCE_PROVENANCE_INTERNAL_FIELD] = provenance
        return payload

    def _collect_industry_rows(
        self,
        *,
        snapshot: Dict[str, Any],
        as_of_date: date,
        include_sector_source_provenance: bool = False,
    ) -> Tuple[Decimal, List[Dict[str, Any]], Dict[str, int], List[str], Dict[str, Any]]:
        report_currency = self._required_currency(snapshot.get("currency"), field_name="snapshot")
        total_mv = self._money(snapshot.get("total_market_value"), currency=report_currency)
        industry_exposure: Dict[str, Decimal] = {}
        industry_symbols: Dict[str, set] = {}
        coverage = {
            "classified_count": 0,
            "unclassified_count": 0,
            "failed_count": 0,
        }
        errors: List[str] = []
        board_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}
        provenance_items: List[Dict[str, Any]] = []

        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                symbol = str(pos.get("symbol") or "").strip().upper()
                market = str(pos.get("market") or account.get("market") or "").strip().lower()
                if not symbol:
                    continue

                valuation_currency = self._required_currency(
                    pos.get("valuation_currency") or account.get("base_currency"),
                    field_name="position valuation",
                )
                cache_key = (symbol, market)
                was_cached = cache_key in board_cache
                industry, provenance_item = self._resolve_primary_sector_with_provenance(
                    symbol=symbol,
                    market=market,
                    board_cache=board_cache,
                    coverage=coverage,
                    errors=errors,
                )
                if include_sector_source_provenance and not was_cached:
                    provenance_items.append(provenance_item)
                industry_symbols.setdefault(industry, set()).add(symbol)

                market_value = self._money(pos.get("market_value_base"), currency=valuation_currency)
                if market_value is None:
                    continue
                converted, _, source = self.portfolio_service.convert_amount_exact(
                    amount=market_value,
                    from_currency=valuation_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
                if source == "missing_rate":
                    continue
                industry_exposure[industry] = industry_exposure.get(industry, Decimal("0")) + converted

        rows: List[Dict[str, Any]] = []
        for industry in sorted(industry_symbols):
            exposure = industry_exposure.get(industry)
            market_value_base = self._money(exposure, currency=report_currency)
            weight = self._weight_pct(market_value_base, total_mv)
            rows.append(
                {
                    "industry": industry,
                    "market_value_base": market_value_base,
                    "weight_pct": round(weight, 4) if weight is not None else None,
                    "symbol_count": len(industry_symbols.get(industry, set())),
                }
            )
        rows.sort(
            key=lambda item: (
                item["market_value_base"] is None,
                -(item["market_value_base"] or Decimal("0")),
                item["industry"],
            )
        )
        return total_mv, rows, coverage, errors, self._build_sector_source_provenance(provenance_items)

    def _resolve_primary_sector(
        self,
        *,
        symbol: str,
        market: str,
        board_cache: Dict[Tuple[str, str], Dict[str, Any]],
        coverage: Dict[str, int],
        errors: List[str],
    ) -> str:
        sector, _ = self._resolve_primary_sector_with_provenance(
            symbol=symbol,
            market=market,
            board_cache=board_cache,
            coverage=coverage,
            errors=errors,
        )
        return sector

    def _resolve_primary_sector_with_provenance(
        self,
        *,
        symbol: str,
        market: str,
        board_cache: Dict[Tuple[str, str], Dict[str, Any]],
        coverage: Dict[str, int],
        errors: List[str],
    ) -> Tuple[str, Dict[str, Any]]:
        cache_key = (symbol, market)
        if cache_key in board_cache:
            cached = board_cache[cache_key]
            return str(cached.get("industryLabel") or "UNCLASSIFIED"), cached

        if market != "cn":
            coverage["unclassified_count"] += 1
            provenance = self._build_sector_source_provenance_item(
                symbol=symbol,
                market=market,
                industry_label="UNCLASSIFIED",
                classification_state="non_cn_not_applicable",
                source_kind="not_applicable",
                source_detail_state="not_applicable",
                detected_source_states=["not_applicable"],
                reason_codes=["non_cn_classification_not_applicable", "unclassified"],
            )
            board_cache[cache_key] = provenance
            return "UNCLASSIFIED", provenance

        try:
            boards = self._fetch_belong_boards(symbol)
            sector_name = self._pick_primary_board_name(boards)
            if sector_name:
                coverage["classified_count"] += 1
                detected_source_states = self._detect_board_source_states(boards)
                provenance = self._build_sector_source_provenance_item(
                    symbol=symbol,
                    market=market,
                    industry_label=sector_name,
                    classification_state="cn_board_lookup_resolved",
                    source_kind=self._primary_source_kind(detected_source_states, default="provider_observed"),
                    source_detail_state=self._board_source_detail_state(boards),
                    detected_source_states=detected_source_states,
                    reason_codes=["cn_board_lookup_resolved"],
                )
                board_cache[cache_key] = provenance
                return sector_name, provenance

            classification_state = "cn_board_lookup_empty" if not boards else "unresolved"
            detected_source_states = self._detect_board_source_states(boards)
            provenance = self._build_sector_source_provenance_item(
                symbol=symbol,
                market=market,
                industry_label="UNCLASSIFIED",
                classification_state=classification_state,
                source_kind=self._primary_source_kind(detected_source_states, default="missing"),
                source_detail_state=self._board_source_detail_state(boards),
                detected_source_states=detected_source_states,
                reason_codes=[classification_state, "unclassified"],
            )
        except Exception as exc:
            coverage["failed_count"] += 1
            errors.append(f"{symbol}: {exc}")
            provenance = self._build_sector_source_provenance_item(
                symbol=symbol,
                market=market,
                industry_label="UNCLASSIFIED",
                classification_state="lookup_failure",
                source_kind="unknown",
                source_detail_state="unknown",
                detected_source_states=["unknown"],
                reason_codes=["lookup_failed", "unclassified"],
            )

        coverage["unclassified_count"] += 1
        board_cache[cache_key] = provenance
        return "UNCLASSIFIED", provenance

    @staticmethod
    def _build_sector_source_provenance_item(
        *,
        symbol: str,
        market: str,
        industry_label: str,
        classification_state: str,
        source_kind: str,
        source_detail_state: str,
        detected_source_states: List[str],
        reason_codes: List[str],
    ) -> Dict[str, Any]:
        normalized_market = market or "unknown"
        normalized_label = industry_label or "UNCLASSIFIED"
        return {
            "symbol": symbol,
            "market": normalized_market,
            "sectorLabel": normalized_label,
            "industryLabel": normalized_label,
            "classificationState": classification_state,
            "sourceKind": source_kind,
            "sourceDetailState": source_detail_state,
            "detectedSourceStates": list(dict.fromkeys(detected_source_states)),
            "resolved": normalized_label != "UNCLASSIFIED",
            "boardLookupApplicable": normalized_market == "cn",
            "authorityGrant": False,
            "decisionGrade": False,
            "accountingMutation": False,
            "providerRoutingChanged": False,
            "externalProviderCallsAdded": False,
            "marketCacheMutation": False,
            "rawProviderPayloadStored": False,
            "reasonCodes": list(dict.fromkeys(reason_codes)),
        }

    @staticmethod
    def _build_sector_source_provenance(items: List[Dict[str, Any]]) -> Dict[str, Any]:
        sorted_items = sorted(
            items,
            key=lambda item: (
                str(item.get("market") or ""),
                str(item.get("symbol") or ""),
            ),
        )
        summary = {
            "symbolMarketCount": len(sorted_items),
            "resolvedCount": sum(1 for item in sorted_items if bool(item.get("resolved"))),
            "cnBoardLookupResolvedCount": sum(
                1 for item in sorted_items if item.get("classificationState") == "cn_board_lookup_resolved"
            ),
            "nonCnNotApplicableCount": sum(
                1 for item in sorted_items if item.get("classificationState") == "non_cn_not_applicable"
            ),
            "emptyBoardLookupCount": sum(
                1 for item in sorted_items if item.get("classificationState") == "cn_board_lookup_empty"
            ),
            "lookupFailureCount": sum(
                1 for item in sorted_items if item.get("classificationState") == "lookup_failure"
            ),
            "unresolvedCount": sum(1 for item in sorted_items if item.get("industryLabel") == "UNCLASSIFIED"),
            "fallbackOrProxySourceCount": sum(
                1 for item in sorted_items if item.get("sourceKind") in {"fallback", "proxy"}
            ),
            "providerObservedCount": sum(
                1
                for item in sorted_items
                if item.get("sourceKind") == "provider_observed"
                or "provider_observed" in list(item.get("detectedSourceStates") or [])
            ),
            "missingSourceDetailCount": sum(
                1 for item in sorted_items if item.get("sourceDetailState") in {"missing", "unknown"}
            ),
        }
        return {
            "provenanceVersion": SECTOR_SOURCE_PROVENANCE_VERSION,
            "diagnosticOnly": True,
            "observationOnly": True,
            "authorityGrant": False,
            "decisionGrade": False,
            "accountingMutation": False,
            "providerRoutingChanged": False,
            "externalProviderCallsAdded": False,
            "marketCacheMutation": False,
            "classificationAuthority": "not_authoritative",
            "summary": summary,
            "items": sorted_items,
        }

    @staticmethod
    def _detect_board_source_states(boards: List[Dict[str, Any]]) -> List[str]:
        if not boards:
            return ["missing"]

        states = {"provider_observed"}
        for item in boards:
            if not isinstance(item, dict):
                continue
            text = " ".join(f"{key}={value}" for key, value in item.items()).lower()
            if "fallback" in text or "回退" in text:
                states.add("fallback")
            if "proxy" in text or "代理" in text:
                states.add("proxy")
            if "missing" in text or "缺失" in text:
                states.add("missing")
        return sorted(states)

    @staticmethod
    def _primary_source_kind(states: List[str], *, default: str) -> str:
        for candidate in ("fallback", "proxy", "provider_observed", "missing", "unknown"):
            if candidate in states:
                return candidate
        return default

    @staticmethod
    def _board_source_detail_state(boards: List[Dict[str, Any]]) -> str:
        if not boards:
            return "missing"
        detail_keys = {
            "source",
            "source_name",
            "source_type",
            "provider",
            "data_source",
            "freshness",
            "freshness_status",
            "observed_at",
            "as_of",
        }
        for item in boards:
            if not isinstance(item, dict):
                continue
            if any(str(key).strip().lower() in detail_keys for key in item):
                return "present_not_authoritative"
        return "missing"

    def _fetch_belong_boards(self, symbol: str) -> List[Dict[str, Any]]:
        return self._board_lookup.fetch_belong_boards(symbol)

    @staticmethod
    def _pick_primary_board_name(boards: List[Dict[str, Any]]) -> Optional[str]:
        if not boards:
            return None

        preferred: Optional[str] = None
        fallback: Optional[str] = None
        for item in boards:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            if fallback is None:
                fallback = name
            type_text = str(item.get("type") or "").strip().lower()
            if "行业" in type_text or "industry" in type_text:
                preferred = name
                break
        return preferred or fallback

    def _build_drawdown(
        self,
        *,
        account_id: Optional[int],
        as_of_date: date,
        cost_method: str,
        threshold_pct: float,
        lookback_days: int,
        report_currency: str,
    ) -> Dict[str, Any]:
        rows = self.repo.list_daily_snapshots_for_risk(
            as_of=as_of_date,
            cost_method=cost_method,
            account_id=account_id,
            lookback_days=lookback_days,
            **self._owner_kwargs(),
        )
        if not rows:
            return {
                "series_points": 0,
                "max_drawdown_pct": 0.0,
                "current_drawdown_pct": 0.0,
                "alert": False,
                "fx_stale": False,
                "calculation_status": DRAWDOWN_CALCULATION_NOT_EVALUATED,
                "unavailable_reason": None,
            }

        grouped: Dict[str, Decimal] = {}
        stale_flag = False
        unavailable_reason: Optional[str] = None
        for row in rows:
            key = row.snapshot_date.isoformat()
            row_currency = self._required_currency(row.base_currency, field_name="daily snapshot")
            if row.total_equity is None:
                unavailable_reason = unavailable_reason or DRAWDOWN_UNAVAILABLE_MISSING_EQUITY
                continue
            converted, stale, source = self.portfolio_service.convert_amount_exact(
                # Repository projections retain storage-scale Decimal values until
                # the risk calculation reaches its public response boundary.
                amount=parse_portfolio_decimal(row.total_equity, kind="storage"),
                from_currency=row_currency,
                to_currency=report_currency,
                as_of_date=row.snapshot_date,
            )
            if source == "missing_rate":
                unavailable_reason = unavailable_reason or DRAWDOWN_UNAVAILABLE_MISSING_FX
                continue
            grouped[key] = grouped.get(key, Decimal("0")) + converted
            stale_flag = stale_flag or stale or bool(row.fx_stale)

        if unavailable_reason is not None:
            return {
                "series_points": len(grouped),
                "max_drawdown_pct": None,
                "current_drawdown_pct": None,
                "alert": None,
                "fx_stale": stale_flag,
                "calculation_status": DRAWDOWN_CALCULATION_UNAVAILABLE,
                "unavailable_reason": unavailable_reason,
            }

        series: List[Tuple[str, Decimal]] = sorted(grouped.items(), key=lambda item: item[0])
        peak = Decimal("0")
        max_drawdown = Decimal("0")
        current_drawdown = Decimal("0")
        for _, equity in series:
            peak = max(peak, equity)
            if peak <= 0:
                drawdown = Decimal("0")
            else:
                drawdown = (peak - equity) / peak * Decimal("100")
            max_drawdown = max(max_drawdown, drawdown)
            current_drawdown = drawdown

        return {
            "series_points": len(series),
            "max_drawdown_pct": round(float(max_drawdown), 4),
            "current_drawdown_pct": round(float(current_drawdown), 4),
            "alert": bool(float(max_drawdown) >= threshold_pct),
            "fx_stale": stale_flag,
            "calculation_status": DRAWDOWN_CALCULATION_AVAILABLE,
            "unavailable_reason": None,
        }

    def _build_account_attribution(
        self,
        *,
        snapshot: Dict[str, Any],
        as_of_date: date,
    ) -> Dict[str, Any]:
        report_currency = self._required_currency(snapshot.get("currency"), field_name="snapshot")
        total_equity = self._money(snapshot.get("total_equity"), currency=report_currency)
        total_market_value = self._money(snapshot.get("total_market_value"), currency=report_currency)

        rows: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []):
            account_currency = self._required_currency(
                account.get("base_currency"), field_name="account base"
            )
            account_equity = self._money(account.get("total_equity"), currency=account_currency)
            account_market_value = self._money(account.get("total_market_value"), currency=account_currency)
            converted_equity: Optional[Decimal] = None
            converted_market_value: Optional[Decimal] = None
            stale_equity = False
            stale_market_value = False
            equity_source = "missing"
            market_value_source = "missing"
            if account_equity is not None:
                converted_equity, stale_equity, equity_source = self.portfolio_service.convert_amount_exact(
                    amount=account_equity,
                    from_currency=account_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
            if account_market_value is not None:
                converted_market_value, stale_market_value, market_value_source = self.portfolio_service.convert_amount_exact(
                    amount=account_market_value,
                    from_currency=account_currency,
                    to_currency=report_currency,
                    as_of_date=as_of_date,
                )
            if equity_source == "missing_rate":
                converted_equity = None
            if market_value_source == "missing_rate":
                converted_market_value = None
            total_equity_base = self._money(converted_equity, currency=report_currency)
            total_market_value_base = self._money(converted_market_value, currency=report_currency)
            equity_weight = self._weight_pct(total_equity_base, total_equity)
            market_value_weight = self._weight_pct(total_market_value_base, total_market_value)
            rows.append(
                {
                    "account_id": int(account.get("account_id")),
                    "account_name": str(account.get("account_name") or ""),
                    "market": str(account.get("market") or "").lower(),
                    "total_equity_base": total_equity_base,
                    "equity_weight_pct": round(equity_weight, 4) if equity_weight is not None else None,
                    "total_market_value_base": total_market_value_base,
                    "market_value_weight_pct": round(market_value_weight, 4)
                    if market_value_weight is not None
                    else None,
                    "fx_stale": bool(account.get("fx_stale")) or stale_equity or stale_market_value,
                }
            )

        rows.sort(
            key=lambda item: (
                item["total_equity_base"] is None,
                -(item["total_equity_base"] or Decimal("0")),
                int(item["account_id"]),
            )
        )
        return {
            "total_equity": total_equity,
            "total_market_value": total_market_value,
            "top_accounts": rows[:20],
        }

    @staticmethod
    def _build_stop_loss(snapshot: Dict[str, Any], thresholds: Dict[str, Any]) -> Dict[str, Any]:
        stop_loss_pct = parse_portfolio_decimal(str(thresholds["stop_loss_alert_pct"]), kind="ratio")
        near_ratio = parse_portfolio_decimal(str(thresholds["stop_loss_near_ratio"]), kind="ratio")
        near_threshold = stop_loss_pct * near_ratio

        warnings: List[Dict[str, Any]] = []
        for account in snapshot.get("accounts", []):
            for pos in account.get("positions", []):
                market = str(pos.get("market") or account.get("market") or "").strip().lower()
                if not market:
                    raise ValueError("portfolio risk stop-loss position market is required")
                if pos.get("avg_cost") is None or pos.get("last_price") is None:
                    continue
                avg_cost = round_portfolio_decimal_value(pos.get("avg_cost"), kind="price", market=market)
                last_price = round_portfolio_decimal_value(pos.get("last_price"), kind="price", market=market)
                if avg_cost <= 0:
                    continue
                loss_pct = max(Decimal("0"), (avg_cost - last_price) / avg_cost * Decimal("100"))
                if loss_pct < near_threshold:
                    continue
                warnings.append(
                    {
                        "account_id": account.get("account_id"),
                        "symbol": pos.get("symbol"),
                        "avg_cost": avg_cost,
                        "last_price": last_price,
                        "loss_pct": round(float(loss_pct), 4),
                        "near_threshold_pct": round(float(near_threshold), 4),
                        "is_triggered": bool(loss_pct >= stop_loss_pct),
                    }
                )

        warnings.sort(key=lambda item: item["loss_pct"], reverse=True)
        return {
            "near_alert": len(warnings) > 0,
            "triggered_count": sum(1 for item in warnings if item["is_triggered"]),
            "near_count": len(warnings),
            "items": warnings[:20],
        }
