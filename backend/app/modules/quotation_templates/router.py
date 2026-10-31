"""
FastAPI Router for Quotation Templates Engine [PDF 5.5, 8].
"""
from typing import List
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import PaginationParams, require_admin, require_staff_or_admin
from app.modules.auth.models import User
from app.modules.quotation_templates.schemas import (
    CreateQuotationRequest,
    QuotationTemplateCreate,
    QuotationTemplateResponse,
)
from app.modules.quotation_templates.service import QuotationTemplateService
from app.modules.subscriptions.schemas import SubscriptionResponse

router = APIRouter(prefix="/quotation-templates", tags=["Quotation Templates"])


@router.get(
    "",
    response_model=List[QuotationTemplateResponse],
    summary="List quotation templates [PDF 8]",
)
def list_quotation_templates(
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Retrieves paginated quotation templates for staff and admins."""
    return QuotationTemplateService.list_templates(
        db=db,
        skip=pagination.skip,
        limit=pagination.limit,
    )


@router.post(
    "",
    response_model=QuotationTemplateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create quotation template [PDF 5.5, 8]",
)
def create_quotation_template(
    data: QuotationTemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Creates a new quotation template with preset line items and validity window."""
    client_ip = request.client.host if request.client else None
    return QuotationTemplateService.create_template(
        db=db,
        data=data,
        current_user=current_user,
        ip=client_ip,
    )


@router.get(
    "/{id}",
    response_model=QuotationTemplateResponse,
    summary="Get quotation template by ID [PDF 8]",
)
def get_quotation_template(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """Fetches full template details including bundle line items."""
    return QuotationTemplateService.get_template(db=db, template_id=id)


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete quotation template [PDF 8]",
)
def delete_quotation_template(
    id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Deletes a quotation template (Admin only)."""
    client_ip = request.client.host if request.client else None
    QuotationTemplateService.delete_template(
        db=db,
        template_id=id,
        current_user=current_user,
        ip=client_ip,
    )


@router.post(
    "/{id}/create-quotation",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="One-click generate quotation draft from template [PDF 5.5, 8]",
)
def create_quotation_from_template(
    id: str,
    payload: CreateQuotationRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff_or_admin),
):
    """
    One-click factory endpoint cloning template lines into a new Draft Subscription.
    Automatically assigns plan, customer, snapshot pricing, and expiration deadline.
    """
    client_ip = request.client.host if request.client else None
    return QuotationTemplateService.create_quotation(
        db=db,
        template_id=id,
        customer_id=payload.customer_id,
        current_user=current_user,
        ip=client_ip,
    )
