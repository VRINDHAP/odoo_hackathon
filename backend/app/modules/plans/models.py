"""
Plans Domain Models: Recurring Subscription Plans and Behavior Flags [PDF 5.2, 8].
"""
import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Integer,
    Numeric,
    String,
    Text,
)
from app.core.db import Base


class BillingPeriod(str, enum.Enum):
    """Recurring billing cadence [PDF 5.2, 6.2]."""
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class Plan(Base):
    """
    Subscription Plan entity with behavioral flags [PDF 5.2, 5.4, 8].
    Governs billing recurrence, auto-closure, customer cancellation,
    pause actions, and renewal permissions.
    """
    __tablename__ = "plans"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    price = Column(Numeric(14, 2), default=0.00, nullable=False)
    billing_period = Column(
        Enum(BillingPeriod, values_callable=lambda x: [e.value for e in x]),
        default=BillingPeriod.MONTHLY,
        nullable=False,
    )
    min_quantity = Column(Integer, default=1, nullable=False)
    valid_from = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    valid_to = Column(DateTime(timezone=True), nullable=True)

    # Behavior flags [PDF 5.2]
    auto_close = Column(Boolean, default=False, nullable=False)
    closable = Column(Boolean, default=True, nullable=False)
    pausable = Column(Boolean, default=True, nullable=False)
    renewable = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = {"extend_existing": True}

    def __repr__(self):
        return f"<Plan id={self.id} name='{self.name}' period={self.billing_period} price={self.price}>"
