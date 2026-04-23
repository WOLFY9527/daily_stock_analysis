# -*- coding: utf-8 -*-
"""Thin shared helpers for PostgreSQL coexistence stores."""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Sequence

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from src.postgres_schema_bootstrap import apply_schema_slice

_CREATE_TABLE_PATTERN = re.compile(
    r"^create table if not exists\s+([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)
_CREATE_INDEX_PATTERN = re.compile(
    r"^create index if not exists\s+([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)
_ALTER_CONSTRAINT_PATTERN = re.compile(
    r"^alter table\s+([a-z_][a-z0-9_]*)\s+add constraint\s+([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)


def baseline_sql_doc_path() -> Path:
    return Path(__file__).resolve().parent.parent / "docs" / "architecture" / "postgresql-baseline-v1.sql"


def create_store_engine(db_url: str) -> Engine:
    return create_engine(
        db_url,
        echo=False,
        pool_pre_ping=True,
    )


def create_session_factory(engine: Engine) -> sessionmaker:
    return sessionmaker(
        bind=engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


@contextmanager
def managed_session_scope(session_factory: sessionmaker):
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def load_baseline_sql_statements(
    *,
    table_names: Iterable[str],
    index_names: Iterable[str] = (),
    constraint_names: Iterable[tuple[str, str]] = (),
    source_path: Path | None = None,
) -> list[str]:
    """Extract a bounded SQL slice from the authoritative baseline SQL doc."""
    sql_path = Path(source_path or baseline_sql_doc_path()).resolve()
    if not sql_path.exists():
        raise RuntimeError(f"Baseline schema source not found: {sql_path}")

    expected_tables = {str(name).strip().lower() for name in table_names if str(name).strip()}
    expected_indexes = {str(name).strip().lower() for name in index_names if str(name).strip()}
    expected_constraints = {
        (str(table_name).strip().lower(), str(constraint_name).strip().lower())
        for table_name, constraint_name in constraint_names
        if str(table_name).strip() and str(constraint_name).strip()
    }

    raw_text = sql_path.read_text(encoding="utf-8")
    text_body = "\n".join(
        line for line in raw_text.splitlines() if not line.lstrip().startswith("--")
    )
    statements = [stmt.strip() for stmt in text_body.split(";") if stmt.strip()]

    selected: list[str] = []
    for statement in statements:
        normalized = re.sub(r"\s+", " ", statement).strip()
        table_match = _CREATE_TABLE_PATTERN.match(normalized)
        if table_match and table_match.group(1).lower() in expected_tables:
            selected.append(f"{statement};")
            continue

        index_match = _CREATE_INDEX_PATTERN.match(normalized)
        if index_match and index_match.group(1).lower() in expected_indexes:
            selected.append(f"{statement};")
            continue

        alter_match = _ALTER_CONSTRAINT_PATTERN.match(normalized)
        if alter_match and (
            alter_match.group(1).lower(),
            alter_match.group(2).lower(),
        ) in expected_constraints:
            selected.append(f"{statement};")

    if not selected:
        raise RuntimeError(f"No matching baseline schema statements found in {sql_path}")
    return selected


def build_schema_apply_report(
    *,
    schema_key: str,
    status: str,
    source_path: Path,
    statement_count: int = 0,
    dialect: str | None = None,
    skip_reason: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_key": str(schema_key),
        "status": str(status),
        "source_path": str(Path(source_path).resolve()),
        "statement_count": int(statement_count),
        "dialect": dialect,
        "skip_reason": skip_reason,
        "error": error,
    }


def apply_baseline_schema(
    engine: Engine,
    *,
    schema_key: str,
    metadata,
    table_names: Iterable[str],
    index_names: Iterable[str] = (),
    constraint_names: Iterable[tuple[str, str]] = (),
    source_path: Path | None = None,
) -> dict[str, Any]:
    resolved_source_path = Path(source_path or baseline_sql_doc_path()).resolve()
    statements = load_baseline_sql_statements(
        table_names=table_names,
        index_names=index_names,
        constraint_names=constraint_names,
        source_path=resolved_source_path,
    )
    apply_schema_slice(
        engine,
        schema_key=schema_key,
        source_path=resolved_source_path,
        statements=statements,
        metadata=metadata,
    )
    return build_schema_apply_report(
        schema_key=schema_key,
        status="applied",
        source_path=resolved_source_path,
        statement_count=len([stmt for stmt in statements if str(stmt or "").strip()]),
        dialect=engine.dialect.name,
    )


def _load_bootstrap_record(engine: Engine, *, schema_key: str) -> dict[str, Any] | None:
    inspector = inspect(engine)
    if "postgres_schema_bootstrap" not in set(inspector.get_table_names()):
        return None

    with engine.begin() as conn:
        row = conn.execute(
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
                where schema_key = :schema_key
                order by applied_at desc
                limit 1
                """
            ),
            {"schema_key": str(schema_key)},
        ).mappings().first()

    if row is None:
        return None

    metadata_value = row.get("metadata_json")
    if isinstance(metadata_value, str):
        try:
            parsed_metadata = json.loads(metadata_value)
        except Exception:
            parsed_metadata = {}
    else:
        parsed_metadata = dict(metadata_value or {})

    return {
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


def _collect_present_indexes(
    engine: Engine,
    *,
    expected_tables: Iterable[str],
    expected_indexes: Iterable[str],
) -> list[str]:
    expected_index_names = {str(name).strip() for name in expected_indexes if str(name).strip()}
    if not expected_index_names:
        return []

    inspector = inspect(engine)
    present_table_names = set(inspector.get_table_names())
    found_indexes: set[str] = set()
    for table_name in sorted({str(name).strip() for name in expected_tables if str(name).strip()}):
        if table_name not in present_table_names:
            continue
        try:
            indexes = inspector.get_indexes(table_name)
        except Exception:
            continue
        for index in indexes:
            index_name = str(index.get("name") or "").strip()
            if index_name in expected_index_names:
                found_indexes.add(index_name)
    return sorted(found_indexes)


def probe_engine_connection(engine: Engine) -> dict[str, Any]:
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return {
            "requested": True,
            "ok": True,
            "error": None,
        }
    except Exception as exc:
        return {
            "requested": True,
            "ok": False,
            "error": f"{exc.__class__.__name__}: {exc}",
        }


def describe_store_runtime(
    engine: Engine,
    *,
    schema_key: str,
    mode: str,
    source_path: Path,
    expected_tables: Iterable[str],
    expected_indexes: Iterable[str] = (),
    expected_constraints: Iterable[tuple[str, str]] = (),
    last_schema_apply_report: dict[str, Any] | None = None,
    include_connection_probe: bool = False,
) -> dict[str, Any]:
    expected_table_names = sorted({str(name).strip() for name in expected_tables if str(name).strip()})
    expected_index_names = sorted({str(name).strip() for name in expected_indexes if str(name).strip()})
    expected_constraint_names = sorted(
        {
            (str(table_name).strip(), str(constraint_name).strip())
            for table_name, constraint_name in expected_constraints
            if str(table_name).strip() and str(constraint_name).strip()
        }
    )

    inspector = inspect(engine)
    present_table_name_set = set(inspector.get_table_names())
    present_tables = sorted(name for name in expected_table_names if name in present_table_name_set)
    present_indexes = _collect_present_indexes(
        engine,
        expected_tables=expected_table_names,
        expected_indexes=expected_index_names,
    )
    bootstrap_record = _load_bootstrap_record(engine, schema_key=schema_key)
    apply_report = dict(last_schema_apply_report or {})

    if include_connection_probe:
        connection_report = probe_engine_connection(engine)
    else:
        connection_report = {
            "requested": False,
            "ok": None,
            "error": None,
        }

    return {
        "dialect": engine.dialect.name,
        "mode": str(mode),
        "schema": {
            "schema_key": str(schema_key),
            "source_path": str(Path(source_path).resolve()),
            "expected_tables": expected_table_names,
            "expected_indexes": expected_index_names,
            "expected_constraints": [
                {"table": table_name, "name": constraint_name}
                for table_name, constraint_name in expected_constraint_names
            ],
            "present_tables": present_tables,
            "missing_tables": [name for name in expected_table_names if name not in present_table_name_set],
            "present_indexes": present_indexes,
            "missing_indexes": [name for name in expected_index_names if name not in set(present_indexes)],
            "last_apply_status": str(apply_report.get("status") or "unknown"),
            "skip_reason": apply_report.get("skip_reason"),
            "last_error": apply_report.get("error"),
            "last_apply_statement_count": int(apply_report.get("statement_count") or 0),
            "bootstrap_recorded": bootstrap_record is not None,
            "bootstrap": bootstrap_record,
        },
        "connection": connection_report,
    }


def redact_database_url(db_url: str) -> str:
    raw = str(db_url or "").strip()
    if not raw:
        return ""
    try:
        parsed = make_url(raw)
    except Exception:
        return "<invalid-db-url>"

    if parsed.drivername.startswith("sqlite"):
        if parsed.database == ":memory:":
            return "sqlite:///:memory:"
        return f"sqlite:///{parsed.database or ''}"
    return parsed.render_as_string(hide_password=True)
