"""
Catalog Domain Models: Products and Product Variants [PDF 5.3].
"""
import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from app.core.db import Base


class ProductType(str, enum.Enum):
    """Product Type Enum [PDF 5.3]."""
    SERVICE = "service"
    SOFTWARE = "software"
    ADDON = "addon"
    PHYSICAL = "physical"


class Product(Base):
    """Product entity with sales and cost prices [PDF 5.3]."""
    __tablename__ = "products"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    type = Column(
        Enum(ProductType, values_callable=lambda x: [e.value for e in x]),
        default=ProductType.SOFTWARE,
        nullable=False,
    )
    sales_price = Column(Numeric(14, 2), nullable=False)
    cost_price = Column(Numeric(14, 2), nullable=False)
    notes = Column(Text, nullable=True)
    tax_id = Column(String(36), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = {"extend_existing": True}

    variants = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Product id={self.id} name={self.name} price={self.sales_price}>"


class ProductVariant(Base):
    """
    Product Variant entity [PDF 5.3].
    e.g. attribute='Brand', value='Odoo', extra_price=560.00
    Enforces composite uniqueness: UNIQUE(product_id, attribute, value).
    """
    __tablename__ = "product_variants"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    product_id = Column(String(36), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    attribute = Column(String(100), nullable=False)
    value = Column(String(100), nullable=False)
    extra_price = Column(Numeric(14, 2), default=0.00, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("product_id", "attribute", "value", name="uq_product_variant"),
        {"extend_existing": True},
    )

    product = relationship("Product", back_populates="variants")

    def __repr__(self):
        return f"<ProductVariant id={self.id} {self.attribute}={self.value} +{self.extra_price}>"
