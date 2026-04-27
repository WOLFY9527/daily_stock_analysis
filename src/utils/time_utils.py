from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional


BEIJING_TIMEZONE = timezone(timedelta(hours=8))


def to_beijing_iso8601(value: object) -> Optional[str]:
    if value is None:
        return None

    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return text

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return dt.astimezone(BEIJING_TIMEZONE).isoformat()
