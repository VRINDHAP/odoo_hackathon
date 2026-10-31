"""
Pydantic v2 Validation Schemas for Customer Profiles and Pagination [PDF 5.2, 8].
"""
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.customers.models import CustomerStatus

EMAIL_REGEX = re.compile(r"^[\w\.-]+@[\w\.-]+\.\w+$")


class BillingAddressSchema(BaseModel):
    """Structured postal and tax jurisdiction address [PDF 5.2]."""
    line1: str = Field(..., min_length=1, max_length=255, description="Street address")
    line2: Optional[str] = Field(None, max_length=255, description="Apartment/suite")
    city: str = Field(..., min_length=1, max_length=100)
    state: str = Field(..., min_length=1, max_length=100)
    postal_code: str = Field(..., min_length=1, max_length=20)
    country: str = Field(default="India", max_length=100)


class CustomerCreateRequest(BaseModel):
    """Payload to register a new customer profile [PDF 5.2, 8]."""
    name: str = Field(..., min_length=1, max_length=255, description="Primary contact name")
    company_name: Optional[str] = Field(None, max_length=255, description="Corporate entity name")
    email: str = Field(..., min_length=3, max_length=255, description="Billing contact email")
    phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=50, description="GSTIN / VAT identifier")
    billing_address: Optional[BillingAddressSchema] = None
    payment_terms: Optional[str] = Field(default="Immediate", max_length=50)
    portal_user_id: Optional[str] = None

    @field_validator("email")
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if not EMAIL_REGEX.match(clean):
            raise ValueError("Invalid email format.")
        return clean


class CustomerUpdateRequest(BaseModel):
    """Payload to update an existing customer profile [PDF 5.2]."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    company_name: Optional[str] = Field(None, max_length=255)
    email: Optional[str] = Field(None, min_length=3, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=50)
    billing_address: Optional[BillingAddressSchema] = None
    payment_terms: Optional[str] = Field(None, max_length=50)
    status: Optional[CustomerStatus] = None
    deleted_at: Optional[datetime] = None

    @field_validator("email")
    def validate_email_format(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            clean = v.strip().lower()
            if not EMAIL_REGEX.match(clean):
                raise ValueError("Invalid email format.")
            return clean
        return v


class CustomerResponse(BaseModel):
    """Public customer profile representation [PDF 5.2]."""
    id: str
    name: str
    company_name: Optional[str] = None
    email: str
    phone: Optional[str] = None
    tax_id: Optional[str] = None
    billing_address: Optional[Dict[str, Any]] = None
    payment_terms: Optional[str] = None
    status: CustomerStatus
    portal_user_linked: bool = False
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerPaginatedResponse(BaseModel):
    """Paginated customer directory response [PDF 11]."""
    items: List[CustomerResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CustomerDetailResponse(BaseModel):
    """Customer profile and relational history [PDF 12.2]."""
    customer: CustomerResponse
    subscriptions: List[Dict[str, Any]] = []
    invoices: List[Dict[str, Any]] = []
    payments: List[Dict[str, Any]] = []
