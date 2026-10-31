"""
Customers REST Router: Profiles, Directory Search, and History [PDF 5.2, 8, 11].
Enforces RBAC:
- Staff & Admin: View directory, search, create profiles, update billing addresses.
- Admin: Soft delete / archival operations.
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user, require_admin, require_staff_or_admin
from app.modules.auth.models import User
from app.modules.customers.models import Customer, CustomerStatus
from app.modules.customers.schemas import (
    CustomerCreateRequest,
    CustomerDetailResponse,
    CustomerPaginatedResponse,
    CustomerResponse,
    CustomerUpdateRequest,
)
from app.modules.customers.service import CustomerService

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.get("", response_model=CustomerPaginatedResponse, summary="List paginated customers")
def list_customers(
    page: int = Query(1, ge=1, description="Page number starting at 1"),
    page_size: int = Query(25, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Search term for name, email, or company"),
    status: Optional[CustomerStatus] = Query(None, description="Filter by active/inactive status"),
    include_deleted: bool = Query(False, description="Include soft-deleted records"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves paginated customer directory with search and status filtering [PDF 8, 11]."""
    return CustomerService.list_customers(
        db=db,
        page=page,
        page_size=page_size,
        search=search,
        status=status,
        include_deleted=include_deleted,
    )


@router.post(
    "",
    response_model=CustomerResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create customer profile",
)
def create_customer(
    payload: CustomerCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Registers a new customer profile with structured billing address and tax ID [PDF 5.2, 8]."""
    client_ip = request.client.host if request.client else None
    return CustomerService.create_customer(
        db=db,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.get("/{customer_id}", response_model=CustomerDetailResponse, summary="Get customer profile & history")
def get_customer(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves customer profile and aggregates relational subscriptions, invoices, and payments [PDF 12.2]."""
    return CustomerService.get_customer_detail(db=db, customer_id=customer_id)


@router.patch("/{customer_id}", response_model=CustomerResponse, summary="Update customer profile")
def update_customer(
    customer_id: str,
    payload: CustomerUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Modifies customer contact info, tax ID, or billing address [PDF 5.2, 9]."""
    client_ip = request.client.host if request.client else None
    return CustomerService.update_customer(
        db=db,
        customer_id=customer_id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.delete("/{customer_id}", response_model=CustomerResponse, summary="Soft delete customer (Admin only)")
def delete_customer(
    customer_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-deletes a customer, preserving historical subscriptions and invoices [PDF 5.2]."""
    client_ip = request.client.host if request.client else None
    return CustomerService.delete_customer(
        db=db,
        customer_id=customer_id,
        current_user=current_user,
        ip=client_ip,
    )


# ============================================================================
# CUSTOMER PORTAL PROFILE (BE-7.2) [PDF 2, 8]
# ============================================================================
portal_router = APIRouter(tags=["Customer Portal"])


def _resolve_portal_customer(db: Session, current_user: User) -> Customer:
    """Finds or initializes the Customer entity for the authenticated portal user."""
    cust = None
    if getattr(current_user, "customer_id", None):
        cust = db.query(Customer).filter(Customer.id == current_user.customer_id, Customer.deleted_at.is_(None)).first()
    if not cust:
        cust = db.query(Customer).filter(Customer.portal_user_id == current_user.id, Customer.deleted_at.is_(None)).first()
    if not cust:
        cust = db.query(Customer).filter(Customer.email == current_user.email, Customer.deleted_at.is_(None)).first()
    if not cust:
        cust = Customer(
            name=current_user.email.split("@")[0].capitalize(),
            email=current_user.email,
            portal_user_id=current_user.id,
            billing_address={"line1": "Default Address", "city": "Bengaluru", "state": "Karnataka", "postal_code": "560001", "country": "India"},
        )
        db.add(cust)
        db.commit()
        db.refresh(cust)
    return cust


@portal_router.get(
    "/me/profile",
    response_model=CustomerResponse,
    summary="Get authenticated customer's own profile [PDF 2, 8]",
)
def get_my_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the authenticated customer's contact and billing profile."""
    cust = _resolve_portal_customer(db, current_user)
    return CustomerResponse.model_validate(cust)


@portal_router.patch(
    "/me/profile",
    response_model=CustomerResponse,
    summary="Customer self-service profile update [PDF 2, 8]",
)
def update_my_profile(
    payload: CustomerUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Self-service endpoint: Customer updates their own billing address and contact details [PDF 2, 8].
    Restricted strictly to the authenticated user's own linked customer entity.
    """
    cust = _resolve_portal_customer(db, current_user)
    client_ip = request.client.host if request.client else None
    return CustomerService.update_customer(
        db=db,
        customer_id=cust.id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )

