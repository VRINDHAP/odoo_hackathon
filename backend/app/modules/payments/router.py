"""
Payments API Router [PDF 5.9, 7.2, 8, 9].
Owned by Vrindha.

Endpoints:
- POST /api/v1/invoices/{id}/payments: Record payment against an invoice (Admin & Internal Staff).
- POST /api/v1/payments/{id}/reverse: Reverse a previous payment (Admin only).
- GET  /api/v1/payments: List payments with query filters (Admin & Internal Staff).
- POST /api/v1/me/invoices/{id}/pay: Customer self-service payment for their own invoice.
"""
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.deps import (
    PaginationParams,
    get_current_user,
    get_db,
    require_admin,
    require_staff_or_admin,
)
from app.core.errors import ForbiddenError, NotFoundError
from app.modules.auth.models import User, UserRole
from app.modules.invoices.models import Invoice
from app.modules.payments.models import PaymentMethod, PaymentStatus
from app.modules.payments.schemas import (
    PaymentCreate,
    PaymentListResponse,
    PaymentResponse,
    PaymentReversalCreate,
)
from app.modules.payments.service import PaymentService

router = APIRouter(tags=["Payments"])


# ============================================================================
# INTERNAL / STAFF PAYMENT OPERATIONS
# ============================================================================

@router.post(
    "/invoices/{id}/payments",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record Payment Against Invoice",
    description="Records a new payment settlement against an invoice and updates outstanding balance.",
)
def record_invoice_payment(
    id: str,
    payment_in: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> PaymentResponse:
    """Record payment settlement against an invoice (Admin & Staff)."""
    payment = PaymentService.record_payment(
        payment_in=payment_in,
        actor_user=current_user,
        db=db,
        invoice_id=id,
    )
    return PaymentResponse.model_validate(payment)


@router.post(
    "/payments/{id}/reverse",
    response_model=PaymentResponse,
    status_code=status.HTTP_200_OK,
    summary="Reverse Payment",
    description="Executes an append-only reversal of a previously recorded payment (Admin only).",
)
def reverse_payment(
    id: str,
    reversal_in: PaymentReversalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> PaymentResponse:
    """Admin-only reversal of a recorded payment."""
    payment = PaymentService.reverse_payment(
        payment_id=id,
        reversal_in=reversal_in,
        actor_user=current_user,
        db=db,
    )
    return PaymentResponse.model_validate(payment)


@router.get(
    "/payments",
    response_model=PaymentListResponse,
    summary="List Payments",
    description="List payment transactions with filters and pagination (Admin & Staff).",
)
def list_payments(
    invoice_id: Optional[str] = Query(None, description="Filter by invoice ID"),
    method: Optional[PaymentMethod] = Query(None, description="Filter by payment method"),
    status: Optional[PaymentStatus] = Query(None, description="Filter by payment status"),
    start_date: Optional[date] = Query(None, description="Filter payments on or after date"),
    end_date: Optional[date] = Query(None, description="Filter payments on or before date"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> PaymentListResponse:
    """List payments with query filters and pagination."""
    items, total = PaymentService.list_payments(
        invoice_id=invoice_id,
        method=method,
        status=status,
        start_date=start_date,
        end_date=end_date,
        skip=pagination.skip,
        limit=pagination.limit,
        db=db,
    )
    total_pages = (total + pagination.limit - 1) // pagination.limit if total > 0 else 1
    return PaymentListResponse(
        items=[PaymentResponse.model_validate(p) for p in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        total_pages=total_pages,
    )


# ============================================================================
# CUSTOMER PORTAL SELF-SERVICE PAYMENT
# ============================================================================

@router.post(
    "/me/invoices/{id}/pay",
    response_model=PaymentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Customer Self-Service Invoice Payment",
    description="Allows authenticated customers to submit payment for their own invoices with customer isolation.",
)
def customer_pay_invoice(
    id: str,
    payment_in: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaymentResponse:
    """Self-service endpoint for customers to pay their invoices."""
    invoice = db.query(Invoice).filter(Invoice.id == id).first()
    if not invoice:
        raise NotFoundError("Invoice", id)

    # Enforce strict customer isolation
    if current_user.role == UserRole.CUSTOMER:
        if not current_user.customer_id or current_user.customer_id != invoice.customer_id:
            raise ForbiddenError("You are not authorized to pay an invoice belonging to another customer.")

    payment = PaymentService.record_payment(
        payment_in=payment_in,
        actor_user=current_user,
        db=db,
        invoice_id=id,
    )
    return PaymentResponse.model_validate(payment)

