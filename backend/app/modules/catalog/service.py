"""
Catalog Business Logic Service [PDF 5.3, 8, 9].
Handles product lifecycle, dynamic variant surcharges,
and role-sensitive margin calculation & masking (visible to Admin only).
"""
from decimal import Decimal
from typing import List, Optional
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.modules.audit.service import AuditService
from app.modules.auth.models import User, UserRole
from app.modules.catalog.models import Product, ProductType, ProductVariant
from app.modules.catalog.repository import CatalogRepository
from app.modules.catalog.schemas import (
    ProductCreateRequest,
    ProductResponse,
    ProductUpdateRequest,
    ProductVariantResponse,
    VariantCreateRequest,
)


class CatalogService:
    """Orchestrates catalog domain logic, role visibility, and pricing."""

    @staticmethod
    def _to_response(product: Product, current_user: Optional[User]) -> ProductResponse:
        """
        Converts Product ORM entity into ProductResponse.
        Enforces PDF 5.3 requirement: Margin = Sales Price - Cost Price (visible to Admin only).
        Masks cost_price and margin as None for staff, portal, and unauthenticated callers.
        """
        is_admin = current_user is not None and getattr(current_user, "role", None) == UserRole.ADMIN

        cost_price = product.cost_price if is_admin else None
        margin = (product.sales_price - product.cost_price) if is_admin else None

        active_variants = [
            ProductVariantResponse.model_validate(v)
            for v in (product.variants or [])
            if v.is_active
        ]

        return ProductResponse(
            id=product.id,
            name=product.name,
            type=product.type,
            sales_price=product.sales_price,
            cost_price=cost_price,
            margin=margin,
            notes=product.notes,
            tax_id=product.tax_id,
            is_active=product.is_active,
            created_at=product.created_at,
            updated_at=product.updated_at,
            variants=active_variants,
        )

    @classmethod
    def list_products(
        cls,
        db: Session,
        current_user: Optional[User],
        skip: int = 0,
        limit: int = 20,
        active_only: bool = True,
        product_type: Optional[ProductType] = None,
    ) -> List[ProductResponse]:
        """Lists products with role-based price margin masking."""
        products = CatalogRepository.list_products(
            db=db,
            skip=skip,
            limit=limit,
            active_only=active_only,
            product_type=product_type,
        )
        return [cls._to_response(p, current_user) for p in products]

    @classmethod
    def get_product(cls, db: Session, product_id: str, current_user: Optional[User]) -> ProductResponse:
        """Fetches single product by ID or raises 404."""
        product = CatalogRepository.get_by_id(db, product_id)
        if not product:
            raise NotFoundError("Product", product_id)
        return cls._to_response(product, current_user)

    @classmethod
    def create_product(
        cls,
        db: Session,
        data: ProductCreateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> ProductResponse:
        """Creates a new catalog product and writes immutable audit record [PDF 5.3, 9]."""
        product = CatalogRepository.create_product(
            db=db,
            name=data.name,
            type=data.type,
            sales_price=data.sales_price,
            cost_price=data.cost_price,
            notes=data.notes,
            tax_id=data.tax_id,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="product",
            entity_id=product.id,
            action="CREATE",
            after_json={
                "name": product.name,
                "type": product.type.value if hasattr(product.type, "value") else str(product.type),
                "sales_price": str(product.sales_price),
                "cost_price": str(product.cost_price),
            },
            ip=ip,
        )

        return cls._to_response(product, current_user)

    @classmethod
    def update_product(
        cls,
        db: Session,
        product_id: str,
        data: ProductUpdateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> ProductResponse:
        """Updates product metadata or prices, tracking price adjustments in audit log."""
        product = CatalogRepository.get_by_id(db, product_id)
        if not product:
            raise NotFoundError("Product", product_id)

        before_state = {
            "name": product.name,
            "sales_price": str(product.sales_price),
            "cost_price": str(product.cost_price),
            "is_active": product.is_active,
        }

        updated = CatalogRepository.update_product(
            db=db,
            product=product,
            name=data.name,
            type=data.type,
            sales_price=data.sales_price,
            cost_price=data.cost_price,
            notes=data.notes,
            tax_id=data.tax_id,
            is_active=data.is_active,
        )

        after_state = {
            "name": updated.name,
            "sales_price": str(updated.sales_price),
            "cost_price": str(updated.cost_price),
            "is_active": updated.is_active,
        }

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="product",
            entity_id=updated.id,
            action="UPDATE",
            before_json=before_state,
            after_json=after_state,
            ip=ip,
        )

        return cls._to_response(updated, current_user)

    @classmethod
    def delete_product(
        cls,
        db: Session,
        product_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> ProductResponse:
        """Soft-deletes a product, rendering it inactive for future subscriptions."""
        product = CatalogRepository.get_by_id(db, product_id)
        if not product:
            raise NotFoundError("Product", product_id)

        soft_deleted = CatalogRepository.soft_delete_product(db, product)

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="product",
            entity_id=soft_deleted.id,
            action="SOFT_DELETE",
            after_json={"is_active": False},
            ip=ip,
        )

        return cls._to_response(soft_deleted, current_user)

    @classmethod
    def add_variant(
        cls,
        db: Session,
        product_id: str,
        data: VariantCreateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> ProductVariantResponse:
        """
        Appends an attribute-value variant to a product [PDF 5.3].
        Rejects duplicates with HTTP 409 Conflict.
        """
        product = CatalogRepository.get_by_id(db, product_id)
        if not product:
            raise NotFoundError("Product", product_id)

        existing = CatalogRepository.get_variant_by_attribute_value(
            db=db,
            product_id=product_id,
            attribute=data.attribute,
            value=data.value,
        )
        if existing:
            raise ConflictError(
                f"Variant '{data.attribute}: {data.value}' already exists on product '{product.name}'."
            )

        variant = CatalogRepository.create_variant(
            db=db,
            product_id=product_id,
            attribute=data.attribute,
            value=data.value,
            extra_price=data.extra_price,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="product_variant",
            entity_id=variant.id,
            action="CREATE",
            after_json={
                "product_id": product_id,
                "attribute": variant.attribute,
                "value": variant.value,
                "extra_price": str(variant.extra_price),
            },
            ip=ip,
        )

        return ProductVariantResponse.model_validate(variant)

    @staticmethod
    def calculate_effective_price(
        db: Session,
        product_id: str,
        variant_id: Optional[str] = None,
    ) -> Decimal:
        """
        Computes effective unit sales price [PDF 5.3]:
        effective_price = product.sales_price + variant.extra_price.
        Used by quotation and billing engines.
        """
        product = CatalogRepository.get_by_id(db, product_id)
        if not product:
            raise NotFoundError("Product", product_id)

        effective_price = Decimal(str(product.sales_price))

        if variant_id:
            variant = (
                db.query(ProductVariant)
                .filter(ProductVariant.id == variant_id, ProductVariant.product_id == product_id)
                .first()
            )
            if not variant:
                raise NotFoundError("ProductVariant", variant_id)
            effective_price += Decimal(str(variant.extra_price))

        return effective_price
