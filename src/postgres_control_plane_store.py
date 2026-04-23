# -*- coding: utf-8 -*-
"""Narrow Phase G persistence adapter for PostgreSQL-backed control-plane data."""

from __future__ import annotations

import json
import logging
import re
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    asc,
    delete,
    desc,
    or_,
    select,
)
from sqlalchemy.orm import Session

from src.postgres_phase_a import PhaseABase
from src.postgres_phase_b import PhaseBAnalysisRecord  # noqa: F401
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

PhaseGBase = PhaseABase

_BIGINT_PK = BigInteger().with_variant(Integer, "sqlite")
_PHASE_G_TABLES = {
    "execution_sessions",
    "execution_events",
    "provider_configs",
    "system_configs",
    "admin_logs",
    "system_actions",
}
_PHASE_G_INDEXES = {
    "idx_execution_sessions_started",
    "idx_execution_sessions_owner_started",
    "idx_execution_events_session_time",
    "idx_execution_events_phase_status",
    "idx_admin_logs_occurred",
    "idx_system_actions_created",
}
_EXECUTION_SUBSYSTEM_OWNERSHIP = {
    "analysis": {
        "domain_store": "phase_b",
        "domain_entity": "analysis_records",
        "description": "analysis execution trace linked to Phase B shadow rows when available",
    },
    "scanner": {
        "domain_store": "phase_d",
        "domain_entity": "scanner_runs",
        "description": "scanner execution trace linked to Phase D shadow rows",
    },
    "system_control": {
        "domain_store": "phase_g",
        "domain_entity": "system_actions",
        "description": "system-control execution trace linked to Phase G admin audit rows",
    },
    "backtest": {
        "domain_store": "phase_e",
        "domain_entity": "backtest_runs",
        "description": "backtest execution trace linked to Phase E shadow rows",
    },
    "portfolio": {
        "domain_store": "phase_f",
        "domain_entity": "portfolio_accounts",
        "description": "portfolio execution trace linked to Phase F coexistence rows",
    },
}
_SYSTEM_CONFIG_KEYS = {
    "STOCK_LIST",
    "LITELLM_MODEL",
    "AGENT_LITELLM_MODEL",
    "BACKTEST_LITELLM_MODEL",
    "LITELLM_FALLBACK_MODELS",
    "LITELLM_CONFIG",
    "LLM_CHANNELS",
    "AI_PRIMARY_GATEWAY",
    "AI_PRIMARY_MODEL",
    "AI_BACKUP_GATEWAY",
    "AI_BACKUP_MODEL",
    "LLM_TEMPERATURE",
    "REALTIME_SOURCE_PRIORITY",
    "ENABLE_REALTIME_TECHNICAL_INDICATORS",
    "ENABLE_REALTIME_QUOTE",
    "ENABLE_CHIP_DISTRIBUTION",
    "NEWS_MAX_AGE_DAYS",
    "NEWS_STRATEGY_PROFILE",
    "BIAS_THRESHOLD",
    "CUSTOM_DATA_SOURCE_LIBRARY",
    "SCHEDULE_TIME",
    "LOG_LEVEL",
    "RUN_MODE",
    "ENV_FILE",
    "DATABASE_PATH",
    "POSTGRES_PHASE_A_URL",
    "POSTGRES_PHASE_A_APPLY_SCHEMA",
    "ADMIN_AUTH_ENABLED",
}
_PROVIDER_PREFIXES = {
    "GEMINI_": "gemini",
    "OPENAI_": "openai",
    "AIHUBMIX_": "aihubmix",
    "DEEPSEEK_": "deepseek",
    "ZHIPU_": "zhipu",
    "TUSHARE_": "tushare",
    "TICKFLOW_": "tickflow",
    "ALPACA_": "alpaca",
    "TWELVE_DATA_": "twelve_data",
    "TAVILY_": "tavily",
    "SERPAPI_": "serpapi",
    "BRAVE_": "brave",
    "BOCHA_": "bocha",
    "MINIMAX_": "minimax",
    "SEARXNG_": "searxng",
    "PYTDX_": "pytdx",
    "DISCORD_": "discord",
    "TELEGRAM_": "telegram",
    "SLACK_": "slack",
    "SMTP_": "smtp",
    "EMAIL_": "email",
    "WECHAT_": "wechat",
}
_LLM_CHANNEL_PATTERN = re.compile(
    r"^LLM_([A-Z0-9]+)_(API_KEY|BASE_URL|MODELS|PROTOCOL|ENABLED|EXTRA_HEADERS|EXTRA_BODY|TIMEOUT|TIMEOUT_SECONDS)$"
)


