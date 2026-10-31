"""
Billing API Router (/api/v1/billing) [PDF 7.2, 8].
Owned by Vrindha.

Endpoints:
- POST /api/v1/billing/run: Manually trigger an automated billing cycle (Admin only)
- GET  /api/v1/billing/runs: List historical billing runs and telemetry (Admin & Staff)
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import (
    PaginationParams,
    get_db,
    require_admin,
    require_staff_or_admin,
)
from app.modules.auth.models import User
from app.modules.billing.engine import BillingEngine
from app.modules.billing.models import BillingRun
from app.modules.billing.schemas import (
    BillingRunResponse,
    BillingRunTriggerRequest,
)

router = APIRouter(prefix="/billing", tags=["Billing Engine"])


@router.post(
    "/run",
    response_model=BillingRunResponse,
    status_code=status.HTTP_200_OK,
    summary="Trigger recurring billing run (Admin only) [PDF 7.2, 8]",
)
def trigger_billing_run(
    request: Optional[BillingRunTriggerRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> BillingRunResponse:
    """
    Executes an automated billing cycle:
    - Finds active subscriptions due on or before target_date.
    - Idempotently creates invoices avoiding duplicate periods.
    - Evaluates and redeems discounts atomically.
    - Updates next_billing_date and checks plan expiry auto-close.
    - Accessible strictly by Admin.
    """
    target_d = request.target_date if request else None
    batch = request.batch_size if request else 100

    result = BillingEngine.run_billing(
        target_date=target_d,
        batch_size=batch,
        db=db,
    )
    return BillingRunResponse.model_validate(result)


@router.get(
    "/runs",
    response_model=List[BillingRunResponse],
    status_code=status.HTTP_200_OK,
    summary="List historical billing runs [PDF 7.2, 8]",
)
def list_billing_runs(
    response: Response,
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> List[BillingRunResponse]:
    """
    Lists historical billing run audit logs with runtime metrics and error summaries.
    """
    query = db.query(BillingRun).order_by(BillingRun.started_at.desc())
    total_count = query.count()
    results = query.offset(pagination.skip).limit(pagination.limit).all()

    response.headers["X-Total-Count"] = str(total_count)
    return [BillingRunResponse.model_validate(r) for r in results]

