"""
SQLAlchemy Domain Models for Subscriptions Engine [PDF 5.6, 6.1, 7.2].
Owned by Vrindha.

Defines:
- Subscription: Master subscription contract entity with lifecycle states,
  anchored billing intervals, snapshot financial accumulators, and timestamps.
- SubscriptionLine: Contract line items with snapshot unit price, quantity,
  tax rates, and discount allocations.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    CheckConstraint,
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
    Text,
)
from sqlalchemy.orm import relationship

from app.core.db import Base

try:
    from app.modules.customers.models import Customer  # noqa: F401
    from app.modules.plans.models import Plan  # noqa: F401
    from app.modules.catalog.models import Product, ProductVariant  # noqa: F401
    from app.modules.taxes.models import Tax  # noqa: F401
except ImportError:
    pass


class SubscriptionStatus(str, enum.Enum):
    """
    Subscription Lifecycle States [PDF 6.1].
    Transitions governed by SubscriptionStateMachine:
    Draft -> Quotation -> Confirmed -> Active -> Closed
                                     |    ^
                                     v    |
                                   Paused
    Draft/Quotation/Confirmed -> Cancelled
    """
    DRAFT = "draft"
    QUOTATION = "quotation"
    CONFIRMED = "confirmed"
    ACTIVE = "active"
    PAUSED = "paused"
    CLOSED = "closed"
    CANCELLED = "cancelled"

    @classmethod
    def from_str(cls, value: str) -> "SubscriptionStatus":
        """Parse status string case-insensitively."""
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        raise ValueError(f"Invalid subscription status: '{value}'")


class Subscription(Base):
    """
    Subscription Entity [PDF 5.6, 6.1, 7.2].
    Represents an ongoing recurring contract between Brightloop and a Customer.
    """
    __tablename__ = "subscriptions"
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
        doc="Human-readable unique sequence number, e.g. SUB-2026-000001",
    )
    customer_id = Column(
        String(36),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        doc="Foreign key referencing the subscriber (customer)",
    )
    plan_id = Column(
        String(36),
        ForeignKey("plans.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        doc="Foreign key referencing the subscription plan",
    )
    status = Column(
        Enum(
            SubscriptionStatus,
            values_callable=lambda x: [e.value for e in x],
            native_enum=False,
            length=20,
        ),
        default=SubscriptionStatus.DRAFT,
        nullable=False,
        index=True,
        doc="Current state in the subscription lifecycle state machine",
    )
    start_date = Column(
        Date,
        nullable=False,
        doc="Contract start date",
    )
    end_date = Column(
        Date,
        nullable=True,
        doc="Contract expiry or termination date (None for evergreen)",
    )
    next_billing_date = Column(
        Date,
        nullable=True,
        index=True,
        doc="Next date when automated billing engine generates an invoice",
    )
    anchor_day = Column(
        Integer,
        CheckConstraint("anchor_day >= 1 AND anchor_day <= 31", name="ck_subscriptions_anchor_day"),
        nullable=False,
        default=1,
        doc="Calendar day (1-31) used to clamp billing cycles without date drift",
    )
    quotation_expires_at = Column(
        Date,
        nullable=True,
        doc="Expiration date for quotation validity [PDF 5.5, 6.1]",
    )

    # Financial Snapshot Totals [PDF 5.6]
    total_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Total recurring amount inclusive of tax and discounts",
    )
    subtotal = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Sum of line subtotals before taxes and discounts",
    )
    tax_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Total recurring tax amount",
    )
    discount_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Total recurring discount reduction",
    )

    # Lifecycle State Metadata [PDF 5.6, 6.1]
    template_id = Column(
        String(36),
        nullable=True,
        doc="Quotation template id cloned to create this subscription, if any",
    )
    payment_term_id = Column(
        String(36),
        nullable=True,
        doc="Foreign key to payment terms (e.g. Net 15, Net 30)",
    )
    currency = Column(
        String(3),
        nullable=False,
        default="INR",
        doc="ISO 4217 Currency code, default INR",
    )
    last_billed_through = Column(
        Date,
        nullable=True,
        doc="End date of the most recent successfully billed period",
    )
    paused_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp when subscription was paused",
    )
    closed_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp when subscription was closed",
    )
    close_reason = Column(
        Text,
        nullable=True,
        doc="Mandatory reason explaining why subscription was closed [PDF 6.1]",
    )

    # Audit Timestamps
    created_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        doc="Record creation timestamp in UTC",
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        doc="Record last update timestamp in UTC",
    )

    # Relationships
    lines = relationship(
        "SubscriptionLine",
        back_populates="subscription",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="SubscriptionLine.id",
    )

    # Composite Index for high-performance billing queries [PDF 5.11, 7.2]
    __table_args__ = (
        Index("idx_subscriptions_status_billing_date", "status", "next_billing_date"),
        Index("idx_subscriptions_customer_id", "customer_id"),
        Index("idx_subscriptions_customer_status", "customer_id", "status"),
        {"extend_existing": True},
    )

    # Convenience Property Aliases for full specification interoperability
    @property
    def total(self) -> Decimal:
        return self.total_amount

    @total.setter
    def total(self, value: Decimal) -> None:
        self.total_amount = value

    @property
    def tax_total(self) -> Decimal:
        return self.tax_amount

    @tax_total.setter
    def tax_total(self, value: Decimal) -> None:
        self.tax_amount = value

    @property
    def discount_total(self) -> Decimal:
        return self.discount_amount

    @discount_total.setter
    def discount_total(self, value: Decimal) -> None:
        self.discount_amount = value

    @property
    def expiry_date(self) -> Optional[date]:
        return self.end_date

    @expiry_date.setter
    def expiry_date(self, value: Optional[date]) -> None:
        self.end_date = value

    @property
    def quote_valid_until(self) -> Optional[date]:
        return self.quotation_expires_at

    @quote_valid_until.setter
    def quote_valid_until(self, value: Optional[date]) -> None:
        self.quotation_expires_at = value

    def recalculate_totals(self) -> None:
        """Recompute financial summary aggregates from child lines."""
        sub = Decimal("0.00")
        disc = Decimal("0.00")
        tax = Decimal("0.00")
        tot = Decimal("0.00")
        for line in self.lines:
            sub += line.subtotal
            disc += line.discount_amount
            tax_portion = (line.subtotal - line.discount_amount) * (line.tax_rate / Decimal("100.0")) if line.tax_rate else Decimal("0.00")
            tax += tax_portion
            tot += line.total
        self.subtotal = sub.quantize(Decimal("0.01"))
        self.discount_amount = disc.quantize(Decimal("0.01"))
        self.tax_amount = tax.quantize(Decimal("0.01"))
        self.total_amount = tot.quantize(Decimal("0.01"))

    def __repr__(self) -> str:
        return f"<Subscription id={self.id} number={self.number} status={self.status.value}>"


class SubscriptionLine(Base):
    """
    Subscription Line Item [PDF 5.6].
    Snapshots pricing, tax rates, and quantities for recurring billing.
    """
    __tablename__ = "subscription_lines"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    subscription_id = Column(
        String(36),
        ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Foreign key to parent subscription",
    )
    product_id = Column(
        String(36),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        doc="Foreign key to catalog product",
    )
    variant_id = Column(
        String(36),
        ForeignKey("product_variants.id", ondelete="SET NULL"),
        nullable=True,
        doc="Foreign key to product variant, if applicable",
    )
    quantity = Column(
        Integer,
        nullable=False,
        default=1,
        doc="Quantity contracted (must be >= plan.min_quantity)",
    )
    unit_price = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Locked snapshot unit price at subscription creation/repricing",
    )
    tax_rate = Column(
        Numeric(14, 4),
        nullable=False,
        default=Decimal("0.0000"),
        doc="Tax percentage rate (e.g. 18.0000 for 18% GST)",
    )
    discount_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Allocated recurring discount amount for this line",
    )
    subtotal = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Line subtotal before tax and discount: quantity * unit_price",
    )
    total = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Net line total: (subtotal - discount_amount) + line_tax",
    )
    description = Column(
        String(255),
        nullable=True,
        doc="Line item display title or product snapshot name",
    )
    tax_id = Column(
        String(36),
        nullable=True,
        doc="Snapshot tax rule identifier",
    )
    discount_id = Column(
        String(36),
        nullable=True,
        doc="Applied discount rule identifier",
    )

    # Relationship to parent
    subscription = relationship(
        "Subscription",
        back_populates="lines",
    )
    __table_args__ = {"extend_existing": True}

    # Convenience Property Aliases
    @property
    def line_subtotal(self) -> Decimal:
        return self.subtotal

    @line_subtotal.setter
    def line_subtotal(self, value: Decimal) -> None:
        self.subtotal = value

    @property
    def line_total(self) -> Decimal:
        return self.total

    @line_total.setter
    def line_total(self, value: Decimal) -> None:
        self.total = value

    def recalculate(self) -> None:
        """Compute subtotal and total based on quantity, unit price, discount, and tax rate."""
        qty = Decimal(str(self.quantity))
        price = Decimal(str(self.unit_price))
        self.subtotal = (qty * price).quantize(Decimal("0.01"))
        taxable = max(Decimal("0.00"), self.subtotal - self.discount_amount)
        line_tax = (taxable * (Decimal(str(self.tax_rate)) / Decimal("100.0"))).quantize(Decimal("0.01"))
        self.total = (taxable + line_tax).quantize(Decimal("0.01"))

    def __repr__(self) -> str:
        return (
            f"<SubscriptionLine id={self.id} subscription_id={self.subscription_id} "
            f"product_id={self.product_id} qty={self.quantity} total={self.total}>"
        )
