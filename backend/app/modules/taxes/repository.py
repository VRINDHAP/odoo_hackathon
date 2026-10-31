"""
Database Repository for Taxes [PDF 5.7, 8].
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from app.modules.taxes.models import Tax


class TaxRepository:
    """Encapsulates SQL operations for tax schedules."""

    @staticmethod
    def get_by_id(db: Session, tax_id: str) -> Optional[Tax]:
        return db.query(Tax).filter(Tax.id == tax_id).first()

    @staticmethod
    def list_taxes(
        db: Session,
        skip: int = 0,
        limit: int = 50,
        active_only: bool = True,
    ) -> List[Tax]:
        query = db.query(Tax)
        if active_only:
            query = query.filter(Tax.is_active == True)  # noqa: E712
        return query.order_by(Tax.rate.asc()).offset(skip).limit(limit).all()

    @staticmethod
    def create_tax(db: Session, **kwargs) -> Tax:
        tax = Tax(**kwargs)
        db.add(tax)
        db.commit()
        db.refresh(tax)
        return tax

    @staticmethod
    def update_tax(db: Session, tax: Tax, **kwargs) -> Tax:
        for key, value in kwargs.items():
            if value is not None and hasattr(tax, key):
                setattr(tax, key, value)
        db.commit()
        db.refresh(tax)
        return tax

    @staticmethod
    def soft_delete_tax(db: Session, tax: Tax) -> Tax:
        tax.is_active = False
        db.commit()
        db.refresh(tax)
        return tax
