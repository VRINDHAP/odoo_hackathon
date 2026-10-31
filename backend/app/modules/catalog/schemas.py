"""
Pydantic v2 Schemas for Products, Variants, and Pricing [PDF 5.3, 8].
Enforces fixed-precision Decimal representation and Admin-only margin visibility.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.modules.catalog.models import ProductType


class VariantCreateRequest(BaseModel):
    """Variant addition payload [PDF 5.3, 8]."""
    attribute: str = Field(..., min_length=1, max_length=100, description="Attribute name e.g. 'Brand'")
    value: str = Field(..., min_length=1, max_length=100, description="Attribute value e.g. 'Odoo'")
    extra_price: Decimal = Field(default=Decimal("0.00"), ge=0, description="Extra surcharge added to base sales price")


class ProductVariantResponse(BaseModel):
    """Product variant public representation."""
    id: str
    product_id: str
    attribute: str
    value: str
    extra_price: Decimal
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProductCreateRequest(BaseModel):
    """Product creation payload (Admin only) [PDF 5.3, 8]."""
    name: str = Field(..., min_length=1, max_length=255, description="Product title")
    type: ProductType = Field(default=ProductType.SOFTWARE, description="service | software | addon | physical")
    sales_price: Decimal = Field(..., gt=0, description="Base sales price (NUMERIC(14,2))")
    cost_price: Decimal = Field(..., ge=0, description="Internal cost price (Admin only visibility)")
    notes: Optional[str] = None
    tax_id: Optional[str] = None


class ProductUpdateRequest(BaseModel):
    """Product modification payload (Admin only)."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    type: Optional[ProductType] = None
    sales_price: Optional[Decimal] = Field(None, gt=0)
    cost_price: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None
    tax_id: Optional[str] = None
    is_active: Optional[bool] = None


class ProductResponse(BaseModel):
    """Product representation with role-sensitive cost and margin exposure [PDF 5.3]."""
    id: str
    name: str
    type: ProductType
    sales_price: Decimal
    # cost_price and margin exposed strictly to Admin; masked as None for staff and customers
    cost_price: Optional[Decimal] = None
    margin: Optional[Decimal] = None
    notes: Optional[str] = None
    tax_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    variants: List[ProductVariantResponse] = []

    model_config = ConfigDict(from_attributes=True)
