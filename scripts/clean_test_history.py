#!/usr/bin/env python3
"""Delete analysis_history rows flagged as test data."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from typing import Optional

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.storage import AnalysisHistory, DatabaseManager


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def clean_test_history_records(
    *,
    before: Optional[str] = None,
    after: Optional[str] = None,
    dry_run: bool = False,
) -> int:
    db = DatabaseManager.get_instance()
    before_dt = _parse_datetime(before)
    after_dt = _parse_datetime(after)

    with db.get_session() as session:
        query = session.query(AnalysisHistory).filter(AnalysisHistory.is_test.is_(True))
        if after_dt is not None:
            query = query.filter(AnalysisHistory.created_at >= after_dt)
        if before_dt is not None:
            query = query.filter(AnalysisHistory.created_at <= before_dt)

        rows = query.order_by(AnalysisHistory.id.asc()).all()
        count = len(rows)
        if dry_run or count == 0:
            session.rollback()
            return count

        for row in rows:
            session.delete(row)
        session.commit()
        return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete analysis_history rows flagged with is_test=True.")
    parser.add_argument("--before", help="Delete rows created on or before this ISO timestamp.")
    parser.add_argument("--after", help="Delete rows created on or after this ISO timestamp.")
    parser.add_argument("--dry-run", action="store_true", help="Only print how many rows would be deleted.")
    args = parser.parse_args()

    deleted = clean_test_history_records(
        before=args.before,
        after=args.after,
        dry_run=args.dry_run,
    )
    print(f"{'would_delete' if args.dry_run else 'deleted'}={deleted}")


if __name__ == "__main__":
    main()