class PhaseGProviderConfig(PhaseGBase):
    __tablename__ = "provider_configs"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    provider_key = Column(Text, nullable=False, unique=True)
    config_scope = Column(Text, nullable=False, default="system")
    auth_mode = Column(Text, nullable=False)
    is_enabled = Column(Boolean, nullable=False, default=True)
    config_json = Column(JSON, nullable=False, default=dict)
    secret_json = Column(JSON, nullable=False, default=dict)
    rotation_version = Column(Integer, nullable=False, default=1)
    updated_by_user_id = Column(Text, ForeignKey("app_users.id"))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        CheckConstraint("config_scope in ('system')", name="ck_phase_g_provider_configs_scope"),
    )


class PhaseGSystemConfig(PhaseGBase):
    __tablename__ = "system_configs"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    config_key = Column(Text, nullable=False, unique=True)
    config_scope = Column(Text, nullable=False, default="system")
    value_type = Column(Text, nullable=False)
    value_json = Column(JSON, nullable=False, default=dict)
    updated_by_user_id = Column(Text, ForeignKey("app_users.id"))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        CheckConstraint("config_scope in ('system')", name="ck_phase_g_system_configs_scope"),
    )


class PhaseGExecutionSession(PhaseGBase):
    __tablename__ = "execution_sessions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    session_id = Column(Text, nullable=False, unique=True, index=True)
    owner_user_id = Column(Text, ForeignKey("app_users.id"))
    actor_user_id = Column(Text, ForeignKey("app_users.id"))
    actor_role = Column(Text)
    session_kind = Column(Text, nullable=False)
    subsystem = Column(Text, nullable=False)
    action_name = Column(Text)
    task_id = Column(Text)
    query_id = Column(Text)
    linked_analysis_record_id = Column(_BIGINT_PK, ForeignKey("analysis_records.id"))
    canonical_symbol = Column(Text)
    display_name = Column(Text)
    overall_status = Column(Text, nullable=False)
    truth_level = Column(Text)
    destructive = Column(Boolean, nullable=False, default=False)
    summary_json = Column(JSON, nullable=False, default=dict)
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    ended_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        CheckConstraint(
            "session_kind in ('user_activity', 'admin_action', 'system_task')",
            name="ck_phase_g_execution_sessions_kind",
        ),
    )


class PhaseGExecutionEvent(PhaseGBase):
    __tablename__ = "execution_events"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    execution_session_id = Column(
        _BIGINT_PK,
        ForeignKey("execution_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    occurred_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    phase = Column(Text, nullable=False)
    step = Column(Text)
    target = Column(Text)
    status = Column(Text, nullable=False)
    truth_level = Column(Text)
    message = Column(Text)
    error_code = Column(Text)
    detail_json = Column(JSON, nullable=False, default=dict)


class PhaseGAdminLog(PhaseGBase):
    __tablename__ = "admin_logs"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    actor_user_id = Column(Text, ForeignKey("app_users.id"))
    actor_role = Column(Text)
    subsystem = Column(Text, nullable=False)
    category = Column(Text)
    event_type = Column(Text, nullable=False)
    target_type = Column(Text)
    target_id = Column(Text)
    scope = Column(Text, nullable=False, default="system")
    severity = Column(Text, nullable=False, default="info")
    outcome = Column(Text)
    message = Column(Text)
    detail_json = Column(JSON, nullable=False, default=dict)
    related_session_key = Column(Text)
    occurred_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)

    __table_args__ = (
        CheckConstraint("scope in ('system')", name="ck_phase_g_admin_logs_scope"),
    )


class PhaseGSystemAction(PhaseGBase):
    __tablename__ = "system_actions"

    id = Column(_BIGINT_PK, primary_key=True, autoincrement=True)
    action_key = Column(Text, nullable=False)
    actor_user_id = Column(Text, ForeignKey("app_users.id"))
    scope = Column(Text, nullable=False, default="system")
    destructive = Column(Boolean, nullable=False, default=False)
    status = Column(Text, nullable=False)
    request_json = Column(JSON, nullable=False, default=dict)
    result_json = Column(JSON, nullable=False, default=dict)
    admin_log_id = Column(_BIGINT_PK, ForeignKey("admin_logs.id"))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    completed_at = Column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("scope in ('system')", name="ck_phase_g_system_actions_scope"),
    )


def _phase_g_sql_doc_path() -> Path:
    return baseline_sql_doc_path()


