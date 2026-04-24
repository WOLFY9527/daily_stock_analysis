"""Legacy import shim for Phase F PostgreSQL helpers.

The canonical implementation lives in `src/postgres_portfolio_coexistence_store.py`.
Keep this module as a re-export surface until downstream imports are migrated.
"""

from src.postgres_portfolio_coexistence_store import *  # noqa: F401,F403
