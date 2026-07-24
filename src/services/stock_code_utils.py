# -*- coding: utf-8 -*-
"""Compatibility entry points delegated to the canonical symbol identity owner."""

from __future__ import annotations

from typing import Optional

from src.utils.symbol_normalization import parse_canonical_symbol


def is_code_like(value: str) -> bool:
    """Return whether a value has one unambiguous canonical symbol identity."""
    identity = parse_canonical_symbol(value)
    return identity is not None and not identity.ambiguous


def normalize_code(raw: str) -> Optional[str]:
    """Return the single canonical symbol spelling, or None for invalid input."""
    identity = parse_canonical_symbol(raw)
    return identity.symbol if identity and not identity.ambiguous else None
