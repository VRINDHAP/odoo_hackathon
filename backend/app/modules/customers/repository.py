"""
Database Repository for Customers [PDF 5.2, 8].
"""
from datetime import datetime
from typing import List, Optional, Tuple
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.modules.customers.models import Customer, CustomerStatus


class CustomerRepository:
    """Encapsulates SQL operations for customer records."""

    @staticmethod
    def get_by_id(db: Session, customer_id: str) -> Optional[Customer]:
        return db.query(Customer).filter(Customer.id == customer_id).first()

    @staticmethod
    def get_by_email(db: Session, email: str) -> Optional[Customer]:
        return db.query(Customer).filter(Customer.email == email.strip().lower()).first()

    @staticmethod
    def list_customers(
        db: Session,
        skip: int = 0,
        limit: int = 25,
        search: Optional[str] = None,
        status: Optional[CustomerStatus] = None,
        include_deleted: bool = False,
    ) -> Tuple[List[Customer], int]:
        query = db.query(Customer)

        if not include_deleted:
            query = query.filter(Customer.deleted_at == None)  # noqa: E711

        if status:
            query = query.filter(Customer.status == status)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    Customer.name.ilike(term),
                    Customer.email.ilike(term),
                    Customer.company_name.ilike(term),
                )
            )

        total = query.count()
        items = query.order_by(Customer.created_at.desc()).offset(skip).limit(limit).all()
        return items, total

    @staticmethod
    def create_customer(db: Session, **kwargs) -> Customer:
        customer = Customer(**kwargs)
        db.add(customer)
        db.commit()
        db.refresh(customer)
        return customer

    @staticmethod
    def update_customer(db: Session, customer: Customer, **kwargs) -> Customer:
        for key, value in kwargs.items():
            if value is not None and hasattr(customer, key):
                setattr(customer, key, value)
        db.commit()
        db.refresh(customer)
        return customer

    @staticmethod
    def soft_delete_customer(db: Session, customer: Customer) -> Customer:
        customer.deleted_at = datetime.utcnow()
        customer.status = CustomerStatus.INACTIVE
        db.commit()
        db.refresh(customer)
        return customer
