"""
Subscriptions API Router [PDF 8, 9, 11].
Owned by Vrindha.

Endpoints:
- POST /api/v1/subscriptions: Create draft/quotation subscription (Admin/Staff)
- GET  /api/v1/subscriptions: List subscriptions with filters (Admin/Staff)
- GET  /api/v1/subscriptions/{id}: Fetch single subscription details (RBAC)
- POST /api/v1/subscriptions/{id}/transition: Execute lifecycle state transition (RBAC)
- GET  /api/v1/me/subscriptions: Customer portal self-service list (Customer)
- POST /api/v1/subscriptions/{id}/pause: Convenience pause endpoint
- POST /api/v1/subscriptions/{id}/resume: Convenience resume endpoint
- POST /api/v1/subscriptions/{id}/close: Convenience close endpoint
- POST /api/v1/subscriptions/{id}/renew: Convenience renew endpoint
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import (
    PaginationParams,
    get_current_user,
    get_db,
    require_staff_or_admin,
)
from app.core.errors import ForbiddenError
from app.modules.auth.models import User, UserRole
from app.modules.subscriptions.models import SubscriptionStatus
from app.modules.subscriptions.schemas import (
    SubscriptionCloseRequest,
    SubscriptionCreate,
    SubscriptionDetailResponse,
    SubscriptionPauseRequest,
    SubscriptionRenewRequest,
    SubscriptionResponse,
    SubscriptionResumeRequest,
    SubscriptionTransitionRequest,
)
from app.modules.subscriptions.service import SubscriptionService

router = APIRouter(tags=["Subscriptions"])


# ============================================================================
# SUBSCRIPTION MANAGEMENT (ADMIN & INTERNAL STAFF)
# ============================================================================

@router.post(
    "/subscriptions",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new draft or quotation subscription [PDF 8]",
)
def create_subscription(
    request: SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> SubscriptionResponse:
    """
    Creates a new subscription:
    - Generates sequential number (SUB-YYYY-000001).
    - Snapshots line items, prices, and tax rates.
    - Sets anchor_day derived from start_date.
    - Accessible strictly by Admin and Internal Staff.
    """
    sub = SubscriptionService.create_subscription(
        db=db,
        request=request,
        creator_id=current_user.id,
    )
    return sub


@router.get(
    "/subscriptions",
    response_model=List[SubscriptionResponse],
    status_code=status.HTTP_200_OK,
    summary="List subscriptions with filters and pagination [PDF 8, 11]",
)
def list_subscriptions(
    response: Response,
    status: Optional[str] = Query(None, description="Filter by subscription lifecycle state"),
    customer_id: Optional[str] = Query(None, description="Filter by customer ID"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> List[SubscriptionResponse]:
    """
    Lists subscriptions with optional filters:
    - Status and customer_id filters.
    - Standard pagination (skip, limit).
    - Returns total count in 'X-Total-Count' response header.
    - Accessible strictly by Admin and Internal Staff.
    """
    filter_status = None
    if status is not None and not hasattr(status, "default"):
        filter_status = SubscriptionStatus.from_str(status) if isinstance(status, str) else status

    filter_customer = customer_id if customer_id and not hasattr(customer_id, "default") else None

    results, total_count = SubscriptionService.list_subscriptions(
        db=db,
        status=filter_status,
        customer_id=filter_customer,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    response.headers["X-Total-Count"] = str(total_count)
    return results


@router.get(
    "/subscriptions/{id}",
    response_model=SubscriptionDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get single subscription details [PDF 8]",
)
def get_subscription(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionDetailResponse:
    """
    Retrieves full subscription details with snapshotted line items:
    - Admin & Staff: Full access across all subscriptions.
    - Customer: Object-level guard ensures access strictly to own subscriptions [PDF 2].
    """
    customer_filter = current_user.customer_id if current_user.role == UserRole.CUSTOMER else None
    sub = SubscriptionService.get_subscription(
        subscription_id=id,
        db=db,
        customer_id=customer_filter,
    )
    return sub


# ============================================================================
# STATE TRANSITIONS (STATE MACHINE) [PDF 6.1, 8]
# ============================================================================

@router.post(
    "/subscriptions/{id}/transition",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_200_OK,
    summary="Dispatch lifecycle state transition [PDF 6.1, 8]",
)
def transition_subscription_state(
    id: str,
    request: SubscriptionTransitionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    """
    Executes a validated state machine transition:
    - Target states: 'quotation', 'confirmed', 'active', 'paused', 'closed', 'cancelled'.
    - Validates transition guards (expiry dates, plan flags, min quantity).
    - Customers can only accept quotations (Quotation -> Confirmed) or cancel.
    - Rejects illegal transitions with HTTP 409 Conflict.
    - Writes immutable audit log record.
    """
    # Customer RBAC guard: customer can only confirm own quotation or cancel before active
    if current_user.role == UserRole.CUSTOMER:
        sub = SubscriptionService.get_subscription(id, db, customer_id=current_user.customer_id)
        if request.target not in (SubscriptionStatus.CONFIRMED, SubscriptionStatus.CANCELLED):
            raise ForbiddenError("Customers may only confirm quotations or cancel pending subscriptions.")

    updated_sub = SubscriptionService.transition_state(
        subscription_id=id,
        target_state=request.target,
        user_role=current_user.role,
        db=db,
        reason=request.reason,
        user_id=current_user.id,
    )
    return updated_sub


@router.post(
    "/subscriptions/{id}/pause",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_200_OK,
    summary="Pause active subscription [PDF 6.1, 8]",
)
def pause_subscription(
    id: str,
    request: Optional[SubscriptionPauseRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> SubscriptionResponse:
    """Convenience endpoint to pause an active subscription. Requires plan.pausable == True."""
    reason = request.reason if request else "Paused via management console"
    return SubscriptionService.transition_state(
        subscription_id=id,
        target_state=SubscriptionStatus.PAUSED,
        user_role=current_user.role,
        db=db,
        reason=reason,
        user_id=current_user.id,
    )


@router.post(
    "/subscriptions/{id}/resume",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_200_OK,
    summary="Resume paused subscription [PDF 6.1, 8]",
)
def resume_subscription(
    id: str,
    request: Optional[SubscriptionResumeRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> SubscriptionResponse:
    """Convenience endpoint to resume a paused subscription. Recalculates next_billing_date."""
    notes = request.notes if request else "Resumed via management console"
    return SubscriptionService.transition_state(
        subscription_id=id,
        target_state=SubscriptionStatus.ACTIVE,
        user_role=current_user.role,
        db=db,
        reason=notes,
        user_id=current_user.id,
    )


@router.post(
    "/subscriptions/{id}/close",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_200_OK,
    summary="Close subscription with mandatory reason [PDF 5.6, 6.1, 8]",
)
def close_subscription(
    id: str,
    request: SubscriptionCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> SubscriptionResponse:
    """Convenience endpoint to close an active subscription. Requires close_reason and plan.closable == True."""
    return SubscriptionService.transition_state(
        subscription_id=id,
        target_state=SubscriptionStatus.CLOSED,
        user_role=current_user.role,
        db=db,
        reason=request.close_reason,
        user_id=current_user.id,
    )


@router.post(
    "/subscriptions/{id}/renew",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_200_OK,
    summary="Renew closed subscription [PDF 6.1, 8]",
)
def renew_subscription(
    id: str,
    request: Optional[SubscriptionRenewRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> SubscriptionResponse:
    """Convenience endpoint to renew a closed subscription. Requires plan.renewable == True."""
    return SubscriptionService.transition_state(
        subscription_id=id,
        target_state=SubscriptionStatus.ACTIVE,
        user_role=current_user.role,
        db=db,
        reason="Renewed subscription term",
        user_id=current_user.id,
    )


# ============================================================================
# CUSTOMER PORTAL SELF-SERVICE [PDF 2, 8, 9]
# ============================================================================

@router.get(
    "/me/subscriptions",
    response_model=List[SubscriptionResponse],
    status_code=status.HTTP_200_OK,
    summary="Get authenticated customer's subscriptions [PDF 2, 8, 9]",
)
def get_my_subscriptions(
    response: Response,
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[SubscriptionResponse]:
    """
    Customer portal endpoint:
    - Enforces Layer 2 and Layer 3 RBAC query filtering [PDF 2].
    - Returns strictly the subscriptions belonging to authenticated user's customer_id.
    """
    if not current_user.customer_id:
        response.headers["X-Total-Count"] = "0"
        return []

    results, total_count = SubscriptionService.list_subscriptions(
        db=db,
        customer_id=current_user.customer_id,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    response.headers["X-Total-Count"] = str(total_count)
    return results
