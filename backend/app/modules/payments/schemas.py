"""
Pydantic Schemas for Payments & Invoice Balance Management [PDF 5.9, 7.2, 8].
Owned by Vrindha.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.modules.payments.models import PaymentMethod, PaymentStatus


class PaymentCreate(BaseModel):
    """Payload to record an invoice settlement."""
    invoice_id: Optional[str] = Field(None, description="Invoice ID (optional when passed via URL path)")
    method: PaymentMethod = Field(default=PaymentMethod.CARD, description="Payment method used")
    amount: Decimal = Field(..., gt=Decimal("0.00"), description="Payment amount must be greater than zero")
    reference: Optional[str] = Field(None, max_length=100, description="Transaction hash, cheque number, or gateway reference")
    note: Optional[str] = Field(None, max_length=1000, description="Optional administrative remarks or memo")


class PaymentReversalCreate(BaseModel):
    """Payload to reverse a previously recorded payment."""
    reason: str = Field(..., min_length=3, max_length=255, description="Mandatory audit reason for reversal")
    note: Optional[str] = Field(None, max_length=1000, description="Optional administrative remarks")


class PaymentResponse(BaseModel):
    """Complete payment transaction record."""
    id: str
    invoice_id: str
    method: PaymentMethod
    amount: Decimal
    payment_date: datetime
    reference: Optional[str] = None
    note: Optional[str] = None
    status: PaymentStatus
    recorded_by: Optional[str] = None
    reversal_reason: Optional[str] = None
    reversed_payment_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaymentListResponse(BaseModel):
    """Paginated list of payment transactions."""
    items: List[PaymentResponse]
    total: int
    page: int
    page_size: int
    total_pages: int

