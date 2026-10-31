"""
Pydantic Schemas for Discount Rule Engine [PDF 5.8, 7.3, 8].
Owned by Vrindha.

Provides request/response serialization and validation models for:
- Discount Rule creation and updates
- Scope configuration (subscription vs product)
- Usage telemetry & audit redemptions
- Dynamic invoice discount evaluation
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.discounts.models import DiscountScope, DiscountType


# ============================================================================
# DISCOUNT RULE SCHEMAS
# ============================================================================

class DiscountRuleBase(BaseModel):
    """Base schema for discount rules."""
    name: str = Field(..., min_length=2, max_length=100, description="Rule display title")
    type: DiscountType = Field(..., description="Calculation method: 'percent' or 'fixed'")
    value: Decimal = Field(
        ...,
        ge=Decimal("0.01"),
        decimal_places=2,
        description="Percentage (e.g. 20.00 for 20%) or fixed reduction amount",
    )
    min_purchase_amount: Decimal = Field(
        Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Minimum order subtotal to trigger discount",
    )
    min_quantity: int = Field(
        1,
        ge=1,
        description="Minimum contracted line item quantity threshold",
    )
    start_date: date = Field(..., description="Start of validity period")
    end_date: date = Field(..., description="End of validity period")
    usage_limit: Optional[int] = Field(
        None,
        ge=1,
        description="Global redemption cap (null for unlimited)",
    )
    scope: DiscountScope = Field(
        DiscountScope.SUBSCRIPTION,
        description="Scope: 'subscription' (entire bill) or 'product' (eligible items)",
    )
    is_active: bool = Field(True, description="Master rule active toggle")

    @field_validator("end_date")
    @classmethod
    def validate_date_interval(cls, end_d: date, info: Any) -> date:
        start_d = info.data.get("start_date")
        if start_d and end_d < start_d:
            raise ValueError(f"end_date ({end_d}) cannot precede start_date ({start_d})")
        return end_d

    @field_validator("value")
    @classmethod
    def validate_percent_ceiling(cls, v: Decimal, info: Any) -> Decimal:
        disc_type = info.data.get("type")
        if disc_type == DiscountType.PERCENT and v > Decimal("100.00"):
            raise ValueError("Percentage discount value cannot exceed 100.00%")
        return v


class DiscountRuleCreate(DiscountRuleBase):
    """Payload to create a new discount rule (Admin only)."""
    product_ids: Optional[List[str]] = Field(
        None,
        description="List of eligible product IDs when scope == 'product'",
    )


class DiscountRuleUpdate(BaseModel):
    """Payload to modify an existing discount rule (Admin only)."""
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    type: Optional[DiscountType] = None
    value: Optional[Decimal] = Field(None, ge=Decimal("0.01"), decimal_places=2)
    min_purchase_amount: Optional[Decimal] = Field(None, ge=Decimal("0.00"), decimal_places=2)
    min_quantity: Optional[int] = Field(None, ge=1)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    usage_limit: Optional[int] = Field(None, ge=1)
    scope: Optional[DiscountScope] = None
    is_active: Optional[bool] = None
    product_ids: Optional[List[str]] = None


class DiscountRuleResponse(DiscountRuleBase):
    """Discount Rule representation in API responses."""
    id: str = Field(..., description="Primary key UUID string")
    usage_count: int = Field(..., description="Number of times redeemed")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    product_ids: List[str] = Field(
        default_factory=list,
        description="Associated product IDs for product scope",
    )

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================================================
# USAGE & REDEMPTION TELEMETRY SCHEMAS
# ============================================================================

class DiscountRedemptionItem(BaseModel):
    """Single redemption audit record."""
    id: str
    discount_id: str
    invoice_id: Optional[str]
    subscription_id: Optional[str]
    amount: Decimal = Field(..., decimal_places=2)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DiscountUsageResponse(BaseModel):
    """Usage statistics and redemptions audit payload [PDF 5.8, 8]."""
    discount_id: str
    name: str
    usage_count: int
    usage_limit: Optional[int]
    is_limit_reached: bool
    remaining_uses: Optional[int]
    total_discount_amount: Decimal = Field(Decimal("0.00"), decimal_places=2)
    redemptions: List[DiscountRedemptionItem] = Field(default_factory=list)


# ============================================================================
# EVALUATION REQUEST & RESPONSE SCHEMAS
# ============================================================================

class LineItemForEvaluation(BaseModel):
    """Line item representation passed to the evaluation engine."""
    product_id: str
    quantity: int = Field(1, ge=1)
    unit_price: Decimal = Field(Decimal("0.00"), ge=Decimal("0.00"), decimal_places=2)
    subtotal: Optional[Decimal] = Field(None, ge=Decimal("0.00"), decimal_places=2)


class DiscountEvaluationRequest(BaseModel):
    """Payload to test or preview automated discount evaluation on a quote/order."""
    subtotal: Decimal = Field(..., ge=Decimal("0.00"), decimal_places=2)
    lines: List[LineItemForEvaluation] = Field(..., min_length=1)
    invoice_date: Optional[date] = Field(None, description="Reference billing date, defaults to today")
    customer_id: Optional[str] = Field(None, description="Optional customer ID for future loyalty targeting")


class DiscountEvaluationResponse(BaseModel):
    """Result of automated discount evaluation [PDF 7.3]."""
    discount_id: Optional[str] = Field(None, description="ID of winning discount rule")
    name: Optional[str] = Field(None, description="Name of winning rule")
    discount_amount: Decimal = Field(Decimal("0.00"), decimal_places=2, description="Computed discount relief")
    scope: Optional[str] = Field(None, description="'subscription' or 'product'")
    applied: bool = Field(False, description="True if a valid discount was found and applied")

