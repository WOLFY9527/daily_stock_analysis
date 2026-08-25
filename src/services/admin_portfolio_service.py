# -*- coding: utf-8 -*-
"""Read-only safe projections for admin portfolio visibility APIs."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import and_, desc, func, or_, select

from src.repositories.auth_repo import AuthRepository
from src.repositories.portfolio_repo import PortfolioRepository
from src.services.portfolio_service import PortfolioService
from src.storage import (
    DatabaseManager,
    PortfolioAccount,
    PortfolioBrokerConnection,
    PortfolioBrokerSyncState,
    PortfolioCashLedger,
    PortfolioCorporateAction,
    PortfolioTrade,
)


ADMIN_PORTFOLIO_VALUATION_SCOPE_ACTIVE = "active_accounts_only"


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def _float(value: Any) -> float:
    return float(value or 0.0)


def _hash_ref(value: Any, *, prefix: str = "sha256") -> str:
    digest = hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()
    return f"{prefix}:{digest[:16]}"


def _broker_account_handle(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    digest = hashlib.sha256(f"broker-account:{text}".encode("utf-8")).hexdigest()
    return f"acct_{digest[:12]}"


def _empty_ledger_counts() -> dict[str, int]:
    return {
        "trades": 0,
        "cash_events": 0,
        "corporate_actions": 0,
    }


class AdminPortfolioService:
    """Build admin portfolio projections without mutating portfolio state."""

    def __init__(
        self,
        *,
        db_manager: DatabaseManager | None = None,
        auth_repo: AuthRepository | None = None,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self.auth_repo = auth_repo or AuthRepository(self.db)

    def target_user_exists(self, user_id: str) -> bool:
        return self.auth_repo.get_app_user(str(user_id or "").strip()) is not None

    def _portfolio_service(self, user_id: str) -> PortfolioService:
        return PortfolioService(
            repo=PortfolioRepository(self.db),
            owner_id=str(user_id or "").strip(),
        )

    @staticmethod
    def _wire_tree(value: Any) -> Any:
        if isinstance(value, Decimal):
            return format(value, "f")
        if isinstance(value, list):
            return [AdminPortfolioService._wire_tree(item) for item in value]
        if isinstance(value, dict):
            return {key: AdminPortfolioService._wire_tree(item) for key, item in value.items()}
        return value

    @classmethod
    def _valuation_projection(cls, snapshot: dict[str, Any]) -> dict[str, Any]:
        truth = dict(snapshot.get("portfolio_truth") or {})
        valuation_lineage = dict(snapshot.get("valuation_lineage") or {})
        valuation_snapshot_lineage = dict(snapshot.get("valuation_snapshot_lineage") or {})
        fx_lineage = dict(snapshot.get("fx_lineage") or {})
        positions = [
            position
            for account in list(snapshot.get("accounts") or [])
            for position in list((account or {}).get("positions") or [])
            if isinstance(position, dict)
        ]
        return {
            "as_of": snapshot.get("as_of"),
            "cost_method": snapshot.get("cost_method"),
            "valuation_currency": snapshot.get("currency"),
            "portfolio_truth": cls._wire_tree(truth),
            "valuation": cls._wire_tree(snapshot.get("valuation") or {}),
            "availability": cls._wire_tree(snapshot.get("availability") or {}),
            "fx_lineage": cls._wire_tree(fx_lineage),
            "valuation_snapshot_lineage": cls._wire_tree(valuation_snapshot_lineage),
            "valuation_lineage": cls._wire_tree(valuation_lineage),
            "data_status": snapshot.get("data_status"),
            "calculation_status": snapshot.get("calculation_status"),
            "fx_stale": bool(snapshot.get("fx_stale")),
            "fx_freshness_state": fx_lineage.get("status") or "unknown",
            "valuation_lineage_state": valuation_snapshot_lineage.get("status") or "blocked",
            "unvalued_holding_count": sum(
                1
                for position in positions
                if position.get("display_market_value") is None
                or position.get("display_unrealized_pnl") is None
                or position.get("display_fx_status") == "unavailable"
            ),
        }

    @classmethod
    def _money_projection(
        cls,
        snapshot: dict[str, Any],
        field_name: str,
        *,
        allow_zero_for_empty: bool = True,
    ) -> dict[str, Any]:
        truth = dict(snapshot.get("portfolio_truth") or {})
        semantics = str(truth.get("value_semantics") or "unavailable")
        amount = snapshot.get(field_name) if semantics == "authoritative_total" else None
        if not allow_zero_for_empty and str(truth.get("state") or "") == "account_no_holdings":
            amount = None
        return {
            "amount": cls._wire_tree(amount),
            "currency": snapshot.get("currency"),
        }

    @classmethod
    def _snapshot_summary_projection(
        cls,
        *,
        user_id: str,
        accounts: list[Any],
        connections: list[Any],
        connections_by_account: dict[int, list[Any]],
        ledger_counts: dict[str, int],
        statuses: dict[str, int],
        last_sync_at: Optional[datetime],
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        valuation = cls._valuation_projection(snapshot)
        valuation_account_count = len(list(snapshot.get("accounts") or []))
        limitations = [
            "read_only_projection",
            "canonical_portfolio_valuation",
            "raw_broker_payloads_excluded",
            "raw_broker_refs_masked",
        ]
        if len(accounts) > valuation_account_count:
            limitations.append("inactive_accounts_excluded_from_valuation")
        return {
            "user_id": user_id,
            "account_count": len(accounts),
            "active_account_count": sum(1 for row in accounts if bool(row.is_active)),
            "base_currencies": sorted(
                {str(row.base_currency).upper() for row in accounts if str(row.base_currency or "").strip()}
            ),
            "accounts": [cls._account_item(row, connections_by_account.get(int(row.id), [])) for row in accounts],
            "total_cash": cls._money_projection(snapshot, "total_cash"),
            "total_market_value": cls._money_projection(snapshot, "total_market_value"),
            "total_equity": cls._money_projection(snapshot, "total_equity"),
            "realized_pnl": cls._money_projection(snapshot, "realized_pnl"),
            "unrealized_pnl": cls._money_projection(snapshot, "unrealized_pnl"),
            "ledger_counts": ledger_counts,
            "broker_sync_summary": {
                "connections": len(connections),
                "statuses": dict(sorted(statuses.items())),
                "last_sync_at": _iso(last_sync_at),
                # Sync rows do not carry independently verified FX lineage, so
                # canonical portfolio freshness must not be relabeled as broker evidence.
                "fx_stale": None,
                "fx_freshness_state": None,
            },
            "valuation_scope": ADMIN_PORTFOLIO_VALUATION_SCOPE_ACTIVE,
            "valuation_account_count": valuation_account_count,
            **valuation,
            "limitations": limitations,
        }

    def get_summary(
        self,
        *,
        user_id: str,
        include_inactive: bool = False,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
    ) -> dict[str, Any]:
        user_id = str(user_id or "").strip()
        with self.db.get_session() as session:
            accounts = self._accounts(session, user_id=user_id, include_inactive=include_inactive)
            account_ids = [int(row.id) for row in accounts]
            connections = self._connections(session, user_id=user_id, account_ids=account_ids)
            connections_by_account = self._connections_by_account(connections)
            latest_sync_by_account = self._latest_sync_by_account(session, user_id=user_id, account_ids=account_ids)
            ledger_counts = self._ledger_counts(session, account_ids=account_ids)

            last_sync_at: datetime | None = None
            statuses: dict[str, int] = {}
            for account_id in account_ids:
                sync_state = latest_sync_by_account.get(account_id)
                if sync_state is not None:
                    status = str(getattr(sync_state, "sync_status", "unknown") or "unknown")
                    statuses[status] = statuses.get(status, 0) + 1
                    synced_at = getattr(sync_state, "synced_at", None)
                    if isinstance(synced_at, datetime) and (last_sync_at is None or synced_at > last_sync_at):
                        last_sync_at = synced_at

        snapshot = self._portfolio_service(user_id).get_portfolio_snapshot(
            as_of=as_of,
            cost_method=cost_method,
            persist_snapshot_cache=False,
        )
        return self._snapshot_summary_projection(
            user_id=user_id,
            accounts=accounts,
            connections=connections,
            connections_by_account=connections_by_account,
            ledger_counts=ledger_counts,
            statuses=statuses,
            last_sync_at=last_sync_at,
            snapshot=snapshot,
        )

    def list_holdings(
        self,
        *,
        user_id: str,
        account_id: int | None = None,
        symbol: str | None = None,
        market: str | None = None,
        include_zero: bool = False,
        limit: int = 50,
        offset: int = 0,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
    ) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
        user_id = str(user_id or "").strip()
        with self.db.get_session() as session:
            accounts = self._accounts(session, user_id=user_id, include_inactive=True)
            if account_id is not None and int(account_id) not in {int(row.id) for row in accounts}:
                return [], -1, {}
            account_ids = [int(account_id)] if account_id is not None else [int(row.id) for row in accounts if bool(row.is_active)]
            account_by_id = {int(row.id): row for row in accounts if int(row.id) in set(account_ids)}
            connections = self._connections(session, user_id=user_id, account_ids=account_ids)
            connection_by_account = self._connections_by_account(connections)

        try:
            snapshot = self._portfolio_service(user_id).get_portfolio_snapshot(
                account_id=account_id,
                as_of=as_of,
                cost_method=cost_method,
                persist_snapshot_cache=False,
            )
        except ValueError:
            if account_id is not None:
                return [], -1, {}
            raise

        items, total = self._holding_items_from_snapshot(
            snapshot=snapshot,
            account_by_id=account_by_id,
            connection_by_account=connection_by_account,
            symbol=symbol,
            market=market,
            include_zero=include_zero,
            limit=limit,
            offset=offset,
        )
        return items, total, self._valuation_projection(snapshot)

    @classmethod
    def _holding_items_from_snapshot(
        cls,
        *,
        snapshot: dict[str, Any],
        account_by_id: dict[int, Any],
        connection_by_account: dict[int, list[Any]],
        symbol: Optional[str],
        market: Optional[str],
        include_zero: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        items: list[dict[str, Any]] = []
        for account_snapshot in list(snapshot.get("accounts") or []):
            account = account_by_id.get(int(account_snapshot.get("account_id") or 0))
            if account is None:
                continue
            connections_for_account = connection_by_account.get(int(account.id), [])
            handle = (
                _broker_account_handle(getattr(connections_for_account[0], "broker_account_ref", None))
                if connections_for_account
                else None
            )
            for position in list(account_snapshot.get("positions") or []):
                item = cls._canonical_holding_item(
                    account=account,
                    position=position,
                    broker_account_handle=handle,
                    as_of=account_snapshot.get("as_of"),
                )
                quantity = Decimal(str(position.get("quantity") or "0"))
                if (not include_zero and quantity == 0) or (
                    symbol and item["symbol"].upper() != symbol.upper()
                ) or (market and str(item["market"] or "").lower() != market.lower()):
                    continue
                items.append(item)
        items.sort(key=lambda item: (item["account_id"], item["symbol"], item["market"] or "", item["currency"] or ""))
        total = len(items)
        start = max(0, int(offset))
        return items[start:start + max(1, int(limit))], total

    @staticmethod
    def _canonical_holding_item(
        *,
        account: Any,
        position: dict[str, Any],
        broker_account_handle: Optional[str],
        as_of: Optional[str],
    ) -> dict[str, Any]:
        market_value = position.get("display_market_value")
        unrealized = position.get("display_unrealized_pnl")
        valuation_currency = position.get("display_currency")
        fx_status = str(position.get("display_fx_status") or "unavailable")
        valuation_status = str(position.get("valuation_status") or "unavailable")
        return {
            "account_id": int(account.id),
            "account_name": str(account.name),
            "broker": getattr(account, "broker", None),
            "broker_account_handle": broker_account_handle,
            "symbol": str(position.get("symbol") or ""),
            "market": position.get("market"),
            "currency": position.get("currency"),
            "quantity": AdminPortfolioService._wire_tree(position.get("quantity")),
            "avg_cost": AdminPortfolioService._wire_tree(position.get("avg_cost")),
            "last_price": AdminPortfolioService._wire_tree(position.get("last_price")),
            "market_value_base": AdminPortfolioService._wire_tree(market_value),
            "unrealized_pnl_base": AdminPortfolioService._wire_tree(unrealized),
            "valuation_currency": valuation_currency,
            "fx_status": fx_status,
            "valuation_status": valuation_status,
            "valuation_unavailable_reason": position.get("valuation_unavailable_reason"),
            "display_market_value": AdminPortfolioService._wire_tree(market_value),
            "display_unrealized_pnl": AdminPortfolioService._wire_tree(unrealized),
            "updated_at": as_of,
        }

    def list_activity(
        self,
        *,
        user_id: str,
        account_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
        user_id = str(user_id or "").strip()
        with self.db.get_session() as session:
            accounts = self._accounts(session, user_id=user_id, include_inactive=True)
            if account_id is not None and int(account_id) not in {int(row.id) for row in accounts}:
                return [], -1, _empty_ledger_counts()
            account_ids = [int(account_id)] if account_id is not None else [int(row.id) for row in accounts]
            account_name = {int(row.id): str(row.name) for row in accounts}
            summary = self._ledger_counts(session, account_ids=account_ids)
            window_size = max(0, int(offset)) + max(1, int(limit))
            items: list[dict[str, Any]] = []
            for row in self._bounded_activity_rows(
                session,
                model=PortfolioTrade,
                account_ids=account_ids,
                date_column=PortfolioTrade.trade_date,
                window_size=window_size,
                extra_filter=or_(PortfolioTrade.is_active.is_(True), PortfolioTrade.is_active.is_(None)),
            ):
                items.append(
                    {
                        "id_hash": _hash_ref(f"trade:{row.id}"),
                        "type": "trade",
                        "account_id": int(row.account_id),
                        "account_name": account_name.get(int(row.account_id), ""),
                        "event_date": _iso(row.trade_date) or "",
                        "symbol": row.symbol,
                        "market": row.market,
                        "currency": row.currency,
                        "side": row.side,
                        "quantity": _float(row.quantity),
                        "price": _float(row.price),
                        "created_at": _iso(row.created_at),
                    }
                )
            for row in self._bounded_activity_rows(
                session,
                model=PortfolioCashLedger,
                account_ids=account_ids,
                date_column=PortfolioCashLedger.event_date,
                window_size=window_size,
            ):
                items.append(
                    {
                        "id_hash": _hash_ref(f"cash:{row.id}"),
                        "type": "cash",
                        "account_id": int(row.account_id),
                        "account_name": account_name.get(int(row.account_id), ""),
                        "event_date": _iso(row.event_date) or "",
                        "currency": row.currency,
                        "direction": row.direction,
                        "amount": _float(row.amount),
                        "created_at": _iso(row.created_at),
                    }
                )
            for row in self._bounded_activity_rows(
                session,
                model=PortfolioCorporateAction,
                account_ids=account_ids,
                date_column=PortfolioCorporateAction.effective_date,
                window_size=window_size,
            ):
                items.append(
                    {
                        "id_hash": _hash_ref(f"corporate_action:{row.id}"),
                        "type": "corporate_action",
                        "account_id": int(row.account_id),
                        "account_name": account_name.get(int(row.account_id), ""),
                        "event_date": _iso(row.effective_date) or "",
                        "symbol": row.symbol,
                        "market": row.market,
                        "currency": row.currency,
                        "action_type": row.action_type,
                        "amount": _float(row.cash_dividend_per_share) if row.cash_dividend_per_share is not None else None,
                        "created_at": _iso(row.created_at),
                    }
                )
            items.sort(key=lambda item: (item["event_date"], item["id_hash"]), reverse=True)
            total = summary["trades"] + summary["cash_events"] + summary["corporate_actions"]
            start = max(0, int(offset))
            return items[start:start + max(1, int(limit))], total, summary

    def get_account_detail(
        self,
        *,
        user_id: str,
        account_id: int,
        as_of: Optional[date] = None,
        cost_method: str = "fifo",
    ) -> Optional[dict[str, Any]]:
        user_id = str(user_id or "").strip()
        with self.db.get_session() as session:
            account = session.execute(
                select(PortfolioAccount)
                .where(
                    and_(
                        PortfolioAccount.owner_id == user_id,
                        PortfolioAccount.id == int(account_id),
                        PortfolioAccount.is_active.is_(True),
                    )
                )
                .limit(1)
            ).scalar_one_or_none()
            if account is None:
                return None
            connections = self._connections(session, user_id=user_id, account_ids=[int(account.id)])
            sync_by_account = self._latest_sync_by_account(session, user_id=user_id, account_ids=[int(account.id)])
        snapshot = self._portfolio_service(user_id).get_portfolio_snapshot(
            account_id=int(account_id),
            as_of=as_of,
            cost_method=cost_method,
            persist_snapshot_cache=False,
        )
        valuation = self._valuation_projection(snapshot)
        holding_items, holding_total = self._holding_items_from_snapshot(
            snapshot=snapshot,
            account_by_id={int(account.id): account},
            connection_by_account={int(account.id): connections},
            symbol=None,
            market=None,
            include_zero=False,
            limit=200,
            offset=0,
        )
        activity_items, activity_total, activity_summary = self.list_activity(
            user_id=user_id,
            account_id=int(account.id),
            limit=200,
            offset=0,
        )
        return {
            "user_id": user_id,
            "account": self._account_item(account, connections),
            "broker_connections": [self._connection_item(row) for row in connections],
            "sync_state": self._sync_state_item(
                sync_by_account.get(int(account.id)),
            ),
            "holdings": {
                "items": holding_items,
                "total": holding_total,
                "limit": 200,
                "offset": 0,
                "has_more": False,
                **valuation,
                "limitations": ["raw_broker_payloads_excluded", "raw_broker_refs_masked"],
            },
            "activity": {
                "items": activity_items,
                "total": activity_total,
                "limit": 200,
                "offset": 0,
                "has_more": False,
                "summary": activity_summary,
                "limitations": ["notes_and_raw_import_rows_excluded"],
            },
            **valuation,
            "limitations": [
                "read_only_projection",
                "canonical_portfolio_valuation",
                "raw_broker_payloads_excluded",
                "raw_broker_refs_masked",
            ],
        }

    @staticmethod
    def _accounts(session: Any, *, user_id: str, include_inactive: bool) -> list[Any]:
        query = select(PortfolioAccount).where(PortfolioAccount.owner_id == user_id)
        if not include_inactive:
            query = query.where(PortfolioAccount.is_active.is_(True))
        return list(session.execute(query.order_by(PortfolioAccount.id.asc())).scalars().all())

    @staticmethod
    def _bounded_activity_rows(
        session: Any,
        *,
        model: Any,
        account_ids: list[int],
        date_column: Any,
        window_size: int,
        extra_filter: Any | None = None,
    ) -> list[Any]:
        if not account_ids:
            return []
        filters = [model.account_id.in_(account_ids)]
        if extra_filter is not None:
            filters.append(extra_filter)
        base_filter = and_(*filters)
        limited_rows = list(
            session.execute(
                select(model)
                .where(base_filter)
                .order_by(desc(date_column), desc(model.id))
                .limit(max(1, int(window_size)))
            ).scalars().all()
        )
        if len(limited_rows) < max(1, int(window_size)):
            return limited_rows
        boundary_date = getattr(limited_rows[-1], getattr(date_column, "key", ""), None)
        if boundary_date is None:
            return limited_rows
        return list(
            session.execute(
                select(model)
                .where(and_(base_filter, date_column >= boundary_date))
                .order_by(desc(date_column), desc(model.id))
            ).scalars().all()
        )

    @staticmethod
    def _connections(session: Any, *, user_id: str, account_ids: list[int]) -> list[Any]:
        if not account_ids:
            return []
        return list(
            session.execute(
                select(PortfolioBrokerConnection)
                .where(
                    and_(
                        PortfolioBrokerConnection.owner_id == user_id,
                        PortfolioBrokerConnection.portfolio_account_id.in_(account_ids),
                    )
                )
                .order_by(PortfolioBrokerConnection.id.asc())
            ).scalars().all()
        )

    @staticmethod
    def _connections_by_account(connections: list[Any]) -> dict[int, list[Any]]:
        grouped: dict[int, list[Any]] = {}
        for row in connections:
            grouped.setdefault(int(row.portfolio_account_id), []).append(row)
        return grouped

    @staticmethod
    def _latest_sync_by_account(session: Any, *, user_id: str, account_ids: list[int]) -> dict[int, Any]:
        latest: dict[int, Any] = {}
        if not account_ids:
            return latest
        rows = session.execute(
            select(PortfolioBrokerSyncState)
            .where(and_(PortfolioBrokerSyncState.owner_id == user_id, PortfolioBrokerSyncState.portfolio_account_id.in_(account_ids)))
            .order_by(PortfolioBrokerSyncState.portfolio_account_id.asc(), desc(PortfolioBrokerSyncState.synced_at), desc(PortfolioBrokerSyncState.id))
        ).scalars().all()
        for row in rows:
            latest.setdefault(int(row.portfolio_account_id), row)
        return latest

    @staticmethod
    def _ledger_counts(session: Any, *, account_ids: list[int]) -> dict[str, int]:
        if not account_ids:
            return _empty_ledger_counts()
        active_trade = and_(
            PortfolioTrade.account_id.in_(account_ids),
            or_(PortfolioTrade.is_active.is_(True), PortfolioTrade.is_active.is_(None)),
        )
        return {
            "trades": int(session.execute(select(func.count()).select_from(PortfolioTrade).where(active_trade)).scalar() or 0),
            "cash_events": int(session.execute(select(func.count()).select_from(PortfolioCashLedger).where(PortfolioCashLedger.account_id.in_(account_ids))).scalar() or 0),
            "corporate_actions": int(session.execute(select(func.count()).select_from(PortfolioCorporateAction).where(PortfolioCorporateAction.account_id.in_(account_ids))).scalar() or 0),
        }

    @staticmethod
    def _account_item(row: Any, connections: list[Any]) -> dict[str, Any]:
        handle = _broker_account_handle(getattr(connections[0], "broker_account_ref", None)) if connections else None
        return {
            "id": int(row.id),
            "name": str(row.name),
            "broker": row.broker,
            "market": row.market,
            "base_currency": row.base_currency,
            "is_active": bool(row.is_active),
            "broker_account_handle": handle,
            "created_at": _iso(row.created_at),
            "updated_at": _iso(row.updated_at),
        }

    @staticmethod
    def _connection_item(row: Any) -> dict[str, Any]:
        return {
            "id": int(row.id),
            "account_id": int(row.portfolio_account_id),
            "broker_type": str(row.broker_type),
            "broker_name": row.broker_name,
            "connection_name": str(row.connection_name),
            "broker_account_handle": _broker_account_handle(row.broker_account_ref),
            "import_mode": row.import_mode,
            "status": str(row.status),
            "last_imported_at": _iso(row.last_imported_at),
            "last_import_source": row.last_import_source,
            "created_at": _iso(row.created_at),
            "updated_at": _iso(row.updated_at),
        }

    @staticmethod
    def _sync_state_item(
        row: Any | None,
    ) -> dict[str, Any] | None:
        if row is None:
            return None
        currency = str(getattr(row, "base_currency", "") or "").upper() or None

        # A sync row has no immutable link to a cost-method snapshot. Keeping
        # these amounts unavailable prevents canonical money from acquiring
        # unverified broker-sync provenance.
        def unavailable_money() -> dict[str, Any]:
            return {
                "amount": None,
                "currency": currency,
            }

        return {
            "status": row.sync_status,
            "source": row.sync_source,
            "snapshot_date": _iso(row.snapshot_date),
            "synced_at": _iso(row.synced_at),
            "base_currency": currency,
            "total_cash": unavailable_money(),
            "total_market_value": unavailable_money(),
            "total_equity": unavailable_money(),
            "realized_pnl": unavailable_money(),
            "unrealized_pnl": unavailable_money(),
            "fx_stale": None,
        }
