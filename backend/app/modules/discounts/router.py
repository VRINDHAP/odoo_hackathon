"""
Discounts API Router (/api/v1/discounts) [PDF 5.8, 7.3, 8].
Owned by Vrindha.

Endpoints:
- POST  /api/v1/discounts: Create discount rule (Admin only)
- GET   /api/v1/discounts: List discount rules with pagination (Admin & Staff)
- GET   /api/v1/discounts/{id}: Fetch discount rule detail (Admin & Staff)
- PATCH /api/v1/discounts/{id}: Update discount rule (Admin only)
- GET   /api/v1/discounts/{id}/usage: Usage statistics & redemptions audit (Admin & Staff)
- POST  /api/v1/discounts/evaluate: Test/evaluate discount rules against an order (Admin & Staff)
"""
from typing import Any, List, Optional
from datetime import date
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import (
    PaginationParams,
    get_db,
    require_admin,
    require_staff_or_admin,
)
from app.modules.auth.models import User
from app.modules.discounts.schemas import (
    DiscountEvaluationRequest,
    DiscountEvaluationResponse,
    DiscountRuleCreate,
    DiscountRuleResponse,
    DiscountRuleUpdate,
    DiscountUsageResponse,
)
from app.modules.discounts.service import DiscountService

router = APIRouter(prefix="/discounts", tags=["Discounts"])


def _to_response_model(rule: Any) -> DiscountRuleResponse:
    """Helper mapping ORM rule to response schema with product IDs."""
    product_ids = [p.product_id for p in getattr(rule, "products", [])]
    return DiscountRuleResponse(
        id=rule.id,
        name=rule.name,
        type=rule.type,
        value=rule.value,
        min_purchase_amount=rule.min_purchase_amount,
        min_quantity=rule.min_quantity,
        start_date=rule.start_date,
        end_date=rule.end_date,
        usage_limit=rule.usage_limit,
        usage_count=rule.usage_count,
        scope=rule.scope,
        is_active=rule.is_active,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
        product_ids=product_ids,
    )


@router.post(
    "",
    response_model=DiscountRuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create discount rule (Admin only) [PDF 5.8, 8]",
)
def create_discount_rule(
    request: DiscountRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> DiscountRuleResponse:
    """Creates a new discount rule. Accessible strictly by Admin."""
    rule = DiscountService.create_discount_rule(db=db, request=request)
    return _to_response_model(rule)


@router.get(
    "",
    response_model=List[DiscountRuleResponse],
    status_code=status.HTTP_200_OK,
    summary="List discount rules (Admin & Staff read) [PDF 5.8, 8]",
)
def list_discount_rules(
    response: Response,
    active_only: bool = Query(False, description="Filter for active rules only"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> List[DiscountRuleResponse]:
    """Lists discount rules with pagination and status filters."""
    results, total_count = DiscountService.list_discount_rules(
        db=db,
        active_only=active_only,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    response.headers["X-Total-Count"] = str(total_count)
    return [_to_response_model(r) for r in results]


@router.get(
    "/{id}",
    response_model=DiscountRuleResponse,
    status_code=status.HTTP_200_OK,
    summary="Get discount rule detail [PDF 5.8, 8]",
)
def get_discount_rule(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> DiscountRuleResponse:
    """Fetches single discount rule details."""
    rule = DiscountService.get_discount_rule(db=db, rule_id=id)
    return _to_response_model(rule)


@router.patch(
    "/{id}",
    response_model=DiscountRuleResponse,
    status_code=status.HTTP_200_OK,
    summary="Update discount rule (Admin only) [PDF 5.8, 8]",
)
def update_discount_rule(
    id: str,
    request: DiscountRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> DiscountRuleResponse:
    """Updates discount rule configuration. Accessible strictly by Admin."""
    rule = DiscountService.update_discount_rule(db=db, rule_id=id, request=request)
    return _to_response_model(rule)


@router.get(
    "/{id}/usage",
    response_model=DiscountUsageResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve discount usage statistics [PDF 5.8, 8]",
)
def get_discount_usage(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> DiscountUsageResponse:
    """Retrieves real-time usage telemetry and redemptions audit history."""
    return DiscountService.get_discount_usage(db=db, rule_id=id)


@router.post(
    "/evaluate",
    response_model=DiscountEvaluationResponse,
    status_code=status.HTTP_200_OK,
    summary="Evaluate discount rules against cart/quote lines [PDF 7.3]",
)
def evaluate_discount(
    request: DiscountEvaluationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
) -> DiscountEvaluationResponse:
    """Evaluates best discount matching the given subtotal and line items."""
    ref_date = request.invoice_date or date.today()
    result = DiscountService.evaluate_discount(
        subtotal=request.subtotal,
        lines=request.lines,
        invoice_date=ref_date,
        db=db,
    )

    if not result:
        return DiscountEvaluationResponse(applied=False)

    rule, amount = result
    return DiscountEvaluationResponse(
        discount_id=rule.id,
        name=rule.name,
        discount_amount=amount,
        scope=rule.scope.value,
        applied=True,
    )
