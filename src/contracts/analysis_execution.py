# -*- coding: utf-8 -*-
"""Typed execution outcome for caller-visible analysis runs."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional


class AnalysisExecutionStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class AnalysisExecutionResult:
    """Carry analysis truth from its producer to CLI, scheduler, and service owners."""

    status: AnalysisExecutionStatus
    reason: Optional[str] = None
    results: List[Any] = field(default_factory=list)
    report_path: Optional[str] = None
    market_report: Optional[str] = None
    failed_count: int = 0

    @classmethod
    def success(
        cls,
        *,
        results: Optional[List[Any]] = None,
        report_path: Optional[str] = None,
        market_report: Optional[str] = None,
        failed_count: int = 0,
    ) -> "AnalysisExecutionResult":
        return cls(
            status=AnalysisExecutionStatus.SUCCESS,
            results=list(results or []),
            report_path=report_path,
            market_report=market_report,
            failed_count=failed_count,
        )

    @classmethod
    def failed(
        cls,
        reason: str,
        *,
        results: Optional[List[Any]] = None,
        report_path: Optional[str] = None,
        market_report: Optional[str] = None,
        failed_count: int = 0,
    ) -> "AnalysisExecutionResult":
        return cls(
            status=AnalysisExecutionStatus.FAILED,
            reason=reason,
            results=list(results or []),
            report_path=report_path,
            market_report=market_report,
            failed_count=failed_count,
        )

    @classmethod
    def skipped(cls, reason: str) -> "AnalysisExecutionResult":
        return cls(status=AnalysisExecutionStatus.SKIPPED, reason=reason)

    @property
    def is_success(self) -> bool:
        return self.status is AnalysisExecutionStatus.SUCCESS

    @property
    def is_failed(self) -> bool:
        return self.status is AnalysisExecutionStatus.FAILED

    @property
    def is_skipped(self) -> bool:
        return self.status is AnalysisExecutionStatus.SKIPPED
