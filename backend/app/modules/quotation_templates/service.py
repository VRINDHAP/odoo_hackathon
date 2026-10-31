"""
Quotation Template Service: Business Logic and One-Click Quotation Factory [PDF 5.5, 8].
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.auth.models import User
from app.modules.catalog.models import Product, ProductVariant
from app.modules.customers.models import Customer
from app.modules.plans.models import Plan
from app.modules.quotation_templates.models import QuotationTemplate
from app.modules.quotation_templates.repository import QuotationTemplateRepository
from app.modules.quotation_templates.schemas import (
    QuotationTemplateCreate,
    QuotationTemplateResponse,
    QuotationTemplateUpdate,
)
from app.modules.subscriptions.schemas import (
    SubscriptionCreate,
    SubscriptionLineCreate,
    SubscriptionResponse,
)
from app.modules.subscriptions.service import SubscriptionService


class QuotationTemplateService:
    """Service layer managing quotation templates and 1-click subscription generation."""

    @classmethod
    def list_templates(cls, db: Session, skip: int = 0, limit: int = 100) -> List[QuotationTemplateResponse]:
        """Lists all quotation templates."""
        templates = QuotationTemplateRepository.list_templates(db, skip=skip, limit=limit)
        return [QuotationTemplateResponse.model_validate(t) for t in templates]

    @classmethod
    def get_template(cls, db: Session, template_id: str) -> QuotationTemplateResponse:
        """Retrieves a single template by ID."""
        template = QuotationTemplateRepository.get_by_id(db, template_id)
        if not template:
            raise NotFoundError("QuotationTemplate", template_id)
        return QuotationTemplateResponse.model_validate(template)

    @classmethod
    def create_template(
        cls,
        db: Session,
        data: QuotationTemplateCreate,
        current_user: User,
        ip: Optional[str] = None,
    ) -> QuotationTemplateResponse:
        """
        Creates a new quotation template after verifying plan and product catalog existence.
        """
        # Validate Plan existence
        plan = db.query(Plan).filter(Plan.id == data.plan_id).first()
        if not plan:
            raise NotFoundError("Plan", data.plan_id)

        # Validate lines and catalog items
        lines_data = []
        for line in data.lines:
            product = db.query(Product).filter(Product.id == line.product_id).first()
            if not product:
                raise NotFoundError("Product", line.product_id)

            if line.variant_id:
                variant = db.query(ProductVariant).filter(ProductVariant.id == line.variant_id).first()
                if not variant:
                    raise NotFoundError("ProductVariant", line.variant_id)

            lines_data.append({
                "product_id": line.product_id,
                "variant_id": line.variant_id,
                "quantity": line.quantity,
                "unit_price": str(line.unit_price),
            })

        template = QuotationTemplateRepository.create_template(
            db=db,
            name=data.name,
            validity_days=data.validity_days,
            plan_id=data.plan_id,
            notes=data.notes,
            lines_data=lines_data,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="quotation_template",
            entity_id=template.id,
            action="CREATE",
            before_json=None,
            after_json={
                "name": template.name,
                "validity_days": template.validity_days,
                "plan_id": template.plan_id,
                "line_count": len(lines_data),
            },
            ip=ip,
        )

        return QuotationTemplateResponse.model_validate(template)

    @classmethod
    def delete_template(
        cls,
        db: Session,
        template_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> None:
        """Deletes a quotation template and audit logs the action."""
        template = QuotationTemplateRepository.get_by_id(db, template_id)
        if not template:
            raise NotFoundError("QuotationTemplate", template_id)

        before_state = {
            "name": template.name,
            "plan_id": template.plan_id,
            "validity_days": template.validity_days,
        }

        QuotationTemplateRepository.delete_template(db, template)

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="quotation_template",
            entity_id=template_id,
            action="DELETE",
            before_json=before_state,
            after_json=None,
            ip=ip,
        )

    @classmethod
    def create_quotation(
        cls,
        db: Session,
        template_id: str,
        customer_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> SubscriptionResponse:
        """
        One-Click Quotation Factory [PDF 5.5, 8].
        Clones template lines, sets quotation expiration deadline based on validity_days,
        and generates a new Draft Subscription.
        """
        template = QuotationTemplateRepository.get_by_id(db, template_id)
        if not template:
            raise NotFoundError("QuotationTemplate", template_id)

        customer = db.query(Customer).filter(
            Customer.id == customer_id,
            Customer.deleted_at.is_(None),
        ).first()
        if not customer:
            raise NotFoundError("Customer", customer_id)

        # Calculate deadline
        expires_at = date.today() + timedelta(days=template.validity_days)

        # Clone line items from template
        sub_lines: List[SubscriptionLineCreate] = []
        for tl in template.lines:
            sub_lines.append(
                SubscriptionLineCreate(
                    product_id=tl.product_id,
                    variant_id=tl.variant_id,
                    quantity=tl.quantity,
                    unit_price=Decimal(str(tl.unit_price)),
                    description=f"Snapshot from template '{template.name}'",
                )
            )

        # Build draft subscription request
        sub_create = SubscriptionCreate(
            customer_id=customer.id,
            plan_id=template.plan_id,
            template_id=template.id,
            quotation_expires_at=expires_at,
            lines=sub_lines,
        )

        subscription = SubscriptionService.create_subscription(
            db=db,
            request=sub_create,
            creator_id=current_user.id,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="subscription",
            entity_id=subscription.id,
            action="CREATE_QUOTATION_FROM_TEMPLATE",
            before_json={"template_id": template.id, "customer_id": customer.id},
            after_json={"subscription_number": subscription.number, "status": subscription.status.value if hasattr(subscription.status, "value") else str(subscription.status)},
            ip=ip,
        )

        return SubscriptionResponse.model_validate(subscription)
