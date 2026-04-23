# -*- coding: utf-8 -*-
"""Narrow Phase B persistence adapter for PostgreSQL-backed analysis/chat data."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

from sqlalchemy import (
    JSON,
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
)
from sqlalchemy.orm import Session

from src.postgres_identity_store import PhaseABase
from src.postgres_store_utils import (
    apply_baseline_schema,
    baseline_sql_doc_path,
    build_schema_apply_report,
    create_session_factory,
    create_store_engine,
    describe_store_runtime,
    load_baseline_sql_statements,
    managed_session_scope,
)

logger = logging.getLogger(__name__)

PhaseBBase = PhaseABase

_BIGINT_PK = BigInteger().with_variant(Integer, "sqlite")
_PHASE_B_TABLES = {
    "analysis_sessions",
    "analysis_records",
    "chat_sessions",
    "chat_messages",
}
_PHASE_B_INDEXES = {
    "idx_analysis_sessions_user_updated",
    "idx_analysis_records_symbol_created",
    "idx_chat_sessions_user_updated",
    "idx_chat_messages_session_created",
}


class PhaseBAnalysisSession(PhaseBBase):
    __tablename__ = "analysis_sessions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"))
    guest_session_id = Column(String(64), ForeignKey("guest_sessions.session_id"))
    session_kind = Column(String(32), nullable=False, default="analysis")
    source_channel = Column(Text)
    current_symbol = Column(Text)
    current_query = Column(Text)
    status = Column(String(16), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    expires_at = Column(DateTime(timezone=True))


class PhaseBAnalysisRecord(PhaseBBase):
    __tablename__ = "analysis_records"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    analysis_session_id = Column(_BIGINT_PK, ForeignKey("analysis_sessions.id"), nullable=False, index=True)
    sequence_no = Column(Integer, nullable=False)
    legacy_analysis_history_id = Column(_BIGINT_PK, unique=True, index=True)
    query_id = Column(Text)
    canonical_symbol = Column(Text, nullable=False, index=True)
    display_name = Column(Text)
    report_type = Column(Text, nullable=False)
    preview_scope = Column(String(16), nullable=False, default="user")
    sentiment_score = Column(Integer)
    operation_advice = Column(Text)
    trend_prediction = Column(Text)
    summary_text = Column(Text)
    report_payload = Column(JSON, nullable=False, default=dict)
    context_snapshot = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint("analysis_session_id", "sequence_no", name="uq_phase_b_analysis_records_session_seq"),
    )


class PhaseBChatSession(PhaseBBase):
    __tablename__ = "chat_sessions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    session_key = Column(Text, nullable=False, unique=True, index=True)
    owner_user_id = Column(String(64), ForeignKey("app_users.id"))
    guest_session_id = Column(String(64), ForeignKey("guest_sessions.session_id"))
    linked_analysis_session_id = Column(_BIGINT_PK, ForeignKey("analysis_sessions.id"))
    title = Column(Text)
    status = Column(String(16), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    expires_at = Column(DateTime(timezone=True))


class PhaseBChatMessage(PhaseBBase):
    __tablename__ = "chat_messages"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    chat_session_id = Column(_BIGINT_PK, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    message_index = Column(Integer, nullable=False)
    role = Column(Text, nullable=False)
    content_text = Column(Text)
    content_json = Column(JSON, nullable=False, default=dict)
    token_usage_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        UniqueConstraint("chat_session_id", "message_index", name="uq_phase_b_chat_messages_session_index"),
    )


def _phase_b_sql_doc_path() -> Path:
    return baseline_sql_doc_path()


def load_phase_b_sql_statements() -> list[str]:
    """Extract only the Phase B DDL statements from the authoritative baseline SQL doc."""
    return load_baseline_sql_statements(
        table_names=_PHASE_B_TABLES,
        index_names=_PHASE_B_INDEXES,
        source_path=_phase_b_sql_doc_path(),
    )


class PostgresPhaseBStore:
    """Narrow storage adapter for the PostgreSQL Phase B baseline."""
    SCHEMA_KEY = "phase_b"
    MODE = "shadow_bridge"
    EXPECTED_TABLES = _PHASE_B_TABLES
    EXPECTED_INDEXES = _PHASE_B_INDEXES
    EXPECTED_CONSTRAINTS: tuple[tuple[str, str], ...] = ()

    def __init__(self, db_url: str, *, auto_apply_schema: bool = True):
        if not str(db_url or "").strip():
            raise ValueError("db_url is required for PostgresPhaseBStore")

        self.db_url = str(db_url).strip()
        self._engine = create_store_engine(self.db_url)
        self._SessionLocal = create_session_factory(self._engine)
        self._last_schema_apply_report = build_schema_apply_report(
            schema_key=self.SCHEMA_KEY,
            status="skipped" if not auto_apply_schema else "pending",
            source_path=_phase_b_sql_doc_path(),
            dialect=self._engine.dialect.name,
            skip_reason="auto_apply_schema_disabled" if not auto_apply_schema else None,
        )

        if auto_apply_schema:
            self.apply_schema()

    def dispose(self) -> None:
        self._engine.dispose()

    def apply_schema(self) -> None:
        try:
            self._last_schema_apply_report = apply_baseline_schema(
                self._engine,
                schema_key=self.SCHEMA_KEY,
                metadata=PhaseBBase.metadata,
                table_names=self.EXPECTED_TABLES,
                index_names=self.EXPECTED_INDEXES,
                constraint_names=self.EXPECTED_CONSTRAINTS,
                source_path=_phase_b_sql_doc_path(),
            )
        except Exception as exc:
            self._last_schema_apply_report = build_schema_apply_report(
                schema_key=self.SCHEMA_KEY,
                status="failed",
                source_path=_phase_b_sql_doc_path(),
                dialect=self._engine.dialect.name,
                error=f"{exc.__class__.__name__}: {exc}",
            )
            logger.exception("Phase B schema initialization failed")
            raise

    def get_session(self) -> Session:
        return self._SessionLocal()

    @contextmanager
    def session_scope(self):
        with managed_session_scope(self._SessionLocal) as session:
            yield session

    def describe_runtime(self, *, include_connection_probe: bool = False) -> dict[str, Any]:
        return describe_store_runtime(
            self._engine,
            schema_key=self.SCHEMA_KEY,
            mode=self.MODE,
            source_path=_phase_b_sql_doc_path(),
            expected_tables=self.EXPECTED_TABLES,
            expected_indexes=self.EXPECTED_INDEXES,
            expected_constraints=self.EXPECTED_CONSTRAINTS,
            last_schema_apply_report=self._last_schema_apply_report,
            include_connection_probe=include_connection_probe,
        )

    @staticmethod
    def _safe_json_load(value: Any) -> Dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                parsed = json.loads(text)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def upsert_analysis_history_shadow(
        self,
        *,
        legacy_analysis_history_id: int,
        owner_user_id: str,
        query_id: Optional[str],
        canonical_symbol: str,
        display_name: Optional[str],
        report_type: str,
        sentiment_score: Optional[int],
        operation_advice: Optional[str],
        trend_prediction: Optional[str],
        summary_text: Optional[str],
        raw_result: Any,
        news_content: Optional[str],
        context_snapshot: Any,
        created_at: Optional[datetime] = None,
    ) -> PhaseBAnalysisRecord:
        normalized_owner_user_id = str(owner_user_id or "").strip()
        normalized_symbol = str(canonical_symbol or "").strip()
        if not normalized_owner_user_id:
            raise ValueError("owner_user_id is required")
        if not normalized_symbol:
            raise ValueError("canonical_symbol is required")
        if legacy_analysis_history_id is None:
            raise ValueError("legacy_analysis_history_id is required")

        record_payload = self._safe_json_load(raw_result)
        if news_content is not None:
            record_payload = dict(record_payload)
            record_payload["news_content"] = news_content
        context_payload = self._safe_json_load(context_snapshot)
        now = created_at or datetime.now()

        with self.session_scope() as session:
            row = session.execute(
                select(PhaseBAnalysisRecord)
                .where(PhaseBAnalysisRecord.legacy_analysis_history_id == int(legacy_analysis_history_id))
                .limit(1)
            ).scalar_one_or_none()
            if row is not None:
                row.query_id = query_id
                row.canonical_symbol = normalized_symbol
                row.display_name = (display_name or "").strip() or None
                row.report_type = str(report_type or "").strip() or row.report_type
                row.sentiment_score = sentiment_score
                row.operation_advice = (operation_advice or "").strip() or None
                row.trend_prediction = (trend_prediction or "").strip() or None
                row.summary_text = (summary_text or "").strip() or None
                row.report_payload = record_payload
                row.context_snapshot = context_payload
                row.created_at = now
                linked_session = session.execute(
                    select(PhaseBAnalysisSession)
                    .where(PhaseBAnalysisSession.id == row.analysis_session_id)
                    .limit(1)
                ).scalar_one()
                linked_session.owner_user_id = normalized_owner_user_id
                linked_session.current_symbol = normalized_symbol
                linked_session.current_query = query_id
                linked_session.updated_at = now
                return row

            analysis_session = PhaseBAnalysisSession(
                owner_user_id=normalized_owner_user_id,
                guest_session_id=None,
                session_kind="analysis",
                source_channel="legacy_sqlite_bridge",
                current_symbol=normalized_symbol,
                current_query=query_id,
                status="archived",
                created_at=now,
                updated_at=now,
            )
            session.add(analysis_session)
            session.flush()

            row = PhaseBAnalysisRecord(
                analysis_session_id=analysis_session.id,
                sequence_no=1,
                legacy_analysis_history_id=int(legacy_analysis_history_id),
                query_id=query_id,
                canonical_symbol=normalized_symbol,
                display_name=(display_name or "").strip() or None,
                report_type=str(report_type or "").strip() or "simple",
                preview_scope="user",
                sentiment_score=sentiment_score,
                operation_advice=(operation_advice or "").strip() or None,
                trend_prediction=(trend_prediction or "").strip() or None,
                summary_text=(summary_text or "").strip() or None,
                report_payload=record_payload,
                context_snapshot=context_payload,
                created_at=now,
            )
            session.add(row)
            session.flush()
            return row

    def delete_analysis_history_shadow(self, legacy_analysis_history_ids: Sequence[int]) -> int:
        normalized_ids = [int(value) for value in legacy_analysis_history_ids if value is not None]
        if not normalized_ids:
            return 0

        with self.session_scope() as session:
            rows = session.execute(
                select(PhaseBAnalysisRecord)
                .where(PhaseBAnalysisRecord.legacy_analysis_history_id.in_(normalized_ids))
            ).scalars().all()
            if not rows:
                return 0
            session_ids = sorted({int(row.analysis_session_id) for row in rows if row.analysis_session_id is not None})
            deleted = session.execute(
                delete(PhaseBAnalysisRecord)
                .where(PhaseBAnalysisRecord.legacy_analysis_history_id.in_(normalized_ids))
            ).rowcount or 0

            if session_ids:
                empty_session_ids = session.execute(
                    select(PhaseBAnalysisSession.id)
                    .where(PhaseBAnalysisSession.id.in_(session_ids))
                    .where(
                        ~PhaseBAnalysisSession.id.in_(
                            select(PhaseBAnalysisRecord.analysis_session_id)
                        )
                    )
                ).scalars().all()
                if empty_session_ids:
                    session.execute(
                        delete(PhaseBAnalysisSession)
                        .where(PhaseBAnalysisSession.id.in_(list(empty_session_ids)))
                    )
            return int(deleted)

    def append_chat_message_shadow(
        self,
        *,
        session_key: str,
        owner_user_id: str,
        role: str,
        content: str,
        title_hint: Optional[str] = None,
        created_at: Optional[datetime] = None,
    ) -> PhaseBChatMessage:
        normalized_session_key = str(session_key or "").strip()
        normalized_owner_user_id = str(owner_user_id or "").strip()
        normalized_role = str(role or "").strip()
        if not normalized_session_key:
            raise ValueError("session_key is required")
        if not normalized_owner_user_id:
            raise ValueError("owner_user_id is required")
        if not normalized_role:
            raise ValueError("role is required")
        now = created_at or datetime.now()

        with self.session_scope() as session:
            chat_session = session.execute(
                select(PhaseBChatSession)
                .where(PhaseBChatSession.session_key == normalized_session_key)
                .limit(1)
            ).scalar_one_or_none()
            if chat_session is None:
                chat_session = PhaseBChatSession(
                    session_key=normalized_session_key,
                    owner_user_id=normalized_owner_user_id,
                    guest_session_id=None,
                    linked_analysis_session_id=None,
                    title=(title_hint or "").strip()[:255] or None,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
                session.add(chat_session)
                session.flush()
            else:
                if chat_session.owner_user_id and chat_session.owner_user_id != normalized_owner_user_id:
                    raise ValueError(f"Conversation session {normalized_session_key} belongs to another owner")
                chat_session.owner_user_id = normalized_owner_user_id
                if title_hint and not chat_session.title:
                    chat_session.title = title_hint.strip()[:255] or None
                chat_session.updated_at = now

            current_max_index = session.execute(
                select(func.coalesce(func.max(PhaseBChatMessage.message_index), -1))
                .where(PhaseBChatMessage.chat_session_id == chat_session.id)
            ).scalar()
            next_index = int(-1 if current_max_index is None else current_max_index) + 1
            row = PhaseBChatMessage(
                chat_session_id=chat_session.id,
                message_index=next_index,
                role=normalized_role,
                content_text=str(content or ""),
                content_json={},
                token_usage_json={},
                created_at=now,
            )
            session.add(row)
            session.flush()
            return row

    def delete_chat_session_shadow(self, session_key: str, *, owner_user_id: Optional[str] = None) -> int:
        normalized_session_key = str(session_key or "").strip()
        if not normalized_session_key:
            return 0
        normalized_owner_user_id = str(owner_user_id or "").strip() or None

        with self.session_scope() as session:
            chat_session = session.execute(
                select(PhaseBChatSession)
                .where(PhaseBChatSession.session_key == normalized_session_key)
                .limit(1)
            ).scalar_one_or_none()
            if chat_session is None:
                return 0
            if normalized_owner_user_id and chat_session.owner_user_id != normalized_owner_user_id:
                raise ValueError(f"Conversation session {normalized_session_key} belongs to another owner")
            deleted = session.execute(
                delete(PhaseBChatMessage).where(PhaseBChatMessage.chat_session_id == chat_session.id)
            ).rowcount or 0
            session.execute(
                delete(PhaseBChatSession).where(PhaseBChatSession.id == chat_session.id)
            )
            return int(deleted)

    def clear_non_bootstrap_state(self, user_ids: Sequence[str]) -> Dict[str, int]:
        normalized_user_ids = [str(value).strip() for value in user_ids if str(value or "").strip()]
        if not normalized_user_ids:
            return {
                "chat_messages": 0,
                "chat_sessions": 0,
                "analysis_records": 0,
                "analysis_sessions": 0,
            }

        with self.session_scope() as session:
            analysis_session_ids = session.execute(
                select(PhaseBAnalysisSession.id).where(
                    PhaseBAnalysisSession.owner_user_id.in_(normalized_user_ids)
                )
            ).scalars().all()
            chat_session_ids = session.execute(
                select(PhaseBChatSession.id).where(
                    PhaseBChatSession.owner_user_id.in_(normalized_user_ids)
                )
            ).scalars().all()
            counts = {
                "chat_messages": session.execute(
                    delete(PhaseBChatMessage).where(
                        PhaseBChatMessage.chat_session_id.in_(chat_session_ids)
                    )
                ).rowcount or 0 if chat_session_ids else 0,
                "chat_sessions": session.execute(
                    delete(PhaseBChatSession).where(
                        PhaseBChatSession.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0,
                "analysis_records": session.execute(
                    delete(PhaseBAnalysisRecord).where(
                        PhaseBAnalysisRecord.analysis_session_id.in_(analysis_session_ids)
                    )
                ).rowcount or 0 if analysis_session_ids else 0,
                "analysis_sessions": session.execute(
                    delete(PhaseBAnalysisSession).where(
                        PhaseBAnalysisSession.owner_user_id.in_(normalized_user_ids)
                    )
                ).rowcount or 0,
            }
        return counts
