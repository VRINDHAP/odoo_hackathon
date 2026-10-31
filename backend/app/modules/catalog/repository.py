"""
Database Repository for Products and Variants [PDF 5.3].
"""
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.modules.catalog.models import Product, ProductType, ProductVariant


class CatalogRepository:
    """Encapsulates database operations for catalog products and variants."""

    @staticmethod
    def get_by_id(db: Session, product_id: str) -> Optional[Product]:
        return db.query(Product).filter(Product.id == product_id).first()

    @staticmethod
    def list_products(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        active_only: bool = True,
        product_type: Optional[ProductType] = None,
    ) -> List[Product]:
        query = db.query(Product)
        if active_only:
            query = query.filter(Product.is_active == True)  # noqa: E712
        if product_type:
            query = query.filter(Product.type == product_type)
        return query.order_by(Product.name.asc()).offset(skip).limit(limit).all()

    @staticmethod
    def create_product(
        db: Session,
        name: str,
        type: ProductType,
        sales_price: Decimal,
        cost_price: Decimal,
        notes: Optional[str] = None,
        tax_id: Optional[str] = None,
    ) -> Product:
        product = Product(
            name=name.strip(),
            type=type,
            sales_price=sales_price,
            cost_price=cost_price,
            notes=notes,
            tax_id=tax_id,
            is_active=True,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return product

    @staticmethod
    def update_product(db: Session, product: Product, **kwargs) -> Product:
        for key, value in kwargs.items():
            if value is not None and hasattr(product, key):
                setattr(product, key, value)
        db.commit()
        db.refresh(product)
        return product

    @staticmethod
    def soft_delete_product(db: Session, product: Product) -> Product:
        product.is_active = False
        db.commit()
        db.refresh(product)
        return product

    @staticmethod
    def get_variant_by_attribute_value(
        db: Session, product_id: str, attribute: str, value: str
    ) -> Optional[ProductVariant]:
        return (
            db.query(ProductVariant)
            .filter(
                ProductVariant.product_id == product_id,
                func.lower(ProductVariant.attribute) == attribute.strip().lower(),
                func.lower(ProductVariant.value) == value.strip().lower(),
            )
            .first()
        )

    @staticmethod
    def create_variant(
        db: Session,
        product_id: str,
        attribute: str,
        value: str,
        extra_price: Decimal,
    ) -> ProductVariant:
        variant = ProductVariant(
            product_id=product_id,
            attribute=attribute.strip(),
            value=value.strip(),
            extra_price=extra_price,
            is_active=True,
        )
        db.add(variant)
        db.commit()
        db.refresh(variant)
        return variant
