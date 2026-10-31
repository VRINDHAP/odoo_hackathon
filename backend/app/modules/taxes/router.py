"""
Taxes REST Router: Tax Schedules and Mathematical Calculations [PDF 5.7, 7.1, 8, 11].
Enforces RBAC:
- Public/Staff/Customer: Tax list, inspection, and line-item tax calculation preview.
- Admin: Full CRUD and schedule creation/updates.
"""
from typing import List
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import PaginationParams, require_admin
from app.core.errors import BadRequestError
from app.modules.auth.models import User
from app.modules.taxes.schemas import (
    TaxCalculateRequest,
    TaxCalculateResponse,
    TaxCreateRequest,
    TaxResponse,
    TaxUpdateRequest,
)
from app.modules.taxes.service import TaxService

router = APIRouter(prefix="/taxes", tags=["Taxes"])


@router.get("", response_model=List[TaxResponse], summary="List tax rules")
def list_taxes(
    active_only: bool = Query(True, description="Filter for active tax rules"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
):
    """Retrieves configured tax rules and calculation modes [PDF 5.7]."""
    return TaxService.list_taxes(
        db=db,
        skip=pagination.skip,
        limit=pagination.limit,
        active_only=active_only,
    )


@router.post(
    "",
    response_model=TaxResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create tax rule (Admin only)",
)
def create_tax(
    payload: TaxCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Registers a new tax rule [PDF 5.7, 8]."""
    client_ip = request.client.host if request.client else None
    return TaxService.create_tax(
        db=db,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.patch("", response_model=TaxResponse, summary="Update tax rule by body ID (Admin only)")
def update_tax_root(
    payload: TaxUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Updates a tax rule where ID is supplied in the request body [FE-2.3]."""
    if not payload.id:
        raise BadRequestError("Field 'id' is required in request body when calling PATCH /taxes.")
    client_ip = request.client.host if request.client else None
    return TaxService.update_tax(
        db=db,
        tax_id=payload.id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.post("/calculate", response_model=TaxCalculateResponse, summary="Preview tax calculation")
def calculate_tax_preview(
    payload: TaxCalculateRequest,
    db: Session = Depends(get_db),
):
    """
    Computes exact taxable base, tax amount, and invoice total [PDF 7.1].
    Evaluates both exclusive (base + tax) and inclusive (base / (1+rate)) algorithms.
    """
    return TaxService.calculate_tax(
        db=db,
        tax_id=payload.tax_id,
        amount=payload.amount,
    )


@router.get("/{tax_id}", response_model=TaxResponse, summary="Get tax rule details")
def get_tax(
    tax_id: str,
    db: Session = Depends(get_db),
):
    """Retrieves specific tax rule details."""
    return TaxService.get_tax(db=db, tax_id=tax_id)


@router.patch("/{tax_id}", response_model=TaxResponse, summary="Update tax rule (Admin only)")
def update_tax(
    tax_id: str,
    payload: TaxUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Modifies an existing tax rule [PDF 5.7, 9]."""
    client_ip = request.client.host if request.client else None
    return TaxService.update_tax(
        db=db,
        tax_id=tax_id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.delete("/{tax_id}", response_model=TaxResponse, summary="Soft delete tax rule (Admin only)")
def delete_tax(
    tax_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-deletes a tax rule, deactivating it from new invoices."""
    client_ip = request.client.host if request.client else None
    return TaxService.delete_tax(
        db=db,
        tax_id=tax_id,
        current_user=current_user,
        ip=client_ip,
    )
