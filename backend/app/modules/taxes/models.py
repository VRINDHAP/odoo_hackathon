"""
Taxes Domain Models: Tax Rules and Inclusion Configuration [PDF 5.7, 7.1, 8].
"""
import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Numeric,
    String,
)
from app.core.db import Base


class TaxType(str, enum.Enum):
    """Tax calculation mode [PDF 5.7]."""
    PERCENT = "percent"
    FIXED = "fixed"


class TaxAppliesTo(str, enum.Enum):
    """Tax applicability scope [PDF 5.7]."""
    ALL = "all"
    PRODUCT = "product"
    CATEGORY = "category"


class Tax(Base):
    """
    Tax Rule entity [PDF 5.7, 7.1].
    Supports percentage-based and fixed-amount calculations
    in both tax-exclusive and tax-inclusive regimes.
    """
    __tablename__ = "taxes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False, index=True)
    type = Column(
        Enum(TaxType, values_callable=lambda x: [e.value for e in x]),
        default=TaxType.PERCENT,
        nullable=False,
    )
    rate = Column(Numeric(14, 4), default=0.0000, nullable=False)
    inclusive = Column(Boolean, default=False, nullable=False)
    applies_to = Column(
        Enum(TaxAppliesTo, values_callable=lambda x: [e.value for e in x]),
        default=TaxAppliesTo.ALL,
        nullable=False,
    )
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = {"extend_existing": True}

    def __repr__(self):
        mode = "Inclusive" if self.inclusive else "Exclusive"
        return f"<Tax id={self.id} name='{self.name}' rate={self.rate}% mode={mode}>"
