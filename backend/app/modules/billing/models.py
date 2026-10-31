"""
SQLAlchemy Models for Automated Billing Runs [PDF 5.10, 7.2].
Owned by Vrindha.

Defines:
- BillingRun: Historical batch execution log tracking created, skipped, and failed counts
  and execution error summaries.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, Date, DateTime, Integer, JSON, String

from app.core.db import Base


class BillingRun(Base):
    """
    Automated and Manual Recurring Billing Run Log [PDF 5.10, 7.2].
    Tracks execution metrics, worker run duration, and error diagnostics.
    """
    __tablename__ = "billing_runs"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    run_date = Column(
        Date,
        nullable=False,
        default=date.today,
        index=True,
        doc="Reference target billing date",
    )
    started_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        doc="Run initiation timestamp in UTC",
    )
    finished_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="Run completion timestamp in UTC",
    )
    created_count = Column(
        Integer,
        nullable=False,
        default=0,
        doc="Number of invoices successfully generated",
    )
    skipped_count = Column(
        Integer,
        nullable=False,
        default=0,
        doc="Number of subscriptions skipped due to idempotency",
    )
    failed_count = Column(
        Integer,
        nullable=False,
        default=0,
        doc="Number of subscriptions that failed with exceptions",
    )
    error_summary = Column(
        JSON,
        nullable=True,
        doc="Structured list of error entries [{subscription_id, error}]",
    )

    @property
    def duration_seconds(self) -> Optional[float]:
        """Calculates runtime duration in seconds."""
        if self.started_at and self.finished_at:
            return (self.finished_at - self.started_at).total_seconds()
        return None

    def __repr__(self) -> str:
        return (
            f"<BillingRun id={self.id} date={self.run_date} "
            f"created={self.created_count} skipped={self.skipped_count} failed={self.failed_count}>"
        )
