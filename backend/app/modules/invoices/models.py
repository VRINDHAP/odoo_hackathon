"""
SQLAlchemy Domain Models for Invoices & Billing [PDF 5.9, 7.2].
Owned by Vrindha.

Defines:
- Invoice: The master invoice document generated recurringly from subscriptions.
  Enforces zero-double-billing via UNIQUE(subscription_id, period_start, period_end).
- InvoiceLine: Detailed line items snapshotting product, price, quantity, discount, and tax.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship

from app.core.db import Base

try:
    from app.modules.subscriptions.models import Subscription, SubscriptionLine  # noqa: F401
    from app.modules.customers.models import Customer  # noqa: F401
    from app.modules.catalog.models import Product  # noqa: F401
    from app.modules.taxes.models import Tax  # noqa: F401
except ImportError:
    pass


class InvoiceStatus(str, enum.Enum):
    """Invoice Lifecycle States [PDF 6.2]."""
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    PAID = "paid"
    CANCELLED = "cancelled"


class Invoice(Base):
    """
    Invoice Entity [PDF 5.9, 7.2].
    Generated exclusively from recurring subscriptions or quotations.
    """
    __tablename__ = "invoices"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    number = Column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        doc="Formatted unique sequence number, e.g. INV-2026-000001",
    )
    subscription_id = Column(
        String(36),
        ForeignKey("subscriptions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        doc="Foreign key to originating subscription",
    )
    customer_id = Column(
        String(36),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        doc="Foreign key referencing the billed customer",
    )
    status = Column(
        Enum(InvoiceStatus, values_callable=lambda x: [e.value for e in x], native_enum=False, length=20),
        nullable=False,
        default=InvoiceStatus.CONFIRMED,
        index=True,
        doc="Invoice status in state machine",
    )
    invoice_date = Column(
        Date,
        nullable=False,
        default=date.today,
        doc="Date when invoice was generated/issued",
    )
    due_date = Column(
        Date,
        nullable=False,
        doc="Date when payment is due based on payment terms",
    )
    period_start = Column(
        Date,
        nullable=False,
        doc="Billing cycle start boundary (inclusive)",
    )
    period_end = Column(
        Date,
        nullable=False,
        doc="Billing cycle end boundary (exclusive)",
    )

    # Monetary summary accumulators [PDF 5.9]
    subtotal = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Sum of line subtotals before discounts and taxes",
    )
    discount_total = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Total discount reduction applied",
    )
    tax_total = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Total taxes assessed",
    )
    total = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Net payable invoice amount: (subtotal - discount_total) + tax_total",
    )
    amount_paid = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Cumulative amount paid towards this invoice",
    )
    balance = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Remaining unpaid balance: total - amount_paid",
    )
    sent_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp when invoice was transmitted to customer",
    )
    pdf_url = Column(
        String(255),
        nullable=True,
        doc="Local or storage path to generated invoice PDF",
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
    lines = relationship(
        "InvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="InvoiceLine.id",
    )
    payments = relationship(
        "Payment",
        back_populates="invoice",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Payment.created_at",
    )

    # Hard anti-double-billing constraint [PDF 1, 5.9, 7.2]
    __table_args__ = (
        UniqueConstraint("subscription_id", "period_start", "period_end", name="uq_invoice_sub_period"),
        Index("idx_invoices_customer_status", "customer_id", "status"),
        Index("idx_invoices_due_date_status", "due_date", "status"),
        Index(
            "idx_invoices_overdue",
            "status",
            "due_date",
            postgresql_where=text("status = 'confirmed' AND balance > 0"),
            sqlite_where=text("status = 'confirmed' AND balance > 0"),
        ),
        {"extend_existing": True},
    )

    def __repr__(self) -> str:
        return f"<Invoice id={self.id} number={self.number} status={self.status} total={self.total}>"


class InvoiceLine(Base):
    """
    Invoice Line Item [PDF 5.9].
    Snapshots contracted product pricing and taxes at the moment of invoice generation.
    """
    __tablename__ = "invoice_lines"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    invoice_id = Column(
        String(36),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    description = Column(
        String(255),
        nullable=True,
    )
    quantity = Column(
        Integer,
        nullable=False,
        default=1,
    )
    unit_price = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    discount_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    tax_id = Column(
        String(36),
        nullable=True,
    )
    tax_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )
    line_total = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
    )

    invoice = relationship("Invoice", back_populates="lines")
    __table_args__ = {"extend_existing": True}

    def __repr__(self) -> str:
        return f"<InvoiceLine id={self.id} product_id={self.product_id} qty={self.quantity} total={self.line_total}>"
