# -*- coding: utf-8 -*-
"""Schemas for admin execution logs."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ExecutionLogEventModel(BaseModel):
    id: int
    event_at: Optional[str] = None
    level: Optional[str] = None
    phase: str
    category: Optional[str] = None
    event_name: Optional[str] = None
    step: Optional[str] = None
    action: Optional[str] = None
    outcome: Optional[str] = None
    reason: Optional[str] = None
    target: Optional[str] = None
    status: str
    truth_level: str
    message: Optional[str] = None
    error_code: Optional[str] = None
    detail: Dict[str, Any] = Field(default_factory=dict)


class ExecutionLogSessionSummaryModel(BaseModel):
    session_id: str
    task_id: Optional[str] = None
    query_id: Optional[str] = None
    analysis_history_id: Optional[int] = None
    code: Optional[str] = None
    name: Optional[str] = None
    overall_status: str
    truth_level: str
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    summary: Dict[str, Any] = Field(default_factory=dict)
    readable_summary: Dict[str, Any] = Field(default_factory=dict)


class ExecutionLogSessionDetailModel(ExecutionLogSessionSummaryModel):
    events: List[ExecutionLogEventModel] = Field(default_factory=list)
    operation_detail: Dict[str, Any] = Field(default_factory=dict)


class ExecutionLogSummaryModel(BaseModel):
    error_count: int = 0
    warning_count: int = 0
    data_source_failure_count: int = 0
    slow_request_count: int = 0
    latest_critical_at: Optional[str] = None


class ExecutionLogSessionListResponse(BaseModel):
    total: int
    items: List[ExecutionLogSessionSummaryModel] = Field(default_factory=list)
    summary: ExecutionLogSummaryModel = Field(default_factory=ExecutionLogSummaryModel)


class ExecutionStepModel(BaseModel):
    name: str
    label: str
    provider: Optional[str] = None
    apiPath: Optional[str] = None
    status: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    durationMs: Optional[float] = None
    errorType: Optional[str] = None
    errorMessage: Optional[str] = None
    recordId: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BusinessEventModel(BaseModel):
    id: str
    event: str
    category: str
    status: str
    summary: str
    symbol: Optional[str] = None
    market: Optional[str] = None
    analysisType: Optional[str] = None
    userId: Optional[str] = None
    requestId: Optional[str] = None
    recordId: Optional[str] = None
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    durationMs: Optional[float] = None
    stepCount: int = 0
    successStepCount: int = 0
    failedStepCount: int = 0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BusinessEventDetailModel(BusinessEventModel):
    steps: List[ExecutionStepModel] = Field(default_factory=list)


class BusinessEventListResponse(BaseModel):
    items: List[BusinessEventModel] = Field(default_factory=list)
    total: int
    limit: int
    offset: int
    hasMore: bool = False
