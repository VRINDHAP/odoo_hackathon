"""
Customers Domain Model [PDF 5.2, 8].
Matches database/alembic migration af132f0d3d05_create_customers_table.py.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    DateTime,
    JSON,
    String,
)
from app.core.db import Base


class CustomerStatus(str, enum.Enum):
    """Customer account lifecycle status [PDF 5.2]."""
    ACTIVE = "active"
    INACTIVE = "inactive"


class Customer(Base):
    """
    Customer entity for billing and contracts [PDF 5.2].
    Holds corporate & individual contact details, GSTIN/VAT tax ID,
    structured billing address, and portal user link.
    Supports soft deletion via deleted_at timestamp.
    """
    __tablename__ = "customers"
    __allow_unmapped__ = True

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), nullable=True)
    company_name = Column(String(255), nullable=True, index=True)
    tax_id = Column(String(50), nullable=True)
    billing_address = Column(JSON, default=dict, nullable=False)
    status = Column(String(50), default="active", nullable=False)
    payment_terms = Column(String(50), default="Immediate", nullable=True)
    portal_user_id = Column(String(36), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = {"extend_existing": True}

    @property
    def portal_user_linked(self) -> bool:
        return bool(self.portal_user_id)

    def __repr__(self) -> str:
        return f"<Customer id={self.id} name='{self.name}' company='{self.company_name}' status={self.status}>"