def load_phase_g_sql_statements() -> list[str]:
    """Extract only the Phase G DDL statements from the authoritative baseline SQL doc."""
    return load_baseline_sql_statements(
        table_names=_PHASE_G_TABLES,
        index_names=_PHASE_G_INDEXES,
        source_path=_phase_g_sql_doc_path(),
    )


class PostgresPhaseGStore:
    """Narrow storage adapter for the PostgreSQL Phase G baseline."""
    SCHEMA_KEY = "phase_g"
    MODE = "env_live_source_with_pg_snapshot"
    EXPECTED_TABLES = _PHASE_G_TABLES
    EXPECTED_INDEXES = _PHASE_G_INDEXES
    EXPECTED_CONSTRAINTS: tuple[tuple[str, str], ...] = ()

    def __init__(self, db_url: str, *, auto_apply_schema: bool = True):
        if not str(db_url or "").strip():
            raise ValueError("db_url is required for PostgresPhaseGStore")

        self.db_url = str(db_url).strip()
        self._engine = create_store_engine(self.db_url)
        self._SessionLocal = create_session_factory(self._engine)
        self._last_schema_apply_report = build_schema_apply_report(
            schema_key=self.SCHEMA_KEY,
            status="skipped" if not auto_apply_schema else "pending",
            source_path=_phase_g_sql_doc_path(),
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
                metadata=PhaseGBase.metadata,
                table_names=self.EXPECTED_TABLES,
                index_names=self.EXPECTED_INDEXES,
                constraint_names=self.EXPECTED_CONSTRAINTS,
                source_path=_phase_g_sql_doc_path(),
            )
        except Exception as exc:
            self._last_schema_apply_report = build_schema_apply_report(
                schema_key=self.SCHEMA_KEY,
                status="failed",
                source_path=_phase_g_sql_doc_path(),
                dialect=self._engine.dialect.name,
                error=f"{exc.__class__.__name__}: {exc}",
            )
            logger.exception("Phase G schema initialization failed")
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
            source_path=_phase_g_sql_doc_path(),
            expected_tables=self.EXPECTED_TABLES,
            expected_indexes=self.EXPECTED_INDEXES,
            expected_constraints=self.EXPECTED_CONSTRAINTS,
            last_schema_apply_report=self._last_schema_apply_report,
            include_connection_probe=include_connection_probe,
        )

    @staticmethod
    def _safe_json_dict(value: Any) -> Dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return {}
            try:
                parsed = json.loads(raw)
            except Exception:
                return {}
            if isinstance(parsed, dict):
                return parsed
        return {}

    @staticmethod
    def _safe_json_value(value: Any) -> Any:
        if value is None:
            return {}
        if isinstance(value, (dict, list, bool, int, float)):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return ""
            if raw.startswith("{") or raw.startswith("["):
                try:
                    return json.loads(raw)
                except Exception:
                    return value
        return value

    @staticmethod
    def _normalized_actor_id(updated_by_user_id: Optional[str]) -> Optional[str]:
        normalized = str(updated_by_user_id or "").strip()
        return normalized or None

    @staticmethod
    def _normalized_session_kind(value: Optional[str]) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"user_activity", "admin_action", "system_task"}:
            return normalized
        return "system_task"

    @staticmethod
    def _normalized_subsystem(value: Optional[str]) -> str:
        normalized = str(value or "").strip().lower()
        return normalized or "unknown"

    @staticmethod
    def _bool_value(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    @classmethod
    def _summary_meta(cls, summary_json: Any) -> Dict[str, Any]:
        payload = cls._safe_json_dict(summary_json)
        meta = payload.get("meta")
        return dict(meta) if isinstance(meta, dict) else {}

    @classmethod
    def _execution_ownership(cls, *, subsystem: Optional[str], entity: str) -> Dict[str, Any]:
        normalized_subsystem = cls._normalized_subsystem(subsystem)
        mapped = _EXECUTION_SUBSYSTEM_OWNERSHIP.get(
            normalized_subsystem,
            {
                "domain_store": None,
                "domain_entity": None,
                "description": "execution record is stored in Phase G but has no domain-specific owner mapping",
            },
        )
        return {
            "execution_store": "phase_g",
            "execution_entity": str(entity),
            "runtime_primary_store": "sqlite",
            "runtime_primary_entity": (
                "execution_log_sessions" if str(entity) == "execution_sessions" else "execution_log_events"
            ),
            "domain_store": mapped.get("domain_store"),
            "domain_entity": mapped.get("domain_entity"),
            "subsystem": normalized_subsystem,
            "description": mapped.get("description"),
        }

    @staticmethod
    def _provider_key_for_config_key(key: str) -> Optional[str]:
        normalized_key = str(key or "").strip().upper()
        if not normalized_key or normalized_key in _SYSTEM_CONFIG_KEYS:
            return None

        llm_match = _LLM_CHANNEL_PATTERN.match(normalized_key)
        if llm_match:
            channel_name = llm_match.group(1).strip().lower()
            if channel_name and channel_name != "channels":
                return f"llm_channel:{channel_name}"

        for prefix, provider_key in _PROVIDER_PREFIXES.items():
            if normalized_key.startswith(prefix):
                return provider_key
        return None

    @staticmethod
    def _serialize_system_config_value(key: str, raw_value: str, field_schema: Optional[Dict[str, Any]]) -> tuple[str, Any]:
        schema = field_schema or {}
        value_type = str(schema.get("data_type") or "string").strip().lower() or "string"
        text = "" if raw_value is None else str(raw_value)
        stripped = text.strip()

        if value_type == "boolean":
            return value_type, stripped.lower() in {"1", "true", "yes", "on"}
        if value_type == "integer":
            try:
                return value_type, int(stripped)
            except Exception:
                return value_type, text
        if value_type == "number":
            try:
                return value_type, float(stripped)
            except Exception:
                return value_type, text
        if value_type == "array":
            values = [item.strip() for item in text.split(",") if item.strip()]
            return value_type, values
        return value_type, PostgresPhaseGStore._safe_json_value(text)

    def replace_config_snapshot(
        self,
        *,
        raw_config_map: Dict[str, str],
        field_schema_by_key: Dict[str, Dict[str, Any]],
        updated_by_user_id: Optional[str] = None,
    ) -> None:
        provider_payloads: Dict[str, Dict[str, Any]] = {}
        system_payloads: Dict[str, Dict[str, Any]] = {}
        resolved_actor_id = self._normalized_actor_id(updated_by_user_id)

        for raw_key, raw_value in sorted((raw_config_map or {}).items()):
            key = str(raw_key or "").strip().upper()
            if not key:
                continue
            field_schema = field_schema_by_key.get(key) or {}
            provider_key = self._provider_key_for_config_key(key)
            if provider_key is not None:
                payload = provider_payloads.setdefault(
                    provider_key,
                    {
                        "config_json": {},
                        "secret_json": {},
                    },
                )
                if bool(field_schema.get("is_sensitive", False)):
                    payload["secret_json"][key] = str(raw_value or "")
                else:
                    payload["config_json"][key] = self._safe_json_value(raw_value)
                continue

            value_type, value_json = self._serialize_system_config_value(key, str(raw_value or ""), field_schema)
            system_payloads[key] = {
                "value_type": value_type,
                "value_json": value_json,
            }

        with self.session_scope() as session:
            existing_providers = {
                row.provider_key: row
                for row in session.execute(select(PhaseGProviderConfig)).scalars().all()
            }
            existing_system = {
                row.config_key: row
                for row in session.execute(select(PhaseGSystemConfig)).scalars().all()
            }

            desired_provider_keys = set(provider_payloads.keys())
            desired_system_keys = set(system_payloads.keys())

            if existing_providers:
                session.execute(
                    delete(PhaseGProviderConfig).where(
                        PhaseGProviderConfig.provider_key.in_(
                            [key for key in existing_providers.keys() if key not in desired_provider_keys]
                        )
                    )
                )
            if existing_system:
                session.execute(
                    delete(PhaseGSystemConfig).where(
                        PhaseGSystemConfig.config_key.in_(
                            [key for key in existing_system.keys() if key not in desired_system_keys]
                        )
                    )
                )

            now = datetime.now()
            for provider_key, payload in provider_payloads.items():
                row = existing_providers.get(provider_key)
                if row is None:
                    row = PhaseGProviderConfig(
                        provider_key=provider_key,
                        rotation_version=1,
                        created_at=now,
                    )
                    session.add(row)

                next_config = dict(payload["config_json"])
                next_secret = dict(payload["secret_json"])
                existing_secret = self._safe_json_dict(getattr(row, "secret_json", None))
                if row.id is not None and next_secret != existing_secret and next_secret:
                    row.rotation_version = int(getattr(row, "rotation_version", 1) or 1) + 1

                row.config_scope = "system"
                row.auth_mode = "api_key" if next_secret else "config"
                row.is_enabled = True
                row.config_json = next_config
                row.secret_json = next_secret
                if resolved_actor_id is not None:
                    row.updated_by_user_id = resolved_actor_id
                row.updated_at = now

            for config_key, payload in system_payloads.items():
                row = existing_system.get(config_key)
                if row is None:
                    row = PhaseGSystemConfig(
                        config_key=config_key,
                        created_at=now,
                    )
                    session.add(row)
                row.config_scope = "system"
                row.value_type = str(payload["value_type"] or "string")
                row.value_json = payload["value_json"]
                if resolved_actor_id is not None:
                    row.updated_by_user_id = resolved_actor_id
                row.updated_at = now

    def upsert_execution_session(
        self,
        *,
        session_id: str,
        owner_user_id: Optional[str] = None,
        actor_user_id: Optional[str] = None,
        actor_role: Optional[str] = None,
        session_kind: Optional[str] = None,
        subsystem: Optional[str] = None,
        action_name: Optional[str] = None,
        task_id: Optional[str] = None,
        query_id: Optional[str] = None,
        linked_analysis_record_id: Optional[int] = None,
        canonical_symbol: Optional[str] = None,
        display_name: Optional[str] = None,
        overall_status: Optional[str] = None,
        truth_level: Optional[str] = None,
        destructive: Optional[bool] = None,
        summary_json: Optional[Dict[str, Any]] = None,
        started_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None,
    ) -> Optional[int]:
        normalized_session_id = str(session_id or "").strip()
        if not normalized_session_id:
            return None

        summary_payload = dict(summary_json or {}) if isinstance(summary_json, dict) else None
        meta = self._summary_meta(summary_payload)
        resolved_session_kind = self._normalized_session_kind(session_kind or meta.get("session_kind"))
        resolved_subsystem = self._normalized_subsystem(subsystem or meta.get("subsystem"))
        resolved_actor_user_id = self._normalized_actor_id(actor_user_id or meta.get("actor_user_id"))
        resolved_owner_user_id = self._normalized_actor_id(owner_user_id or meta.get("owner_user_id"))
        if resolved_owner_user_id is None and resolved_session_kind == "user_activity":
            resolved_owner_user_id = resolved_actor_user_id
        resolved_actor_role = str(actor_role or meta.get("actor_role") or "").strip() or None
        resolved_action_name = str(action_name or meta.get("action_name") or "").strip() or None
        resolved_destructive = bool(destructive) if destructive is not None else self._bool_value(meta.get("destructive"))

        with self.session_scope() as session:
            row = session.execute(
                select(PhaseGExecutionSession)
                .where(PhaseGExecutionSession.session_id == normalized_session_id)
                .limit(1)
            ).scalar_one_or_none()
            now = datetime.now()
            if row is None:
                row = PhaseGExecutionSession(
                    session_id=normalized_session_id,
                    session_kind=resolved_session_kind,
                    subsystem=resolved_subsystem,
                    overall_status=str(overall_status or "running").strip() or "running",
                    truth_level=str(truth_level or "").strip() or None,
                    destructive=resolved_destructive,
                    summary_json={},
                    started_at=started_at or now,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)

            row.owner_user_id = resolved_owner_user_id
            row.actor_user_id = resolved_actor_user_id
            row.actor_role = resolved_actor_role
            row.session_kind = resolved_session_kind
            row.subsystem = resolved_subsystem
            row.action_name = resolved_action_name
            if task_id is not None:
                row.task_id = str(task_id or "").strip() or None
            if query_id is not None:
                row.query_id = str(query_id or "").strip() or None
            if linked_analysis_record_id is not None:
                row.linked_analysis_record_id = int(linked_analysis_record_id)
            if canonical_symbol is not None:
                row.canonical_symbol = str(canonical_symbol or "").strip() or None
            if display_name is not None:
                row.display_name = str(display_name or "").strip() or None
            if overall_status is not None:
                row.overall_status = str(overall_status or "").strip() or row.overall_status
            if truth_level is not None:
                row.truth_level = str(truth_level or "").strip() or None
            row.destructive = resolved_destructive
            if summary_payload is not None:
                row.summary_json = summary_payload
            if started_at is not None:
                row.started_at = started_at
            if ended_at is not None:
                row.ended_at = ended_at
            row.updated_at = now
            session.flush()
            return int(row.id)

    def append_execution_event(
        self,
        *,
        session_id: str,
        phase: str,
        status: str,
        step: Optional[str] = None,
        target: Optional[str] = None,
        truth_level: Optional[str] = None,
        message: Optional[str] = None,
        error_code: Optional[str] = None,
        detail_json: Optional[Dict[str, Any]] = None,
        occurred_at: Optional[datetime] = None,
    ) -> Optional[int]:
        normalized_session_id = str(session_id or "").strip()
        normalized_phase = str(phase or "").strip()
        if not normalized_session_id or not normalized_phase:
            return None

        with self.session_scope() as session:
            execution_session = session.execute(
                select(PhaseGExecutionSession)
                .where(PhaseGExecutionSession.session_id == normalized_session_id)
                .limit(1)
            ).scalar_one_or_none()
            now = datetime.now()
            if execution_session is None:
                execution_session = PhaseGExecutionSession(
                    session_id=normalized_session_id,
                    session_kind="system_task",
                    subsystem="unknown",
                    overall_status="running",
                    truth_level=str(truth_level or "").strip() or None,
                    destructive=False,
                    summary_json={},
                    started_at=occurred_at or now,
                    created_at=now,
                    updated_at=now,
                )
                session.add(execution_session)
                session.flush()

            row = PhaseGExecutionEvent(
                execution_session_id=execution_session.id,
                occurred_at=occurred_at or now,
                phase=normalized_phase,
                step=str(step or "").strip() or None,
                target=str(target or "").strip() or None,
                status=str(status or "unknown").strip() or "unknown",
                truth_level=str(truth_level or "").strip() or None,
                message=str(message or "").strip() or None,
                error_code=str(error_code or "").strip() or None,
                detail_json=dict(detail_json or {}),
            )
            session.add(row)
            session.flush()
            return int(row.id)

    def append_admin_log(
        self,
        *,
        actor_user_id: Optional[str],
        actor_role: Optional[str],
        subsystem: str,
        category: Optional[str],
        event_type: str,
        target_type: Optional[str],
        target_id: Optional[str],
        severity: str,
        outcome: Optional[str],
        message: Optional[str],
        detail_json: Optional[Dict[str, Any]],
        related_session_key: Optional[str],
        occurred_at: Optional[datetime] = None,
    ) -> int:
        with self.session_scope() as session:
            row = PhaseGAdminLog(
                actor_user_id=self._normalized_actor_id(actor_user_id),
                actor_role=str(actor_role or "").strip() or None,
                subsystem=str(subsystem or "").strip(),
                category=str(category or "").strip() or None,
                event_type=str(event_type or "").strip(),
                target_type=str(target_type or "").strip() or None,
                target_id=str(target_id or "").strip() or None,
                scope="system",
                severity=str(severity or "info").strip() or "info",
                outcome=str(outcome or "").strip() or None,
                message=str(message or "").strip() or None,
                detail_json=dict(detail_json or {}),
                related_session_key=str(related_session_key or "").strip() or None,
                occurred_at=occurred_at or datetime.now(),
            )
            session.add(row)
            session.flush()
            return int(row.id)

    def append_system_action(
        self,
        *,
        action_key: str,
        actor_user_id: Optional[str],
        destructive: bool,
        status: str,
        request_json: Optional[Dict[str, Any]],
        result_json: Optional[Dict[str, Any]],
        admin_log_id: Optional[int],
        created_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
    ) -> int:
        with self.session_scope() as session:
            row = PhaseGSystemAction(
                action_key=str(action_key or "").strip(),
                actor_user_id=self._normalized_actor_id(actor_user_id),
                scope="system",
                destructive=bool(destructive),
                status=str(status or "").strip() or "completed",
                request_json=dict(request_json or {}),
                result_json=dict(result_json or {}),
                admin_log_id=int(admin_log_id) if admin_log_id is not None else None,
                created_at=created_at or datetime.now(),
                completed_at=completed_at,
            )
            session.add(row)
            session.flush()
            return int(row.id)

    def nullify_user_references(self, user_ids: Iterable[str]) -> None:
        normalized_user_ids = sorted({str(value).strip() for value in user_ids if str(value or "").strip()})
        if not normalized_user_ids:
            return

        with self.session_scope() as session:
            provider_rows = session.execute(
                select(PhaseGProviderConfig).where(PhaseGProviderConfig.updated_by_user_id.in_(normalized_user_ids))
            ).scalars().all()
            for row in provider_rows:
                row.updated_by_user_id = None

            system_rows = session.execute(
                select(PhaseGSystemConfig).where(PhaseGSystemConfig.updated_by_user_id.in_(normalized_user_ids))
            ).scalars().all()
            for row in system_rows:
                row.updated_by_user_id = None

            admin_log_rows = session.execute(
                select(PhaseGAdminLog).where(PhaseGAdminLog.actor_user_id.in_(normalized_user_ids))
            ).scalars().all()
            for row in admin_log_rows:
                detail_json = self._safe_json_dict(row.detail_json)
                if row.actor_user_id and "actor_user_id" not in detail_json:
                    detail_json["actor_user_id"] = row.actor_user_id
                if row.actor_role and "actor_role" not in detail_json:
                    detail_json["actor_role"] = row.actor_role
                row.detail_json = detail_json
                row.actor_user_id = None

            system_action_rows = session.execute(
                select(PhaseGSystemAction).where(PhaseGSystemAction.actor_user_id.in_(normalized_user_ids))
            ).scalars().all()
            for row in system_action_rows:
                request_json = self._safe_json_dict(row.request_json)
                if row.actor_user_id and "actor_user_id" not in request_json:
                    request_json["actor_user_id"] = row.actor_user_id
                row.request_json = request_json
                row.actor_user_id = None

            execution_session_rows = session.execute(
                select(PhaseGExecutionSession).where(
                    or_(
                        PhaseGExecutionSession.owner_user_id.in_(normalized_user_ids),
                        PhaseGExecutionSession.actor_user_id.in_(normalized_user_ids),
                    )
                )
            ).scalars().all()
            for row in execution_session_rows:
                summary_json = self._safe_json_dict(row.summary_json)
                meta = self._summary_meta(summary_json)
                if row.owner_user_id and "owner_user_id" not in meta:
                    meta["owner_user_id"] = row.owner_user_id
                if row.actor_user_id and "actor_user_id" not in meta:
                    meta["actor_user_id"] = row.actor_user_id
                if row.actor_role and "actor_role" not in meta:
                    meta["actor_role"] = row.actor_role
                if meta:
                    summary_json["meta"] = meta
                    row.summary_json = summary_json
                if row.owner_user_id in normalized_user_ids:
                    row.owner_user_id = None
                if row.actor_user_id in normalized_user_ids:
                    row.actor_user_id = None

    def list_execution_sessions(
        self,
        *,
        limit: int = 50,
        subsystem: Optional[str] = None,
        overall_status: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            query = select(PhaseGExecutionSession)
            if subsystem:
                query = query.where(PhaseGExecutionSession.subsystem == self._normalized_subsystem(subsystem))
            if overall_status:
                query = query.where(PhaseGExecutionSession.overall_status == str(overall_status).strip())
            rows = session.execute(
                query.order_by(desc(PhaseGExecutionSession.started_at), desc(PhaseGExecutionSession.id)).limit(
                    max(1, min(int(limit), 200))
                )
            ).scalars().all()
            return [
                {
                    "id": int(row.id),
                    "session_id": row.session_id,
                    "owner_user_id": row.owner_user_id,
                    "actor_user_id": row.actor_user_id,
                    "actor_role": row.actor_role,
                    "session_kind": row.session_kind,
                    "subsystem": row.subsystem,
                    "action_name": row.action_name,
                    "task_id": row.task_id,
                    "query_id": row.query_id,
                    "linked_analysis_record_id": (
                        int(row.linked_analysis_record_id)
                        if row.linked_analysis_record_id is not None
                        else None
                    ),
                    "canonical_symbol": row.canonical_symbol,
                    "display_name": row.display_name,
                    "overall_status": row.overall_status,
                    "truth_level": row.truth_level,
                    "destructive": bool(row.destructive),
                    "summary": self._safe_json_dict(row.summary_json),
                    "started_at": row.started_at.isoformat() if row.started_at else None,
                    "ended_at": row.ended_at.isoformat() if row.ended_at else None,
                    "ownership": self._execution_ownership(
                        subsystem=row.subsystem,
                        entity="execution_sessions",
                    ),
                }
                for row in rows
            ]

    def get_execution_session_detail(self, session_id: str) -> Optional[dict[str, Any]]:
        normalized_session_id = str(session_id or "").strip()
        if not normalized_session_id:
            return None

        with self.session_scope() as session:
            row = session.execute(
                select(PhaseGExecutionSession)
                .where(PhaseGExecutionSession.session_id == normalized_session_id)
                .limit(1)
            ).scalar_one_or_none()
            if row is None:
                return None

            event_rows = session.execute(
                select(PhaseGExecutionEvent)
                .where(PhaseGExecutionEvent.execution_session_id == row.id)
                .order_by(asc(PhaseGExecutionEvent.occurred_at), asc(PhaseGExecutionEvent.id))
            ).scalars().all()
            admin_log_ids = session.execute(
                select(PhaseGAdminLog.id)
                .where(PhaseGAdminLog.related_session_key == normalized_session_id)
                .order_by(asc(PhaseGAdminLog.id))
            ).scalars().all()
            system_action_ids = []
            if admin_log_ids:
                system_action_ids = session.execute(
                    select(PhaseGSystemAction.id)
                    .where(PhaseGSystemAction.admin_log_id.in_(admin_log_ids))
                    .order_by(asc(PhaseGSystemAction.id))
                ).scalars().all()

            return {
                "id": int(row.id),
                "session_id": row.session_id,
                "owner_user_id": row.owner_user_id,
                "actor_user_id": row.actor_user_id,
                "actor_role": row.actor_role,
                "session_kind": row.session_kind,
                "subsystem": row.subsystem,
                "action_name": row.action_name,
                "task_id": row.task_id,
                "query_id": row.query_id,
                "linked_analysis_record_id": (
                    int(row.linked_analysis_record_id)
                    if row.linked_analysis_record_id is not None
                    else None
                ),
                "canonical_symbol": row.canonical_symbol,
                "display_name": row.display_name,
                "overall_status": row.overall_status,
                "truth_level": row.truth_level,
                "destructive": bool(row.destructive),
                "summary": self._safe_json_dict(row.summary_json),
                "started_at": row.started_at.isoformat() if row.started_at else None,
                "ended_at": row.ended_at.isoformat() if row.ended_at else None,
                "ownership": self._execution_ownership(
                    subsystem=row.subsystem,
                    entity="execution_sessions",
                ),
                "related_phase_g_admin_log_count": len(admin_log_ids),
                "related_phase_g_system_action_count": len(system_action_ids),
                "events": [
                    {
                        "id": int(event.id),
                        "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
                        "phase": event.phase,
                        "step": event.step,
                        "target": event.target,
                        "status": event.status,
                        "truth_level": event.truth_level,
                        "message": event.message,
                        "error_code": event.error_code,
                        "detail_json": self._safe_json_dict(event.detail_json),
                        "ownership": self._execution_ownership(
                            subsystem=row.subsystem,
                            entity="execution_events",
                        ),
                    }
                    for event in event_rows
                ],
            }

    def describe_execution_log_status(
        self,
        *,
        bridge_enabled: bool,
        include_connection_probe: bool = False,
        serving_semantics: Optional[str] = None,
    ) -> dict[str, Any]:
        runtime = self.describe_runtime(include_connection_probe=include_connection_probe)
        return {
            "bridge_enabled": bool(bridge_enabled),
            "shadow_enabled": True,
            "mode": runtime["mode"],
            "shadow_store": "phase_g",
            "shadow_entities": ["execution_sessions", "execution_events"],
            "primary_runtime": {
                "store": "sqlite",
                "session_entity": "execution_log_sessions",
                "event_entity": "execution_log_events",
            },
            "serving_flags": {
                "sqlite_primary": True,
                "pg_execution_logs_shadow": True,
                "pg_execution_logs_are_serving_truth": False,
            },
            "serving_semantics": serving_semantics,
            "schema": runtime["schema"],
            "connection": runtime["connection"],
        }

    def list_admin_logs(self, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            rows = session.execute(
                select(PhaseGAdminLog)
                .order_by(desc(PhaseGAdminLog.occurred_at), desc(PhaseGAdminLog.id))
                .limit(max(1, min(int(limit), 200)))
            ).scalars().all()
            return [
                {
                    "id": int(row.id),
                    "actor_user_id": row.actor_user_id,
                    "actor_role": row.actor_role,
                    "subsystem": row.subsystem,
                    "category": row.category,
                    "event_type": row.event_type,
                    "target_type": row.target_type,
                    "target_id": row.target_id,
                    "scope": row.scope,
                    "severity": row.severity,
                    "outcome": row.outcome,
                    "message": row.message,
                    "detail_json": self._safe_json_dict(row.detail_json),
                    "related_session_key": row.related_session_key,
                    "occurred_at": row.occurred_at.isoformat() if row.occurred_at else None,
                }
                for row in rows
            ]

    def list_system_actions(self, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            rows = session.execute(
                select(PhaseGSystemAction)
                .order_by(desc(PhaseGSystemAction.created_at), desc(PhaseGSystemAction.id))
                .limit(max(1, min(int(limit), 200)))
            ).scalars().all()
            return [
                {
                    "id": int(row.id),
                    "action_key": row.action_key,
                    "actor_user_id": row.actor_user_id,
                    "scope": row.scope,
                    "destructive": bool(row.destructive),
                    "status": row.status,
                    "request_json": self._safe_json_dict(row.request_json),
                    "result_json": self._safe_json_dict(row.result_json),
                    "admin_log_id": int(row.admin_log_id) if row.admin_log_id is not None else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "completed_at": row.completed_at.isoformat() if row.completed_at else None,
                }
                for row in rows
            ]
