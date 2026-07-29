"""Canonical durable-task retention and capacity policy."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DurableTaskRetentionPolicy:
    """Documented monitoring policy; cleanup remains separately authorized."""

    policy_version: str = "durable_task_retention_v1"
    terminal_retention_days: int = 90
    minimum_retention_days: int = 30
    capacity_warning_rows: int = 50_000
    capacity_critical_rows: int = 100_000
    policy_owner: str = "storage_operations"
    escalation_path: str = "storage_capacity_review"

    def __post_init__(self) -> None:
        if self.terminal_retention_days < 1:
            raise ValueError("terminal_retention_days must be positive")
        if self.minimum_retention_days < 1:
            raise ValueError("minimum_retention_days must be positive")
        if self.minimum_retention_days > self.terminal_retention_days:
            raise ValueError("minimum_retention_days cannot exceed terminal_retention_days")
        if self.capacity_warning_rows < 1:
            raise ValueError("capacity_warning_rows must be positive")
        if self.capacity_critical_rows <= self.capacity_warning_rows:
            raise ValueError("capacity_critical_rows must exceed capacity_warning_rows")

    def public_contract(self) -> dict[str, object]:
        return {
            "policyVersion": self.policy_version,
            "terminalRetentionDays": self.terminal_retention_days,
            "minimumRetentionDays": self.minimum_retention_days,
            "capacityWarningRows": self.capacity_warning_rows,
            "capacityCriticalRows": self.capacity_critical_rows,
            "policyOwner": self.policy_owner,
            "escalationPath": self.escalation_path,
        }
