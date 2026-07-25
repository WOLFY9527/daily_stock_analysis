"""Fail-closed SQLite foreign-key enforcement for every connection owner."""

from __future__ import annotations

import sqlite3
from collections import Counter
from os import PathLike
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection, Engine
    from sqlalchemy.sql.schema import MetaData


SQLiteForeignKeyIdentity = tuple[str, str, str, str, str, str, str]
SQLiteForeignKeyInventory = Counter[SQLiteForeignKeyIdentity]


class SQLiteForeignKeyEnforcementError(RuntimeError):
    """Raised when a SQLite connection cannot enforce foreign keys."""


class SQLiteForeignKeySchemaError(RuntimeError):
    """Raised when a SQLite schema does not match its declared FK contract."""


def _close_quietly(connection: sqlite3.Connection) -> None:
    try:
        connection.close()
    except Exception:
        pass


def enforce_sqlite_foreign_keys(
    connection: sqlite3.Connection,
) -> sqlite3.Connection:
    """Enable and verify connection-local SQLite foreign-key enforcement."""
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA foreign_keys")
        row = cursor.fetchone()
        enabled = bool(row and int(row[0]) == 1)
    except Exception as exc:
        _close_quietly(connection)
        raise SQLiteForeignKeyEnforcementError(
            "SQLite foreign-key enforcement could not be initialized"
        ) from exc
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass

    if not enabled:
        _close_quietly(connection)
        raise SQLiteForeignKeyEnforcementError(
            "SQLite foreign-key enforcement could not be verified"
        )
    return connection


def connect_sqlite(
    database: str | bytes | PathLike[str],
    **kwargs: Any,
) -> sqlite3.Connection:
    """Open a SQLite connection that is unusable unless FK enforcement succeeds."""
    return enforce_sqlite_foreign_keys(sqlite3.connect(database, **kwargs))


def _enforce_sqlalchemy_sqlite_foreign_keys(
    dbapi_connection: sqlite3.Connection,
    _connection_record: Any,
) -> None:
    enforce_sqlite_foreign_keys(dbapi_connection)


def _enforce_sqlalchemy_sqlite_foreign_keys_on_checkout(
    dbapi_connection: sqlite3.Connection,
    _connection_record: Any,
    _connection_proxy: Any,
) -> None:
    enforce_sqlite_foreign_keys(dbapi_connection)


def create_engine_with_sqlite_foreign_keys(
    database_url: Any,
    **options: Any,
) -> Engine:
    """Create an engine whose every SQLite checkout enables and verifies FKs."""
    from sqlalchemy import create_engine, event

    engine = create_engine(database_url, **options)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _enforce_sqlalchemy_sqlite_foreign_keys)
        event.listen(
            engine,
            "checkout",
            _enforce_sqlalchemy_sqlite_foreign_keys_on_checkout,
        )
    return engine


def _normalized_sqlite_fk_option(value: Any, default: str) -> str:
    return str(value or default).strip().upper()


def declared_sqlite_foreign_keys(metadata: MetaData) -> SQLiteForeignKeyInventory:
    """Return the FK inventory declared by SQLAlchemy metadata."""
    return Counter(
        (
            table.name,
            foreign_key.parent.name,
            foreign_key.column.table.name,
            foreign_key.column.name,
            _normalized_sqlite_fk_option(foreign_key.onupdate, "NO ACTION"),
            _normalized_sqlite_fk_option(foreign_key.ondelete, "NO ACTION"),
            _normalized_sqlite_fk_option(foreign_key.match, "NONE"),
        )
        for table in metadata.sorted_tables
        for foreign_key in table.foreign_keys
    )


def _quote_sqlite_identifier(identifier: str) -> str:
    return '"' + str(identifier).replace('"', '""') + '"'


def read_sqlite_foreign_keys(
    connection: Connection,
    table_names: Iterable[str],
) -> SQLiteForeignKeyInventory:
    """Read the physical FK inventory for the requested SQLite tables."""
    inventory: SQLiteForeignKeyInventory = Counter()
    for table_name in table_names:
        quoted_table = _quote_sqlite_identifier(table_name)
        rows = connection.exec_driver_sql(
            f"PRAGMA foreign_key_list({quoted_table})"
        ).mappings()
        inventory.update(
            (
                str(table_name),
                str(row["from"]),
                str(row["table"]),
                str(row["to"]),
                _normalized_sqlite_fk_option(row["on_update"], "NO ACTION"),
                _normalized_sqlite_fk_option(row["on_delete"], "NO ACTION"),
                _normalized_sqlite_fk_option(row["match"], "NONE"),
            )
            for row in rows
        )
    return inventory


def verify_sqlite_foreign_key_schema(
    connection: Connection,
    metadata: MetaData,
) -> None:
    """Fail closed on missing declarations or existing SQLite orphan rows."""
    if connection.dialect.name != "sqlite":
        return

    expected = declared_sqlite_foreign_keys(metadata)
    actual = read_sqlite_foreign_keys(
        connection,
        (table.name for table in metadata.sorted_tables),
    )
    if actual != expected:
        missing = sorted((expected - actual).elements())
        unexpected = sorted((actual - expected).elements())
        detail = missing[0] if missing else unexpected[0]
        raise SQLiteForeignKeySchemaError(
            "SQLite foreign-key schema inventory does not match the declared "
            f"contract: expected={expected.total()} actual={actual.total()} first={detail!r}"
        )

    violation = connection.exec_driver_sql("PRAGMA foreign_key_check").first()
    if violation is not None:
        raise SQLiteForeignKeySchemaError(
            "SQLite foreign-key integrity check found existing orphaned rows"
        )
