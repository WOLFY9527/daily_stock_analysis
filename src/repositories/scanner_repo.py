# -*- coding: utf-8 -*-
"""Repository helpers for the Market Scanner domain."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, desc, func, or_, select

from src.multi_user import OWNERSHIP_SCOPE_SYSTEM, OWNERSHIP_SCOPE_USER, normalize_scope
from src.storage import (
    DatabaseManager,
    MarketScannerCandidate,
    MarketScannerRun,
)
from src.utils.symbol_normalization import (
    canonical_symbol_storage_values,
    normalize_symbol_market,
    parse_canonical_symbol,
)


class ScannerRepository:
    """Persistence layer for scanner runs and shortlisted candidates."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def _sync_phase_d_run_shadow(
        self,
        *,
        run: Optional[MarketScannerRun],
        candidates: List[MarketScannerCandidate],
    ) -> None:
        if run is None:
            return
        if not getattr(self.db, "_phase_d_enabled", False):
            return
        phase_d_store = getattr(self.db, "_phase_d_store", None)
        if phase_d_store is None:
            return
        phase_d_store.upsert_scanner_run_shadow(
            run_row=run,
            candidate_rows=candidates,
        )

    def save_run_with_candidates(
        self,
        *,
        run: MarketScannerRun,
        candidates: List[MarketScannerCandidate],
    ) -> MarketScannerRun:
        run.scope = normalize_scope(getattr(run, "scope", None))
        if run.scope == OWNERSHIP_SCOPE_USER:
            run.owner_id = self.db.require_user_id(getattr(run, "owner_id", None))
        else:
            run.owner_id = None
        with self.db.get_session() as session:
            session.add(run)
            session.flush()
            for candidate in candidates:
                candidate.run_id = run.id
            session.add_all(candidates)
            session.flush()
            self._sync_phase_d_run_shadow(run=run, candidates=candidates)
            session.commit()
            session.refresh(run)
            return run

    def get_runs_paginated(
        self,
        *,
        market: Optional[str],
        profile: Optional[str],
        offset: int,
        limit: int,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> Tuple[List[MarketScannerRun], int]:
        with self.db.get_session() as session:
            conditions = self._build_run_visibility_conditions(
                scope=scope,
                owner_id=owner_id,
                include_all_owners=include_all_owners,
            )
            if market:
                conditions.append(MarketScannerRun.market == market)
            if profile:
                conditions.append(MarketScannerRun.profile == profile)

            where_clause = and_(*conditions) if conditions else True
            total = session.execute(
                select(func.count(MarketScannerRun.id)).where(where_clause)
            ).scalar() or 0
            rows = session.execute(
                select(MarketScannerRun)
                .where(where_clause)
                .order_by(desc(MarketScannerRun.run_at))
                .offset(offset)
                .limit(limit)
            ).scalars().all()
            return list(rows), int(total)

    def get_run(
        self,
        run_id: int,
        *,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> Optional[MarketScannerRun]:
        with self.db.get_session() as session:
            conditions = [MarketScannerRun.id == run_id]
            conditions.extend(
                self._build_run_visibility_conditions(
                    scope=scope,
                    owner_id=owner_id,
                    include_all_owners=include_all_owners,
                )
            )
            return session.execute(
                select(MarketScannerRun)
                .where(and_(*conditions))
                .limit(1)
            ).scalar_one_or_none()

    def get_recent_runs(
        self,
        *,
        market: Optional[str],
        profile: Optional[str],
        limit: int = 20,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> List[MarketScannerRun]:
        with self.db.get_session() as session:
            conditions = self._build_run_visibility_conditions(
                scope=scope,
                owner_id=owner_id,
                include_all_owners=include_all_owners,
            )
            if market:
                conditions.append(MarketScannerRun.market == market)
            if profile:
                conditions.append(MarketScannerRun.profile == profile)

            where_clause = and_(*conditions) if conditions else True
            rows = session.execute(
                select(MarketScannerRun)
                .where(where_clause)
                .order_by(desc(MarketScannerRun.run_at), desc(MarketScannerRun.id))
                .limit(limit)
            ).scalars().all()
            return list(rows)

    def get_runs_before(
        self,
        *,
        market: Optional[str],
        profile: Optional[str],
        run_at: datetime,
        run_id: int,
        limit: int = 20,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> List[MarketScannerRun]:
        with self.db.get_session() as session:
            conditions = self._build_run_visibility_conditions(
                scope=scope,
                owner_id=owner_id,
                include_all_owners=include_all_owners,
            )
            conditions.append(
                or_(
                    MarketScannerRun.run_at < run_at,
                    and_(MarketScannerRun.run_at == run_at, MarketScannerRun.id < run_id),
                )
            )
            if market:
                conditions.append(MarketScannerRun.market == market)
            if profile:
                conditions.append(MarketScannerRun.profile == profile)

            rows = session.execute(
                select(MarketScannerRun)
                .where(and_(*conditions))
                .order_by(desc(MarketScannerRun.run_at), desc(MarketScannerRun.id))
                .limit(limit)
            ).scalars().all()
            return list(rows)

    def get_candidates_for_run(self, run_id: int) -> List[MarketScannerCandidate]:
        with self.db.get_session() as session:
            rows = session.execute(
                select(MarketScannerCandidate)
                .where(MarketScannerCandidate.run_id == run_id)
                .order_by(MarketScannerCandidate.rank.asc(), MarketScannerCandidate.id.asc())
            ).scalars().all()
            return list(rows)

    def get_latest_completed_candidates_by_market_symbol(
        self,
        *,
        pairs: List[Tuple[str, str]],
        owner_id: str,
    ) -> tuple[
        Dict[Tuple[str, str], Tuple[MarketScannerCandidate, MarketScannerRun]],
        set[Tuple[str, str]],
    ]:
        """Return owner-visible latest candidates and fail-closed storage identity conflicts."""
        requested_pairs: set[Tuple[str, str]] = set()
        storage_symbols_by_pair: Dict[Tuple[str, str], tuple[str, ...]] = {}
        for market, symbol in pairs:
            market_text = str(market or "").strip().lower()
            symbol_text = str(symbol or "").strip()
            market_hint = normalize_symbol_market(market_text)
            if market_hint is None or not symbol_text:
                continue

            identity = parse_canonical_symbol(symbol_text, market=market_hint)
            if (
                identity is None
                or identity.ambiguous
                or identity.market != market_hint
            ):
                continue

            key = (market_hint, identity.symbol)
            storage_symbols = canonical_symbol_storage_values(
                identity.symbol,
                market=market_hint,
            )
            requested_pairs.add(key)
            storage_symbols_by_pair[key] = storage_symbols
        if not requested_pairs:
            return {}, set()

        symbols_by_market: Dict[str, set[str]] = {}
        for key in sorted(requested_pairs):
            market, _ = key
            symbols_by_market.setdefault(market, set()).update(storage_symbols_by_pair[key])

        market_symbol_clauses = [
            and_(
                MarketScannerRun.market == market,
                MarketScannerCandidate.symbol.in_(sorted(symbols)),
            )
            for market, symbols in symbols_by_market.items()
        ]

        with self.db.get_session() as session:
            storage_rank = func.row_number().over(
                partition_by=(MarketScannerRun.market, MarketScannerCandidate.symbol),
                order_by=(
                    MarketScannerRun.completed_at.desc().nulls_last(),
                    MarketScannerRun.run_at.desc().nulls_last(),
                    desc(MarketScannerRun.id),
                    desc(MarketScannerCandidate.id),
                ),
            ).label("storage_rank")
            ranked_candidates = (
                select(
                    MarketScannerCandidate.id.label("candidate_id"),
                    storage_rank,
                )
                .join(MarketScannerRun, MarketScannerRun.id == MarketScannerCandidate.run_id)
                .where(
                    and_(
                        *self._build_run_visibility_conditions(
                            scope=None,
                            owner_id=owner_id,
                            include_all_owners=False,
                        ),
                        MarketScannerRun.status == "completed",
                        or_(*market_symbol_clauses),
                    )
                )
                .subquery()
            )
            rows = session.execute(
                select(MarketScannerCandidate, MarketScannerRun)
                .join(MarketScannerRun, MarketScannerRun.id == MarketScannerCandidate.run_id)
                .join(
                    ranked_candidates,
                    ranked_candidates.c.candidate_id == MarketScannerCandidate.id,
                )
                .where(ranked_candidates.c.storage_rank == 1)
                .order_by(
                    MarketScannerRun.completed_at.desc().nulls_last(),
                    MarketScannerRun.run_at.desc().nulls_last(),
                    desc(MarketScannerRun.id),
                    desc(MarketScannerCandidate.id),
                )
            ).all()

        latest_by_pair: Dict[Tuple[str, str], Tuple[MarketScannerCandidate, MarketScannerRun]] = {}
        conflicting_pairs: set[Tuple[str, str]] = set()
        for candidate, run in rows:
            market_text = str(run.market or "").strip().lower()
            symbol_text = str(candidate.symbol or "").strip()
            market_hint = normalize_symbol_market(market_text)
            identity = parse_canonical_symbol(symbol_text, market=market_hint)
            if (
                market_hint is None
                or identity is None
                or identity.ambiguous
                or identity.market != market_hint
            ):
                continue
            key = (market_hint, identity.symbol)
            if key not in requested_pairs or key in conflicting_pairs:
                continue
            existing = latest_by_pair.get(key)
            if existing is not None and int(existing[1].id) == int(run.id):
                conflicting_pairs.add(key)
                latest_by_pair.pop(key, None)
                continue
            if existing is None:
                latest_by_pair[key] = (candidate, run)
        return latest_by_pair, conflicting_pairs

    def list_recent_analysis_symbols(
        self,
        *,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
        limit: Optional[int] = None,
    ) -> List[Tuple[str, Optional[str]]]:
        """Return recent analysis-history codes and names for scanner-local fallbacks."""
        return self.db.list_recent_analysis_symbols(
            owner_id=owner_id,
            include_all_owners=include_all_owners,
            limit=limit,
        )

    def count_recent_symbol_mentions(
        self,
        *,
        symbol: str,
        market: str,
        profile: str,
        exclude_run_id: Optional[int] = None,
        recent_run_limit: int = 5,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> int:
        with self.db.get_session() as session:
            recent_run_query = (
                select(MarketScannerRun.id)
                .where(
                    and_(
                        *self._build_run_visibility_conditions(
                            scope=scope,
                            owner_id=owner_id,
                            include_all_owners=include_all_owners,
                        ),
                        MarketScannerRun.market == market,
                        MarketScannerRun.profile == profile,
                    )
                )
                .order_by(desc(MarketScannerRun.run_at))
            )
            if exclude_run_id is not None:
                recent_run_query = recent_run_query.where(MarketScannerRun.id != exclude_run_id)
            recent_run_ids = session.execute(recent_run_query.limit(recent_run_limit)).scalars().all()
            if not recent_run_ids:
                return 0

            return int(
                session.execute(
                    select(func.count(func.distinct(MarketScannerCandidate.run_id)))
                    .where(
                        and_(
                            MarketScannerCandidate.symbol == symbol,
                            MarketScannerCandidate.run_id.in_(recent_run_ids),
                        )
                    )
                ).scalar() or 0
            )

    def update_candidate_diagnostics(
        self,
        candidate_id: int,
        *,
        diagnostics_json: str,
    ) -> Optional[MarketScannerCandidate]:
        with self.db.get_session() as session:
            candidate = session.execute(
                select(MarketScannerCandidate)
                .where(MarketScannerCandidate.id == candidate_id)
                .limit(1)
            ).scalar_one_or_none()
            if candidate is None:
                return None

            candidate.diagnostics_json = diagnostics_json
            session.add(candidate)
            session.flush()
            run = session.execute(
                select(MarketScannerRun)
                .where(MarketScannerRun.id == candidate.run_id)
                .limit(1)
            ).scalar_one_or_none()
            candidate_rows = session.execute(
                select(MarketScannerCandidate)
                .where(MarketScannerCandidate.run_id == candidate.run_id)
                .order_by(MarketScannerCandidate.rank.asc(), MarketScannerCandidate.id.asc())
            ).scalars().all()
            self._sync_phase_d_run_shadow(run=run, candidates=list(candidate_rows))
            session.commit()
            session.refresh(candidate)
            return candidate

    def update_run(
        self,
        run_id: int,
        *,
        status: Optional[str] = None,
        source_summary: Optional[str] = None,
        summary_json: Optional[str] = None,
        diagnostics_json: Optional[str] = None,
        universe_notes_json: Optional[str] = None,
        scoring_notes_json: Optional[str] = None,
        completed_at: Optional[datetime] = None,
        shortlist_size: Optional[int] = None,
        universe_size: Optional[int] = None,
        preselected_size: Optional[int] = None,
        evaluated_size: Optional[int] = None,
        scope: Optional[str] = None,
        owner_id: Optional[str] = None,
        include_all_owners: bool = False,
    ) -> Optional[MarketScannerRun]:
        with self.db.get_session() as session:
            conditions = [MarketScannerRun.id == run_id]
            conditions.extend(
                self._build_run_visibility_conditions(
                    scope=scope,
                    owner_id=owner_id,
                    include_all_owners=include_all_owners,
                )
            )
            run = session.execute(
                select(MarketScannerRun)
                .where(and_(*conditions))
                .limit(1)
            ).scalar_one_or_none()
            if run is None:
                return None

            if status is not None:
                run.status = status
            if source_summary is not None:
                run.source_summary = source_summary
            if summary_json is not None:
                run.summary_json = summary_json
            if diagnostics_json is not None:
                run.diagnostics_json = diagnostics_json
            if universe_notes_json is not None:
                run.universe_notes_json = universe_notes_json
            if scoring_notes_json is not None:
                run.scoring_notes_json = scoring_notes_json
            if completed_at is not None:
                run.completed_at = completed_at
            if shortlist_size is not None:
                run.shortlist_size = int(shortlist_size)
            if universe_size is not None:
                run.universe_size = int(universe_size)
            if preselected_size is not None:
                run.preselected_size = int(preselected_size)
            if evaluated_size is not None:
                run.evaluated_size = int(evaluated_size)

            session.add(run)
            session.flush()
            candidate_rows = session.execute(
                select(MarketScannerCandidate)
                .where(MarketScannerCandidate.run_id == run.id)
                .order_by(MarketScannerCandidate.rank.asc(), MarketScannerCandidate.id.asc())
            ).scalars().all()
            self._sync_phase_d_run_shadow(run=run, candidates=list(candidate_rows))
            session.commit()
            session.refresh(run)
            return run

    def _build_run_visibility_conditions(
        self,
        *,
        scope: Optional[str],
        owner_id: Optional[str],
        include_all_owners: bool,
    ) -> List[Any]:
        if include_all_owners:
            return []

        normalized_scope = str(scope or "").strip().lower() or None
        if normalized_scope == OWNERSHIP_SCOPE_SYSTEM:
            return [MarketScannerRun.scope == OWNERSHIP_SCOPE_SYSTEM]
        if normalized_scope == OWNERSHIP_SCOPE_USER:
            return [
                MarketScannerRun.scope == OWNERSHIP_SCOPE_USER,
                MarketScannerRun.owner_id == self.db.require_user_id(owner_id),
            ]
        return [
            or_(
                and_(
                    MarketScannerRun.scope == OWNERSHIP_SCOPE_USER,
                    MarketScannerRun.owner_id == self.db.require_user_id(owner_id),
                ),
                MarketScannerRun.scope == OWNERSHIP_SCOPE_SYSTEM,
            )
        ]
