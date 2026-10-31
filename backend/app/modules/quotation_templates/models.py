"""
Quotation Template Domain Models [PDF 5.5, 8].
Standardized product bundles with validity windows and one-click draft subscription generation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.db import Base


class QuotationTemplate(Base):
    """
    Quotation Template master entity [PDF 5.5, 8].
    Represents reusable sales templates with bundled products and preset validity days.
    """
    __tablename__ = "quotation_templates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    validity_days = Column(Integer, default=30, nullable=False)
    plan_id = Column(String(36), ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    lines = relationship(
        "QuotationTemplateLine",
        back_populates="template",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="QuotationTemplateLine.id",
    )
    plan = relationship("Plan", lazy="joined")

    __table_args__ = {"extend_existing": True}

    def __repr__(self) -> str:
        return f"<QuotationTemplate id={self.id} name={self.name} validity_days={self.validity_days}>"


class QuotationTemplateLine(Base):
    """
    Quotation Template Line item entity [PDF 5.5].
    Pre-configures products, variants, quantities, and agreed unit prices.
    """
    __tablename__ = "quotation_template_lines"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    template_id = Column(
        String(36),
        ForeignKey("quotation_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    variant_id = Column(
        String(36),
        ForeignKey("product_variants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    # Relationships
    template = relationship("QuotationTemplate", back_populates="lines")
    product = relationship("Product", lazy="joined")
    variant = relationship("ProductVariant", lazy="joined")

    __table_args__ = {"extend_existing": True}

    def __repr__(self) -> str:
        return (
            f"<QuotationTemplateLine id={self.id} product_id={self.product_id} "
            f"quantity={self.quantity} unit_price={self.unit_price}>"
        )
