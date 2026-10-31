"""
Pydantic Schemas for Quotation Templates [PDF 5.5, 8].
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class QuotationTemplateLineCreate(BaseModel):
    """Payload to add a line item to a quotation template."""
    product_id: str = Field(..., description="Foreign key to catalog product")
    variant_id: Optional[str] = Field(None, description="Optional variant ID")
    quantity: int = Field(1, ge=1, description="Default quantity (must be >= 1)")
    unit_price: Decimal = Field(
        Decimal("0.00"),
        ge=Decimal("0.00"),
        decimal_places=2,
        description="Agreed unit price for this template line",
    )


class QuotationTemplateLineResponse(BaseModel):
    """Line item serialized response."""
    id: str
    template_id: str
    product_id: str
    variant_id: Optional[str] = None
    quantity: int
    unit_price: Decimal

    @property
    def subtotal(self) -> Decimal:
        return Decimal(str(self.quantity)) * Decimal(str(self.unit_price))

    model_config = ConfigDict(from_attributes=True)


class QuotationTemplateCreate(BaseModel):
    """Payload to create a new quotation template."""
    name: str = Field(..., min_length=1, max_length=255, description="Template title")
    validity_days: int = Field(30, ge=1, le=365, description="Quotation validity window in days")
    plan_id: str = Field(..., description="Foreign key to recurring subscription plan")
    notes: Optional[str] = Field(None, description="Internal or customer notes")
    lines: List[QuotationTemplateLineCreate] = Field(
        default_factory=list,
        description="Bundle line items to automatically snapshot",
    )


class QuotationTemplateUpdate(BaseModel):
    """Payload to update an existing quotation template."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    validity_days: Optional[int] = Field(None, ge=1, le=365)
    plan_id: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[List[QuotationTemplateLineCreate]] = None


class QuotationTemplateResponse(BaseModel):
    """Quotation template serialized representation."""
    id: str
    name: str
    validity_days: int
    plan_id: str
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    lines: List[QuotationTemplateLineResponse] = []

    model_config = ConfigDict(from_attributes=True)


class CreateQuotationRequest(BaseModel):
    """Request payload to generate a draft subscription from a template."""
    customer_id: str = Field(..., description="Target customer ID for quotation")
