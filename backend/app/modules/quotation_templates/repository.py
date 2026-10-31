"""
Quotation Template Repository: Database Operations [PDF 5.5, 8].
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from app.modules.quotation_templates.models import QuotationTemplate, QuotationTemplateLine


class QuotationTemplateRepository:
    """Encapsulates CRUD operations on quotation templates and lines."""

    @staticmethod
    def get_by_id(db: Session, template_id: str) -> Optional[QuotationTemplate]:
        """Fetch template by primary key ID."""
        return db.query(QuotationTemplate).filter(QuotationTemplate.id == template_id).first()

    @staticmethod
    def list_templates(db: Session, skip: int = 0, limit: int = 100) -> List[QuotationTemplate]:
        """Retrieve paginated list of templates ordered by created_at desc."""
        return (
            db.query(QuotationTemplate)
            .order_by(QuotationTemplate.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    @staticmethod
    def count_templates(db: Session) -> int:
        """Count total templates in database."""
        return db.query(QuotationTemplate).count()

    @staticmethod
    def create_template(
        db: Session,
        name: str,
        validity_days: int,
        plan_id: str,
        notes: Optional[str] = None,
        lines_data: Optional[List[Dict[str, Any]]] = None,
    ) -> QuotationTemplate:
        """Creates template and associated child line records."""
        template = QuotationTemplate(
            id=str(uuid.uuid4()),
            name=name.strip(),
            validity_days=validity_days,
            plan_id=plan_id,
            notes=notes.strip() if notes else None,
        )
        db.add(template)
        db.flush()

        if lines_data:
            for l_item in lines_data:
                line = QuotationTemplateLine(
                    id=str(uuid.uuid4()),
                    template_id=template.id,
                    product_id=l_item["product_id"],
                    variant_id=l_item.get("variant_id"),
                    quantity=l_item.get("quantity", 1),
                    unit_price=Decimal(str(l_item.get("unit_price", "0.00"))),
                )
                db.add(line)

        db.commit()
        db.refresh(template)
        return template

    @staticmethod
    def update_template(
        db: Session,
        template: QuotationTemplate,
        name: Optional[str] = None,
        validity_days: Optional[int] = None,
        plan_id: Optional[str] = None,
        notes: Optional[str] = None,
        lines_data: Optional[List[Dict[str, Any]]] = None,
    ) -> QuotationTemplate:
        """Updates template attributes and optionally replaces line items."""
        if name is not None:
            template.name = name.strip()
        if validity_days is not None:
            template.validity_days = validity_days
        if plan_id is not None:
            template.plan_id = plan_id
        if notes is not None:
            template.notes = notes.strip() if notes else None

        if lines_data is not None:
            # Delete existing lines
            db.query(QuotationTemplateLine).filter(
                QuotationTemplateLine.template_id == template.id
            ).delete()
            db.flush()

            for l_item in lines_data:
                line = QuotationTemplateLine(
                    id=str(uuid.uuid4()),
                    template_id=template.id,
                    product_id=l_item["product_id"],
                    variant_id=l_item.get("variant_id"),
                    quantity=l_item.get("quantity", 1),
                    unit_price=Decimal(str(l_item.get("unit_price", "0.00"))),
                )
                db.add(line)

        db.commit()
        db.refresh(template)
        return template

    @staticmethod
    def delete_template(db: Session, template: QuotationTemplate) -> None:
        """Deletes a quotation template and cascade deletes its lines."""
        db.delete(template)
        db.commit()
