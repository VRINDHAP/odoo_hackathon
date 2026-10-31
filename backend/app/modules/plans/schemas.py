"""
Pydantic v2 Validation Schemas for Subscription Plans [PDF 5.2, 8].
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.plans.models import BillingPeriod


class PlanCreateRequest(BaseModel):
    """Payload for registering a subscription plan [PDF 5.2, 8]."""
    name: str = Field(..., min_length=1, max_length=255, description="Plan title e.g. 'Monthly Pro'")
    price: Decimal = Field(default=Decimal("0.00"), ge=0, description="Base recurring price (NUMERIC(14,2))")
    billing_period: BillingPeriod = Field(
        default=BillingPeriod.MONTHLY,
        description="Cadence: daily | weekly | monthly | yearly",
    )
    min_quantity: int = Field(default=1, ge=1, description="Minimum line item quantity requirement")
    valid_from: datetime = Field(default_factory=datetime.utcnow, description="Validity start datetime")
    valid_to: Optional[datetime] = Field(None, description="Optional sunset expiration datetime")

    # Behavior toggle flags [PDF 5.2]
    auto_close: bool = Field(default=False, description="Auto-close upon term expiration")
    closable: bool = Field(default=True, description="Permits manual cancellation by customer/staff")
    pausable: bool = Field(default=True, description="Permits temporary pause")
    renewable: bool = Field(default=True, description="Permits renewal at period end")
    is_active: bool = Field(default=True, description="Plan status for new subscriptions")

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.valid_to and self.valid_from and self.valid_to < self.valid_from:
            raise ValueError("valid_to cannot precede valid_from.")
        return self


class PlanUpdateRequest(BaseModel):
    """Payload for modifying an existing plan or toggling behavior flags [PDF 5.2]."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    price: Optional[Decimal] = Field(None, ge=0)
    billing_period: Optional[BillingPeriod] = None
    min_quantity: Optional[int] = Field(None, ge=1)
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None

    auto_close: Optional[bool] = None
    closable: Optional[bool] = None
    pausable: Optional[bool] = None
    renewable: Optional[bool] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def validate_date_range(self):
        if self.valid_to and self.valid_from and self.valid_to < self.valid_from:
            raise ValueError("valid_to cannot precede valid_from.")
        return self


class PlanResponse(BaseModel):
    """Public representation of subscription plan [PDF 5.2]."""
    id: str
    name: str
    price: Decimal
    billing_period: BillingPeriod
    min_quantity: int
    valid_from: datetime
    valid_to: Optional[datetime] = None

    auto_close: bool
    closable: bool
    pausable: bool
    renewable: bool
    is_active: bool

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
