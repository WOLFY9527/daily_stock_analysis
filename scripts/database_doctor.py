#!/usr/bin/env python3
"""CLI entrypoint for the database doctor support bundle."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.database_doctor import main


if __name__ == "__main__":
    raise SystemExit(main())
