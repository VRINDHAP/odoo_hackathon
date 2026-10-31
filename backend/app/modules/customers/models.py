"""
Customers Domain Model [PDF 5.2, 8].
Matches database/alembic migration af132f0d3d05_create_customers_table.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import Column, DateTime, JSON, String
from app.core.db import Base


class Customer(Base):
    """
    Customer entity for billing and contracts [PDF 5.2].
    """
    __tablename__ = "customers"
    __allow_unmapped__ = True

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), nullable=True)
    company_name = Column(String(255), nullable=True)
    tax_id = Column(String(50), nullable=True)
    billing_address = Column(JSON, nullable=False)
    status = Column(String(50), default="active", nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = {"extend_existing": True}

    def __repr__(self) -> str:
        return f"<Customer id={self.id} name='{self.name}' email='{self.email}'>"

