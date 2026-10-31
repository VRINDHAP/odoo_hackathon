"""
SQLAlchemy Domain Models for Payments & Balance Management [PDF 5.9, 7.2, 8].
Owned by Vrindha.

Defines:
- Payment: Immutable financial settlement recorded against an invoice.
  Includes method, positive settlement amounts (and negative compensatory reversals),
  audit references, status tracking, and actor linkage.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.db import Base

try:
    from app.modules.invoices.models import Invoice  # noqa: F401
except ImportError:
    pass


class PaymentMethod(str, enum.Enum):
    """Supported Payment Methods [PDF 5.9, 7.2, 8]."""
    CARD = "card"
    UPI = "upi"
    BANK_TRANSFER = "bank_transfer"
    CASH = "cash"
    CHEQUE = "cheque"
    OTHER = "other"


class PaymentStatus(str, enum.Enum):
    """Payment Transaction Lifecycle States [PDF 5.9]."""
    SUCCESS = "success"
    REVERSED = "reversed"
    FAILED = "failed"


class Payment(Base):
    """
    Payment Entity [PDF 5.9, 8].
    Represents an immutable financial settlement recorded against an Invoice.
    """
    __tablename__ = "payments"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    invoice_id = Column(
        String(36),
        ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        doc="Target invoice being settled",
    )
    method = Column(
        Enum(PaymentMethod, values_callable=lambda x: [e.value for e in x], native_enum=False, length=20),
        nullable=False,
        default=PaymentMethod.CARD,
        index=True,
        doc="Payment medium / gateway method",
    )
    amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Settlement amount (positive for payments, negative for compensatory reversals)",
    )
    payment_date = Column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        doc="Timestamp when the payment occurred",
    )
    reference = Column(
        String(100),
        nullable=True,
        index=True,
        doc="External gateway transaction ID, UPI reference, or cheque number",
    )
    note = Column(
        Text,
        nullable=True,
        doc="Optional administrative remarks or memo",
    )
    recorded_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        doc="User who recorded or initiated this payment",
    )
    status = Column(
        Enum(PaymentStatus, values_callable=lambda x: [e.value for e in x], native_enum=False, length=20),
        nullable=False,
        default=PaymentStatus.SUCCESS,
        index=True,
        doc="Payment status (success, reversed, failed)",
    )
    reversal_reason = Column(
        String(255),
        nullable=True,
        doc="Mandatory reason explaining why this payment was reversed",
    )
    reversed_payment_id = Column(
        String(36),
        ForeignKey("payments.id", ondelete="SET NULL"),
        nullable=True,
        doc="Link to the original payment if this entry is a compensatory reversal",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    invoice = relationship("Invoice", back_populates="payments")

    __table_args__ = (
        Index("idx_payments_invoice_id", "invoice_id"),
        Index("idx_payments_invoice_status", "invoice_id", "status"),
        Index("idx_payments_payment_date", "payment_date"),
        {"extend_existing": True},
    )

    def __repr__(self) -> str:
        return f"<Payment id={self.id} invoice_id={self.invoice_id} amount={self.amount} status={self.status}>"

