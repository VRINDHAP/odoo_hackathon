"""
Plans REST Router: Recurring Subscription Plans and Behavior Flags [PDF 5.2, 8, 11].
Enforces RBAC:
- Public/Staff/Customer: Plan browsing and inspection.
- Admin: Full CRUD, interval configuration, and behavior flag toggling.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import PaginationParams, require_admin
from app.modules.auth.models import User
from app.modules.plans.models import BillingPeriod
from app.modules.plans.schemas import PlanCreateRequest, PlanResponse, PlanUpdateRequest
from app.modules.plans.service import PlanService

router = APIRouter(prefix="/plans", tags=["Plans"])


@router.get("", response_model=List[PlanResponse], summary="List subscription plans")
def list_plans(
    active_only: bool = Query(True, description="Filter for active plans only"),
    billing_period: Optional[BillingPeriod] = Query(None, description="Filter by interval cadence"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
):
    """Retrieves subscription plans [PDF 5.2, 8]."""
    return PlanService.list_plans(
        db=db,
        skip=pagination.skip,
        limit=pagination.limit,
        active_only=active_only,
        billing_period=billing_period,
    )


@router.post(
    "",
    response_model=PlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create subscription plan (Admin only)",
)
def create_plan(
    payload: PlanCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Registers a new plan with recurrence cadence and behavior flags [PDF 5.2, 8]."""
    client_ip = request.client.host if request.client else None
    return PlanService.create_plan(
        db=db,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.get("/{plan_id}", response_model=PlanResponse, summary="Get plan details")
def get_plan(
    plan_id: str,
    db: Session = Depends(get_db),
):
    """Retrieves plan details and behavior flags by ID."""
    return PlanService.get_plan(db=db, plan_id=plan_id)


@router.patch("/{plan_id}", response_model=PlanResponse, summary="Update plan or behavior flags (Admin only)")
def update_plan(
    plan_id: str,
    payload: PlanUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Updates plan attributes, prices, or behavior flags [PDF 5.2, 9]."""
    client_ip = request.client.host if request.client else None
    return PlanService.update_plan(
        db=db,
        plan_id=plan_id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.delete("/{plan_id}", response_model=PlanResponse, summary="Soft delete plan (Admin only)")
def delete_plan(
    plan_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-deletes a plan, disabling it from new subscriptions."""
    client_ip = request.client.host if request.client else None
    return PlanService.delete_plan(
        db=db,
        plan_id=plan_id,
        current_user=current_user,
        ip=client_ip,
    )
