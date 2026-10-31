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
from app.core.deps import require_admin, require_staff_or_admin
from app.modules.auth.models import User
from app.modules.customers.models import CustomerStatus
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
