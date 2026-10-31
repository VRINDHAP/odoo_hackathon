"""
Pydantic Schemas for Recurring Billing Engine [PDF 7.2, 8].
Owned by Vrindha.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class BillingRunTriggerRequest(BaseModel):
    """Payload to trigger manual or automated recurring billing run."""
    target_date: Optional[date] = Field(None, description="Billing cutoff date (defaults to today)")
    batch_size: int = Field(100, ge=1, le=1000, description="Maximum subscriptions to process in this run")


class BillingRunErrorItem(BaseModel):
    """Structured error entry recorded during billing run."""
    subscription_id: str
    error: str


class BillingRunResponse(BaseModel):
    """Summary of a billing run execution [PDF 7.2, 8]."""
    id: str
    run_date: date
    started_at: datetime
    finished_at: Optional[datetime] = None
    created_count: int
    skipped_count: int
    failed_count: int
    error_summary: Optional[Any] = None
    duration_seconds: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

