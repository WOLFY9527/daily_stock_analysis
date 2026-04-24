"""Legacy import shim for Phase G PostgreSQL helpers.

The canonical implementation lives in `src/postgres_control_plane_store.py`.
Keep this module as a re-export surface until downstream imports are migrated.
"""

from src.postgres_control_plane_store import *  # noqa: F401,F403
