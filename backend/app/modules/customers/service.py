"""
Customer Business Logic Service [PDF 5.2, 8, 9, 12.2].
Orchestrates customer profiles, soft deletion, relational detail aggregations,
and audit trail recording.
"""
import logging
import math
from typing import Any, Dict, List, Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import Base
from app.core.errors import ConflictError, NotFoundError
from app.modules.audit.service import AuditService
from app.modules.auth.models import User
from app.modules.customers.models import Customer, CustomerStatus
from app.modules.customers.repository import CustomerRepository
from app.modules.customers.schemas import (
    CustomerCreateRequest,
    CustomerDetailResponse,
    CustomerPaginatedResponse,
    CustomerResponse,
    CustomerUpdateRequest,
)

logger = logging.getLogger(__name__)


class CustomerService:
    """Orchestrates customer directory, profile updates, and relational history."""

    @staticmethod
    def list_customers(
        db: Session,
        page: int = 1,
        page_size: int = 25,
        search: Optional[str] = None,
        status: Optional[CustomerStatus] = None,
        include_deleted: bool = False,
    ) -> CustomerPaginatedResponse:
        """Retrieves paginated customer directory with search and status filtering."""
        skip = (page - 1) * page_size
        items, total = CustomerRepository.list_customers(
            db=db,
            skip=skip,
            limit=page_size,
            search=search,
            status=status,
            include_deleted=include_deleted,
        )
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        return CustomerPaginatedResponse(
            items=[CustomerResponse.model_validate(c) for c in items],
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    @staticmethod
    def get_customer(db: Session, customer_id: str) -> CustomerResponse:
        """Retrieves a single customer profile or raises 404."""
        customer = CustomerRepository.get_by_id(db, customer_id)
        if not customer:
            raise NotFoundError("Customer", customer_id)
        return CustomerResponse.model_validate(customer)

    @classmethod
    def get_customer_detail(cls, db: Session, customer_id: str) -> CustomerDetailResponse:
        """
        Aggregates customer profile with relational history [PDF 12.2]:
        Attached subscriptions, historic invoices, and payment receipts.
        """
        customer = CustomerRepository.get_by_id(db, customer_id)
        if not customer:
            raise NotFoundError("Customer", customer_id)

        subscriptions: List[Dict[str, Any]] = []
        invoices: List[Dict[str, Any]] = []
        payments: List[Dict[str, Any]] = []

        # Gracefully query related tables if registered in metadata
        try:
            if "subscriptions" in Base.metadata.tables:
                sub_rows = db.execute(
                    text(
                        "SELECT id, subscription_number, status, start_date, "
                        "next_billing_date, total_amount, currency "
                        "FROM subscriptions WHERE customer_id = :cid ORDER BY created_at DESC"
                    ),
                    {"cid": customer_id},
                ).mappings().all()
                subscriptions = [dict(r) for r in sub_rows]
        except Exception as exc:
            logger.debug(f"Subscription history aggregation fallback: {exc}")

        try:
            if "invoices" in Base.metadata.tables:
                inv_rows = db.execute(
                    text(
                        "SELECT id, invoice_number, status, total_amount, balance, due_date "
                        "FROM invoices WHERE customer_id = :cid ORDER BY created_at DESC"
                    ),
                    {"cid": customer_id},
                ).mappings().all()
                invoices = [dict(r) for r in inv_rows]
        except Exception as exc:
            logger.debug(f"Invoice history aggregation fallback: {exc}")

        try:
            if "payments" in Base.metadata.tables:
                pay_rows = db.execute(
                    text(
                        "SELECT id, payment_number, amount, status, method, transaction_reference, created_at "
                        "FROM payments WHERE customer_id = :cid ORDER BY created_at DESC"
                    ),
                    {"cid": customer_id},
                ).mappings().all()
                payments = [dict(r) for r in pay_rows]
        except Exception as exc:
            logger.debug(f"Payment history aggregation fallback: {exc}")

        return CustomerDetailResponse(
            customer=CustomerResponse.model_validate(customer),
            subscriptions=subscriptions,
            invoices=invoices,
            payments=payments,
        )

    @staticmethod
    def create_customer(
        db: Session,
        data: CustomerCreateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> CustomerResponse:
        """Registers a new customer profile and logs to audit trail [PDF 5.2, 9]."""
        existing = CustomerRepository.get_by_email(db, data.email)
        if existing:
            raise ConflictError(f"Customer with email '{data.email}' already exists.")

        billing_dict = data.billing_address.model_dump() if data.billing_address else None

        customer = CustomerRepository.create_customer(
            db=db,
            name=data.name.strip(),
            company_name=data.company_name.strip() if data.company_name else None,
            email=data.email.strip().lower(),
            phone=data.phone.strip() if data.phone else None,
            tax_id=data.tax_id.strip() if data.tax_id else None,
            billing_address=billing_dict,
            payment_terms=data.payment_terms,
            portal_user_id=data.portal_user_id,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="customer",
            entity_id=customer.id,
            action="CREATE",
            after_json={
                "name": customer.name,
                "company_name": customer.company_name,
                "email": customer.email,
                "tax_id": customer.tax_id,
            },
            ip=ip,
        )

        return CustomerResponse.model_validate(customer)

    @staticmethod
    def update_customer(
        db: Session,
        customer_id: str,
        data: CustomerUpdateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> CustomerResponse:
        """Modifies customer profile details or status with audit tracking."""
        customer = CustomerRepository.get_by_id(db, customer_id)
        if not customer:
            raise NotFoundError("Customer", customer_id)

        if data.email and data.email.strip().lower() != customer.email.lower():
            existing = CustomerRepository.get_by_email(db, data.email)
            if existing and existing.id != customer.id:
                raise ConflictError(f"Email '{data.email}' is already associated with another customer.")

        before_state = {
            "name": customer.name,
            "company_name": customer.company_name,
            "email": customer.email,
            "phone": customer.phone,
            "tax_id": customer.tax_id,
            "status": customer.status.value if hasattr(customer.status, "value") else str(customer.status),
        }

        update_kwargs = {}
        if data.name is not None:
            update_kwargs["name"] = data.name.strip()
        if data.company_name is not None:
            update_kwargs["company_name"] = data.company_name.strip()
        if data.email is not None:
            update_kwargs["email"] = data.email.strip().lower()
        if data.phone is not None:
            update_kwargs["phone"] = data.phone.strip()
        if data.tax_id is not None:
            update_kwargs["tax_id"] = data.tax_id.strip()
        if data.billing_address is not None:
            update_kwargs["billing_address"] = data.billing_address.model_dump()
        if data.payment_terms is not None:
            update_kwargs["payment_terms"] = data.payment_terms
        if data.status is not None:
            update_kwargs["status"] = data.status
        if data.deleted_at is not None:
            update_kwargs["deleted_at"] = data.deleted_at

        updated = CustomerRepository.update_customer(db=db, customer=customer, **update_kwargs)

        after_state = {
            "name": updated.name,
            "company_name": updated.company_name,
            "email": updated.email,
            "phone": updated.phone,
            "tax_id": updated.tax_id,
            "status": updated.status.value if hasattr(updated.status, "value") else str(updated.status),
        }

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="customer",
            entity_id=updated.id,
            action="UPDATE",
            before_json=before_state,
            after_json=after_state,
            ip=ip,
        )

        return CustomerResponse.model_validate(updated)

    @staticmethod
    def delete_customer(
        db: Session,
        customer_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> CustomerResponse:
        """Soft-deletes customer profile preserving historic subscriptions & invoices [PDF 5.2]."""
        customer = CustomerRepository.get_by_id(db, customer_id)
        if not customer:
            raise NotFoundError("Customer", customer_id)

        soft_deleted = CustomerRepository.soft_delete_customer(db, customer)

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="customer",
            entity_id=soft_deleted.id,
            action="SOFT_DELETE",
            after_json={"deleted_at": soft_deleted.deleted_at.isoformat(), "status": "inactive"},
            ip=ip,
        )

        return CustomerResponse.model_validate(soft_deleted)
