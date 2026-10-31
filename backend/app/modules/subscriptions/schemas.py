"""
Pydantic Schemas for Subscriptions Engine [PDF 5.6, 6.1, 8].
Owned by Vrindha.

Provides strict request validation and response serialization models for:
- Subscription Creation and Updates
- Line Items
- State Machine Transitions
- Detail and List Views
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.subscriptions.models import SubscriptionStatus


# ============================================================================
# SUBSCRIPTION LINE SCHEMAS
# ============================================================================

class SubscriptionLineBase(BaseModel):
    """Base schema for subscription line item."""
    product_id: str = Field(..., description="Foreign key to the catalog product")
    variant_id: Optional[str] = Field(None, description="Optional product variant ID")
    description: Optional[str] = Field(None, max_length=255, description="Snapshot product title / description")
    quantity: int = Field(1, ge=1, description="Contracted item quantity (>= 1)")
    unit_price: Decimal = Field(
        Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Snapshot unit price per billing cycle",
    )
    tax_id: Optional[str] = Field(None, description="Foreign key referencing taxes schedule")
    tax_rate: Decimal = Field(
        Decimal("0.0000"),
        ge=Decimal("0.0000"),
        decimal_places=4,
        description="Tax rate percentage snapshot (e.g. 18.0 for 18% GST)",
    )
    discount_amount: Decimal = Field(
        Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Discount allocation for this line",
    )


class SubscriptionLineCreate(BaseModel):
    """Payload to add a line item when creating or modifying a draft subscription."""
    product_id: str = Field(..., description="ID of catalog product")
    variant_id: Optional[str] = Field(None, description="ID of product variant if applicable")
    description: Optional[str] = Field(None, max_length=255, description="Custom line description or product title")
    quantity: int = Field(1, ge=1, description="Quantity contracted (must be >= 1)")
    unit_price: Optional[Decimal] = Field(
        None,
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Optional unit price snapshot (defaults to catalog price if omitted)",
    )
    tax_id: Optional[str] = Field(None, description="Optional tax schedule ID")
    tax_rate: Optional[Decimal] = Field(
        Decimal("0.0000"),
        ge=Decimal("0.0000"),
        decimal_places=4,
        description="Applicable tax rate percentage",
    )
    discount_amount: Optional[Decimal] = Field(
        Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Line-level discount amount",
    )


class SubscriptionLineUpdate(BaseModel):
    """Payload to update an existing line item on a draft subscription."""
    quantity: Optional[int] = Field(None, ge=1, description="Updated quantity")
    unit_price: Optional[Decimal] = Field(None, ge=Decimal("0.00"), decimal_places=2, description="Updated unit price")
    tax_id: Optional[str] = Field(None, description="Updated tax schedule ID")
    tax_rate: Optional[Decimal] = Field(None, ge=Decimal("0.0000"), decimal_places=4, description="Updated tax rate")
    discount_amount: Optional[Decimal] = Field(None, ge=Decimal("0.00"), decimal_places=2, description="Updated discount")
    description: Optional[str] = Field(None, max_length=255, description="Updated description")


class SubscriptionLineResponse(SubscriptionLineBase):
    """Response representation of a subscription line item."""
    id: str = Field(..., description="Primary key UUID string")
    subscription_id: str = Field(..., description="Parent subscription ID")
    subtotal: Decimal = Field(..., decimal_places=2, description="Line subtotal: quantity * unit_price")
    total: Decimal = Field(..., decimal_places=2, description="Net line total after discount and tax")
    tax_id: Optional[str] = Field(None, description="Snapshot tax rule ID")
    discount_id: Optional[str] = Field(None, description="Applied discount rule ID")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ============================================================================
# SUBSCRIPTION MASTER SCHEMAS
# ============================================================================

class SubscriptionBase(BaseModel):
    """Common attributes for subscription entities."""
    customer_id: str = Field(..., description="Foreign key to customer")
    plan_id: str = Field(..., description="Foreign key to subscription plan")
    start_date: Optional[date] = Field(None, description="Contract activation/start date")
    end_date: Optional[date] = Field(None, description="Contract termination date (None for auto-renew)")
    anchor_day: Optional[int] = Field(
        None,
        ge=1,
        le=31,
        description="Calendar anchor day (1-31) for month-end stabilization",
    )
    quotation_expires_at: Optional[date] = Field(None, description="Quotation validity deadline")
    currency: Optional[str] = Field("INR", max_length=3, description="ISO currency code")


class SubscriptionCreate(SubscriptionBase):
    """Payload to create a new draft subscription."""
    template_id: Optional[str] = Field(None, description="Optional quotation template ID to clone from")
    payment_term_id: Optional[str] = Field(None, description="Optional payment term ID")
    lines: List[SubscriptionLineCreate] = Field(
        default_factory=list,
        description="Initial line items contracted under this subscription",
    )

    @field_validator("anchor_day")
    @classmethod
    def validate_anchor_day(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 31):
            raise ValueError("anchor_day must be an integer between 1 and 31")
        return v


class SubscriptionUpdate(BaseModel):
    """Payload to update an editable draft or quotation subscription."""
    start_date: Optional[date] = Field(None, description="Updated start date")
    end_date: Optional[date] = Field(None, description="Updated end date")
    anchor_day: Optional[int] = Field(None, ge=1, le=31, description="Updated anchor day (1-31)")
    quotation_expires_at: Optional[date] = Field(None, description="Updated quotation expiration date")
    payment_term_id: Optional[str] = Field(None, description="Updated payment term ID")
    lines: Optional[List[SubscriptionLineCreate]] = Field(None, description="Full replacement list of line items")


class SubscriptionResponse(BaseModel):
    """Standard Subscription Response."""
    id: str = Field(..., description="Primary key UUID string")
    number: str = Field(..., description="Unique formatted sequence number, e.g. SUB-2026-000001")
    customer_id: str = Field(..., description="Foreign key to customer")
    plan_id: str = Field(..., description="Foreign key to plan")
    status: SubscriptionStatus = Field(..., description="Current lifecycle state")
    start_date: date = Field(..., description="Contract start date")
    end_date: Optional[date] = Field(None, description="Contract end date")
    next_billing_date: Optional[date] = Field(None, description="Next billing engine trigger date")
    anchor_day: int = Field(..., description="Billing anchor day (1-31)")
    quotation_expires_at: Optional[date] = Field(None, description="Quotation expiration date")
    currency: str = Field("INR", description="Currency code")
    subtotal: Decimal = Field(..., decimal_places=2, description="Gross subtotal amount")
    discount_amount: Decimal = Field(..., decimal_places=2, description="Total discount deduction")
    tax_amount: Decimal = Field(..., decimal_places=2, description="Total tax amount")
    total_amount: Decimal = Field(..., decimal_places=2, description="Net total amount per billing period")
    paused_at: Optional[datetime] = Field(None, description="Timestamp when paused")
    closed_at: Optional[datetime] = Field(None, description="Timestamp when closed")
    close_reason: Optional[str] = Field(None, description="Reason recorded at closure")
    last_billed_through: Optional[date] = Field(None, description="Most recent billed period end date")
    created_at: datetime = Field(..., description="Record creation timestamp")
    updated_at: datetime = Field(..., description="Record last updated timestamp")
    lines: List[SubscriptionLineResponse] = Field(default_factory=list, description="Contract line items")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class SubscriptionDetailResponse(SubscriptionResponse):
    """Detailed Subscription Response including template and customer relations."""
    template_id: Optional[str] = Field(None, description="Template ID cloned from")
    payment_term_id: Optional[str] = Field(None, description="Payment term ID")


# ============================================================================
# STATE TRANSITION SCHEMAS [PDF 6.1, 8]
# ============================================================================

class SubscriptionTransitionRequest(BaseModel):
    """
    Generic state transition request payload.
    Dispatches a state machine transition to target_status [PDF 6.1].
    """
    target: SubscriptionStatus = Field(
        ...,
        description="Target lifecycle state: draft, quotation, confirmed, active, paused, closed, cancelled",
    )
    reason: Optional[str] = Field(
        None,
        description="Optional justification or context (mandatory when transitioning to 'closed')",
    )

    @field_validator("target", mode="before")
    @classmethod
    def parse_target_status(cls, v: Any) -> SubscriptionStatus:
        if isinstance(v, SubscriptionStatus):
            return v
        if isinstance(v, str):
            try:
                return SubscriptionStatus.from_str(v)
            except ValueError:
                raise ValueError(
                    f"Invalid target status '{v}'. Allowed states: "
                    f"{[s.value for s in SubscriptionStatus]}"
                )
        raise ValueError(f"Invalid type for target status: {type(v)}")


class SubscriptionPauseRequest(BaseModel):
    """Request payload to pause an active subscription."""
    reason: Optional[str] = Field(None, description="Optional explanation for pausing")


class SubscriptionResumeRequest(BaseModel):
    """Request payload to resume a paused subscription."""
    notes: Optional[str] = Field(None, description="Optional notes on resumption")


class SubscriptionCloseRequest(BaseModel):
    """Request payload to close an active subscription [PDF 6.1]."""
    close_reason: str = Field(..., min_length=3, description="Mandatory reason for closing the subscription")


class SubscriptionRenewRequest(BaseModel):
    """Request payload to renew a closed subscription."""
    new_end_date: Optional[date] = Field(None, description="Optional new expiry date for the renewed term")

