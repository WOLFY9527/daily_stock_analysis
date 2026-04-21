# -*- coding: utf-8 -*-
"""Shared bootstrap registry for phased PostgreSQL baseline slices."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Sequence

from sqlalchemy import text

BASELINE_SCHEMA_VERSION = "baseline_v1"
_ALTER_CONSTRAINT_PATTERN = re.compile(
    r"^alter table\s+([a-z_][a-z0-9_]*)\s+add constraint\s+([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)


def _registry_table_statement(dialect: str) -> str:
    if dialect == "postgresql":
        return """
        create table if not exists postgres_schema_bootstrap (
            id bigserial primary key,
            schema_key text not null,
            schema_version text not null,
            source_path text not null,
            source_checksum text not null,
            statement_count integer not null default 0,
            dialect text not null,
            applied_via text not null,
            metadata_json jsonb not null default '{}'::jsonb,
            applied_at timestamptz not null default now(),
            unique (schema_key, schema_version)
        )
        """
    return """
    create table if not exists postgres_schema_bootstrap (
        id integer primary key autoincrement,
        schema_key text not null,
        schema_version text not null,
        source_path text not null,
        source_checksum text not null,
        statement_count integer not null default 0,
        dialect text not null,
        applied_via text not null,
        metadata_json text not null default '{}',
        applied_at datetime not null default current_timestamp,
        unique (schema_key, schema_version)
    )
    """


def _registry_index_statement() -> str:
    return """
    create index if not exists idx_postgres_schema_bootstrap_applied
        on postgres_schema_bootstrap (applied_at desc, schema_key)
    """


def _source_checksum(source_path: Path) -> str:
    resolved = Path(source_path).resolve()
    digest = hashlib.sha256()
    digest.update(resolved.as_posix().encode("utf-8"))
    if resolved.exists():
        digest.update(resolved.read_bytes())
    return digest.hexdigest()


def _ensure_registry_table(conn, dialect: str) -> None:
    conn.exec_driver_sql(_registry_table_statement(dialect))
    conn.exec_driver_sql(_registry_index_statement())


def _constraint_exists(conn, constraint_name: str) -> bool:
    return bool(
        conn.execute(
            text("select 1 from pg_constraint where conname = :constraint_name"),
            {"constraint_name": constraint_name},
        ).scalar()
    )


def _record_bootstrap(
    conn,
    *,
    schema_key: str,
    schema_version: str,
    source_path: Path,
    source_checksum: str,
    statement_count: int,
    dialect: str,
    applied_via: str,
    metadata: dict[str, Any],
) -> None:
    metadata_payload = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
    conn.execute(
        text(
            """
            insert into postgres_schema_bootstrap (
                schema_key,
                schema_version,
                source_path,
                source_checksum,
                statement_count,
                dialect,
                applied_via,
                metadata_json
            )
            values (
                :schema_key,
                :schema_version,
                :source_path,
                :source_checksum,
                :statement_count,
                :dialect,
                :applied_via,
                :metadata_json
            )
            on conflict (schema_key, schema_version) do update set
                source_path = excluded.source_path,
                source_checksum = excluded.source_checksum,
                statement_count = excluded.statement_count,
                dialect = excluded.dialect,
                applied_via = excluded.applied_via,
                metadata_json = excluded.metadata_json,
                applied_at = current_timestamp
            """
        ),
        {
            "schema_key": schema_key,
            "schema_version": schema_version,
            "source_path": str(Path(source_path).resolve()),
            "source_checksum": source_checksum,
            "statement_count": int(statement_count),
            "dialect": dialect,
            "applied_via": applied_via,
            "metadata_json": metadata_payload,
        },
    )


def apply_schema_slice(
    engine,
    *,
    schema_key: str,
    source_path: Path,
    statements: Sequence[str],
    metadata,
    schema_version: str = BASELINE_SCHEMA_VERSION,
) -> None:
    resolved_source_path = Path(source_path).resolve()
    source_checksum = _source_checksum(resolved_source_path)
    dialect = engine.dialect.name
    statement_count = len([stmt for stmt in statements if str(stmt or "").strip()])

    if dialect == "postgresql":
        with engine.begin() as conn:
            _ensure_registry_table(conn, dialect)
            for statement in statements:
                normalized = re.sub(r"\s+", " ", str(statement or "")).strip().rstrip(";")
                alter_match = _ALTER_CONSTRAINT_PATTERN.match(normalized)
                if alter_match and _constraint_exists(conn, alter_match.group(2)):
                    continue
                conn.exec_driver_sql(statement)
            _record_bootstrap(
                conn,
                schema_key=schema_key,
                schema_version=schema_version,
                source_path=resolved_source_path,
                source_checksum=source_checksum,
                statement_count=statement_count,
                dialect=dialect,
                applied_via="baseline_sql",
                metadata={
                    "statement_count": statement_count,
                    "statement_source": "baseline_sql",
                },
            )
        return

    metadata.create_all(engine)
    with engine.begin() as conn:
        _ensure_registry_table(conn, dialect)
        _record_bootstrap(
            conn,
            schema_key=schema_key,
            schema_version=schema_version,
            source_path=resolved_source_path,
            source_checksum=source_checksum,
            statement_count=statement_count,
            dialect=dialect,
            applied_via="sqlalchemy_metadata",
            metadata={
                "statement_count": statement_count,
                "statement_source": "sqlalchemy_metadata",
            },
        )


def list_bootstrap_records(engine) -> list[dict[str, Any]]:
    dialect = engine.dialect.name
    with engine.begin() as conn:
        _ensure_registry_table(conn, dialect)
        rows = conn.execute(
            text(
                """
                select
                    schema_key,
                    schema_version,
                    source_path,
                    source_checksum,
                    statement_count,
                    dialect,
                    applied_via,
                    metadata_json,
                    applied_at
                from postgres_schema_bootstrap
                order by schema_key asc, applied_at desc
                """
            )
        ).mappings().all()

    records: list[dict[str, Any]] = []
    for row in rows:
        metadata_value = row.get("metadata_json")
        if isinstance(metadata_value, str):
            try:
                parsed_metadata = json.loads(metadata_value)
            except Exception:
                parsed_metadata = {}
        else:
            parsed_metadata = dict(metadata_value or {})
        records.append(
            {
                "schema_key": row["schema_key"],
                "schema_version": row["schema_version"],
                "source_path": row["source_path"],
                "source_checksum": row["source_checksum"],
                "statement_count": int(row["statement_count"] or 0),
                "dialect": row["dialect"],
                "applied_via": row["applied_via"],
                "metadata": parsed_metadata,
                "applied_at": (
                    row["applied_at"].isoformat()
                    if hasattr(row["applied_at"], "isoformat")
                    else (str(row["applied_at"]) if row["applied_at"] is not None else None)
                ),
            }
        )
    return records
