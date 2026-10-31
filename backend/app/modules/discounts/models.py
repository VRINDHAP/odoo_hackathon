"""
SQLAlchemy Domain Models for Discount Rule Engine [PDF 5.8, 7.3].
Owned by Vrindha.

Defines:
- DiscountRule: Configurable percentage or fixed discount rules with min purchase/quantity thresholds,
  calendar validity boundaries, usage limits, and product/subscription scopes.
- DiscountProduct: Explicit product associations for product-scoped discounts.
- DiscountRedemption: Historical audit record of discount redemptions mapped to invoices/subscriptions
  with anti-duplicate application constraint.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    Boolean,
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
)
from sqlalchemy.orm import relationship

from app.core.db import Base

try:
    from app.modules.subscriptions.models import Subscription  # noqa: F401
except ImportError:
    pass

# Ensure referenced foreign tables exist in Base.metadata for SQLite in-memory testing
for _tbl in ("products", "invoices"):
    if _tbl not in Base.metadata.tables:
        Table(_tbl, Base.metadata, Column("id", String(36), primary_key=True), extend_existing=True)


class DiscountType(str, enum.Enum):
    """Discount value computation strategy [PDF 5.8]."""
    PERCENT = "percent"
    FIXED = "fixed"


class DiscountScope(str, enum.Enum):
    """Applicability domain [PDF 5.8]."""
    SUBSCRIPTION = "subscription"
    PRODUCT = "product"


class DiscountRule(Base):
    """
    Discount Rule Entity [PDF 5.8, 7.3].
    Governs automated discount evaluations and usage tracking.
    """
    __tablename__ = "discount_rules"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    name = Column(
        String(100),
        nullable=False,
        index=True,
        doc="Human-readable rule name, e.g. 'Early Bird 20%'",
    )
    type = Column(
        Enum(DiscountType, values_callable=lambda x: [e.value for e in x], native_enum=False, length=20),
        nullable=False,
        doc="Calculation type: 'percent' or 'fixed'",
    )
    value = Column(
        Numeric(14, 2),
        nullable=False,
        doc="Discount percentage (e.g. 20.00 for 20%) or fixed reduction amount",
    )
    min_purchase_amount = Column(
        Numeric(14, 2),
        nullable=False,
        default=Decimal("0.00"),
        doc="Minimum eligible subtotal to trigger discount",
    )
    min_quantity = Column(
        Integer,
        nullable=False,
        default=1,
        doc="Minimum eligible contracted quantity across line items",
    )
    start_date = Column(
        Date,
        nullable=False,
        doc="Start of validity period (inclusive)",
    )
    end_date = Column(
        Date,
        nullable=False,
        doc="End of validity period (inclusive)",
    )
    usage_limit = Column(
        Integer,
        nullable=True,
        doc="Maximum allowed redemptions (NULL for unlimited)",
    )
    usage_count = Column(
        Integer,
        nullable=False,
        default=0,
        doc="Total times this discount has been redeemed on invoices",
    )
    scope = Column(
        Enum(DiscountScope, values_callable=lambda x: [e.value for e in x], native_enum=False, length=20),
        nullable=False,
        default=DiscountScope.SUBSCRIPTION,
        doc="'subscription' for entire order, 'product' for specific products",
    )
    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
        doc="Master active toggle",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        doc="Creation timestamp in UTC",
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        doc="Last updated timestamp in UTC",
    )

    # Relationships
    products = relationship(
        "DiscountProduct",
        back_populates="discount",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    redemptions = relationship(
        "DiscountRedemption",
        back_populates="discount",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("idx_discount_rules_active_dates", "is_active", "start_date", "end_date"),
    )

    def is_eligible(self, current_date: date) -> bool:
        """Checks if rule is active and within calendar validity."""
        if not self.is_active:
            return False
        if not (self.start_date <= current_date <= self.end_date):
            return False
        if self.usage_limit is not None and self.usage_count >= self.usage_limit:
            return False
        return True

    def __repr__(self) -> str:
        return f"<DiscountRule id={self.id} name='{self.name}' type={self.type} value={self.value}>"


class DiscountProduct(Base):
    """
    Eligible products junction table for product-scoped discounts [PDF 5.8].
    """
    __tablename__ = "discount_products"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    discount_id = Column(
        String(36),
        ForeignKey("discount_rules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    discount = relationship("DiscountRule", back_populates="products")

    __table_args__ = (
        UniqueConstraint("discount_id", "product_id", name="uq_discount_product"),
    )

    def __repr__(self) -> str:
        return f"<DiscountProduct discount_id={self.discount_id} product_id={self.product_id}>"


class DiscountRedemption(Base):
    """
    Discount Redemption Record [PDF 5.8].
    Guarantees anti-duplicate redemption via UNIQUE(discount_id, invoice_id).
    """
    __tablename__ = "discount_redemptions"
    __allow_unmapped__ = True

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="Primary key UUID string",
    )
    discount_id = Column(
        String(36),
        ForeignKey("discount_rules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invoice_id = Column(
        String(36),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    subscription_id = Column(
        String(36),
        ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    amount = Column(
        Numeric(14, 2),
        nullable=False,
        doc="Financial discount amount applied to this invoice",
    )
    created_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    discount = relationship("DiscountRule", back_populates="redemptions")

    __table_args__ = (
        UniqueConstraint("discount_id", "invoice_id", name="uq_discount_redemption_invoice"),
    )

    def __repr__(self) -> str:
        return f"<DiscountRedemption id={self.id} discount_id={self.discount_id} amount={self.amount}>"

