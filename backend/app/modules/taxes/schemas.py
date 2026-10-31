"""
Pydantic v2 Validation Schemas for Tax Rules and Mathematical Breakdown [PDF 5.7, 7.1, 8].
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.taxes.models import TaxAppliesTo, TaxType


class TaxCreateRequest(BaseModel):
    """Payload to register a new tax schedule [PDF 5.7, 8]."""
    name: str = Field(..., min_length=1, max_length=100, description="Schedule name e.g. 'GST 18%'")
    type: TaxType = Field(default=TaxType.PERCENT, description="Calculation mode: percent | fixed")
    rate: Decimal = Field(..., ge=0, description="Tax rate percentage or fixed amount (NUMERIC(14,4))")
    inclusive: bool = Field(default=False, description="True = Inclusive (embedded in price), False = Exclusive")
    applies_to: TaxAppliesTo = Field(default=TaxAppliesTo.ALL, description="Scope: all | product | category")
    is_active: bool = Field(default=True, description="Active status")

    @model_validator(mode="after")
    def validate_rate_bounds(self):
        if self.type == TaxType.PERCENT and self.rate > Decimal("100.0"):
            raise ValueError("Percentage tax rate cannot exceed 100%.")
        return self


class TaxUpdateRequest(BaseModel):
    """Payload to update an existing tax schedule [PDF 5.7]."""
    id: Optional[str] = Field(None, description="Optional ID passed in payload body")
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    type: Optional[TaxType] = None
    rate: Optional[Decimal] = Field(None, ge=0)
    inclusive: Optional[bool] = None
    applies_to: Optional[TaxAppliesTo] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def validate_rate_bounds(self):
        if self.type == TaxType.PERCENT and self.rate is not None and self.rate > Decimal("100.0"):
            raise ValueError("Percentage tax rate cannot exceed 100%.")
        return self


class TaxResponse(BaseModel):
    """Public representation of tax rule [PDF 5.7]."""
    id: str
    name: str
    type: TaxType
    rate: Decimal
    inclusive: bool
    applies_to: TaxAppliesTo
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaxCalculateRequest(BaseModel):
    """Payload to compute exact tax for a line item [PDF 7.1]."""
    tax_id: Optional[str] = Field(None, description="Tax rule ID (omit for 0% tax)")
    amount: Decimal = Field(..., gt=0, description="Gross base amount to calculate tax against")


class TaxCalculateResponse(BaseModel):
    """Exact computed tax breakdown and totals [PDF 7.1]."""
    tax_id: Optional[str] = None
    name: str
    rate: Decimal
    inclusive: bool
    taxable_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
