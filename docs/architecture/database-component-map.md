# Database Component Map

This file maps the current database system by layer and by domain.

## Layer Map

| Layer | Current truth | Key files | Notes |
| --- | --- | --- | --- |
| Config layer | `.env` live source | [`src/config.py`](../../src/config.py), [`src/services/system_config_service.py`](../../src/services/system_config_service.py) | Phase G shadows config, but does not replace `.env` truth yet |
| SQLite primary layer | SQLite | [`src/storage.py`](../../src/storage.py) | Still serves legacy runtime paths |
| PostgreSQL bridge layer | shared engine/session/bootstrap helpers | [`src/postgres_store_utils.py`](../../src/postgres_store_utils.py), [`src/postgres_schema_bootstrap.py`](../../src/postgres_schema_bootstrap.py) | Thin infrastructure only |
| Domain coexistence layer | Phase A-G stores | `src/postgres_*_store.py` | Business-domain boundaries remain separate |
| Compatibility layer | old import paths | `src/postgres_phase_*.py` | Re-export only; do not put new logic here |

## Domain Map

| Domain | Store module | Runtime truth now | PostgreSQL role now | Read first |
| --- | --- | --- | --- | --- |
| Phase A identity/preferences | [`src/postgres_identity_store.py`](../../src/postgres_identity_store.py) | PG when enabled, SQLite fallback/backfill otherwise | bridge/shadow for coexistence | [`tests/test_postgres_phase_a.py`](../../tests/test_postgres_phase_a.py) |
| Phase B analysis/chat | [`src/postgres_analysis_chat_store.py`](../../src/postgres_analysis_chat_store.py) | SQLite product flow with PG shadow persistence | bridge/shadow | [`tests/test_postgres_phase_b.py`](../../tests/test_postgres_phase_b.py) |
| Phase C market metadata | [`src/postgres_market_metadata_store.py`](../../src/postgres_market_metadata_store.py) | PG metadata shadow, bulk market bodies remain outside PG | bridge/shadow | [`tests/test_postgres_phase_c.py`](../../tests/test_postgres_phase_c.py) |
| Phase D scanner/watchlist | [`src/postgres_scanner_watchlist_store.py`](../../src/postgres_scanner_watchlist_store.py) | SQLite product flow with PG shadow rows | bridge/shadow | [`tests/test_postgres_phase_d.py`](../../tests/test_postgres_phase_d.py) |
| Phase E backtest | [`src/postgres_backtest_store.py`](../../src/postgres_backtest_store.py) | SQLite product flow with PG shadow rows/artifacts | bridge/shadow | [`tests/test_postgres_phase_e.py`](../../tests/test_postgres_phase_e.py) |
| Phase F portfolio coexistence | [`src/postgres_portfolio_coexistence_store.py`](../../src/postgres_portfolio_coexistence_store.py) | SQLite still serves | comparison-only shadow | [`tests/test_postgres_phase_f.py`](../../tests/test_postgres_phase_f.py) |
| Phase G control plane | [`src/postgres_control_plane_store.py`](../../src/postgres_control_plane_store.py) | `.env` still serves | snapshot/shadow | [`tests/test_postgres_phase_g.py`](../../tests/test_postgres_phase_g.py) |

## Shared Infrastructure Map

| Concern | Shared entry point |
| --- | --- |
| engine creation | [`create_store_engine(...)`](../../src/postgres_store_utils.py) |
| session factory | [`create_session_factory(...)`](../../src/postgres_store_utils.py) |
| transaction scope | [`managed_session_scope(...)`](../../src/postgres_store_utils.py) |
| baseline SQL slicing | [`load_baseline_sql_statements(...)`](../../src/postgres_store_utils.py) |
| schema apply/bootstrap | [`apply_baseline_schema(...)`](../../src/postgres_store_utils.py), [`apply_schema_slice(...)`](../../src/postgres_schema_bootstrap.py) |
| store diagnostics | [`describe_store_runtime(...)`](../../src/postgres_store_utils.py) |
| whole-system topology | [`DatabaseManager.describe_database_topology(...)`](../../src/storage.py) |

## Important Boundaries To Preserve

- Do not move SQLite legacy truth decisions out of [`src/storage.py`](../../src/storage.py) in a maintainability-only slice.
- Do not merge Phase F comparison logic into generic helpers.
- Do not move Phase G live config semantics out of `.env`.
- Do not remove compatibility shims while old imports may still exist.
