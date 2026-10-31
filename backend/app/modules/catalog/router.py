"""
Catalog REST Router: Products and Variants [PDF 5.3, 8, 11].
Enforces RBAC:
- Public/Staff/Portal: Browsing and details with masked cost & margin.
- Admin: Full CRUD, margin calculation visibility, and variant provisioning.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import (
    PaginationParams,
    get_current_user_optional,
    require_admin,
    require_staff_or_admin,
)
from app.modules.auth.models import User
from app.modules.catalog.models import ProductType
from app.modules.catalog.schemas import (
    ProductCreateRequest,
    ProductResponse,
    ProductUpdateRequest,
    ProductVariantResponse,
    VariantCreateRequest,
)
from app.modules.catalog.service import CatalogService

router = APIRouter(prefix="/products", tags=["Catalog"])


@router.get("", response_model=List[ProductResponse], summary="List products with role-based pricing")
def list_products(
    active_only: bool = Query(True, description="Filter for active products"),
    product_type: Optional[ProductType] = Query(None, description="Filter by product type"),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """
    Retrieves catalog products [PDF 5.3].
    Admins see cost_price and calculated margin; all other callers see null margin.
    """
    return CatalogService.list_products(
        db=db,
        current_user=current_user,
        skip=pagination.skip,
        limit=pagination.limit,
        active_only=active_only,
        product_type=product_type,
    )


@router.post(
    "",
    response_model=ProductResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create product (Admin only)",
)
def create_product(
    payload: ProductCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Creates a new catalog product with initial sales and cost prices [PDF 5.3]."""
    client_ip = request.client.host if request.client else None
    return CatalogService.create_product(
        db=db,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.get("/{product_id}", response_model=ProductResponse, summary="Get product details")
def get_product(
    product_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Retrieves specific product and attached active variants."""
    return CatalogService.get_product(db=db, product_id=product_id, current_user=current_user)


@router.patch("/{product_id}", response_model=ProductResponse, summary="Update product (Admin only)")
def update_product(
    product_id: str,
    payload: ProductUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Updates product prices, details, or active status [PDF 5.3, 9]."""
    client_ip = request.client.host if request.client else None
    return CatalogService.update_product(
        db=db,
        product_id=product_id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )


@router.delete("/{product_id}", response_model=ProductResponse, summary="Soft delete product (Admin only)")
def delete_product(
    product_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-deletes a product, disabling it from new quotations/subscriptions."""
    client_ip = request.client.host if request.client else None
    return CatalogService.delete_product(
        db=db,
        product_id=product_id,
        current_user=current_user,
        ip=client_ip,
    )


@router.post(
    "/{product_id}/variants",
    response_model=ProductVariantResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add product variant (Admin only)",
)
def add_product_variant(
    product_id: str,
    payload: VariantCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Appends an attribute-value variant (e.g., Brand: Odoo, Extra Price: $560.00) [PDF 5.3].
    Rejects duplicates with 409 Conflict.
    """
    client_ip = request.client.host if request.client else None
    return CatalogService.add_variant(
        db=db,
        product_id=product_id,
        data=payload,
        current_user=current_user,
        ip=client_ip,
    )
