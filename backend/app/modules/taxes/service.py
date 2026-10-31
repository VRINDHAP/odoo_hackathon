"""
Taxes Business Logic & Calculation Service [PDF 5.7, 7.1, 8, 9].
Implements inclusive vs. exclusive tax calculation algorithms,
maintains audit trail on tax modifications, and exposes domain contract helpers.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from sqlalchemy.orm import Session

from app.core.contracts import TaxBreakdown
from app.core.errors import NotFoundError
from app.modules.audit.service import AuditService
from app.modules.auth.models import User
from app.modules.taxes.models import Tax, TaxType
from app.modules.taxes.repository import TaxRepository
from app.modules.taxes.schemas import (
    TaxCalculateResponse,
    TaxCreateRequest,
    TaxResponse,
    TaxUpdateRequest,
)


class TaxService:
    """Orchestrates tax configuration and financial calculations."""

    @staticmethod
    def list_taxes(
        db: Session,
        skip: int = 0,
        limit: int = 50,
        active_only: bool = True,
    ) -> List[TaxResponse]:
        """Lists tax schedules with optional active filter."""
        taxes = TaxRepository.list_taxes(
            db=db,
            skip=skip,
            limit=limit,
            active_only=active_only,
        )
        return [TaxResponse.model_validate(t) for t in taxes]

    @staticmethod
    def get_tax(db: Session, tax_id: str) -> TaxResponse:
        """Retrieves a single tax schedule by ID or raises 404."""
        tax = TaxRepository.get_by_id(db, tax_id)
        if not tax:
            raise NotFoundError("Tax", tax_id)
        return TaxResponse.model_validate(tax)

    @staticmethod
    def create_tax(
        db: Session,
        data: TaxCreateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> TaxResponse:
        """Creates a new tax schedule and logs to audit trail [PDF 5.7, 9]."""
        tax = TaxRepository.create_tax(
            db=db,
            name=data.name.strip(),
            type=data.type,
            rate=data.rate,
            inclusive=data.inclusive,
            applies_to=data.applies_to,
            is_active=data.is_active,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="tax",
            entity_id=tax.id,
            action="CREATE",
            after_json={
                "name": tax.name,
                "type": tax.type.value,
                "rate": str(tax.rate),
                "inclusive": tax.inclusive,
                "applies_to": tax.applies_to.value,
                "is_active": tax.is_active,
            },
            ip=ip,
        )

        return TaxResponse.model_validate(tax)

    @staticmethod
    def update_tax(
        db: Session,
        tax_id: str,
        data: TaxUpdateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> TaxResponse:
        """Updates tax attributes or rates, capturing changes in audit trail."""
        tax = TaxRepository.get_by_id(db, tax_id)
        if not tax:
            raise NotFoundError("Tax", tax_id)

        before_state = {
            "name": tax.name,
            "type": tax.type.value,
            "rate": str(tax.rate),
            "inclusive": tax.inclusive,
            "applies_to": tax.applies_to.value,
            "is_active": tax.is_active,
        }

        updated = TaxRepository.update_tax(
            db=db,
            tax=tax,
            name=data.name.strip() if data.name else None,
            type=data.type,
            rate=data.rate,
            inclusive=data.inclusive,
            applies_to=data.applies_to,
            is_active=data.is_active,
        )

        after_state = {
            "name": updated.name,
            "type": updated.type.value,
            "rate": str(updated.rate),
            "inclusive": updated.inclusive,
            "applies_to": updated.applies_to.value,
            "is_active": updated.is_active,
        }

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="tax",
            entity_id=updated.id,
            action="UPDATE",
            before_json=before_state,
            after_json=after_state,
            ip=ip,
        )

        return TaxResponse.model_validate(updated)

    @staticmethod
    def delete_tax(
        db: Session,
        tax_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> TaxResponse:
        """Soft-deletes a tax schedule, deactivating it from new invoices/lines."""
        tax = TaxRepository.get_by_id(db, tax_id)
        if not tax:
            raise NotFoundError("Tax", tax_id)

        soft_deleted = TaxRepository.soft_delete_tax(db, tax)

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="tax",
            entity_id=soft_deleted.id,
            action="SOFT_DELETE",
            after_json={"is_active": False},
            ip=ip,
        )

        return TaxResponse.model_validate(soft_deleted)

    @classmethod
    def calculate_tax(
        cls,
        db: Session,
        tax_id: Optional[str],
        amount: Decimal,
    ) -> TaxCalculateResponse:
        """
        Calculates exact tax breakdown for an amount [PDF 5.7, 7.1].
        Exclusive: tax = amount * (rate / 100); total = amount + tax.
        Inclusive: tax = amount - amount / (1 + rate / 100); taxable = amount - tax; total = amount.
        """
        gross_amount = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        if not tax_id:
            return TaxCalculateResponse(
                tax_id=None,
                name="No Tax",
                rate=Decimal("0.00"),
                inclusive=False,
                taxable_amount=gross_amount,
                tax_amount=Decimal("0.00"),
                total_amount=gross_amount,
            )

        tax = TaxRepository.get_by_id(db, tax_id)
        if not tax:
            raise NotFoundError("Tax", tax_id)

        if not tax.is_active:
            return TaxCalculateResponse(
                tax_id=tax.id,
                name=f"{tax.name} (Inactive)",
                rate=Decimal("0.00"),
                inclusive=tax.inclusive,
                taxable_amount=gross_amount,
                tax_amount=Decimal("0.00"),
                total_amount=gross_amount,
            )

        if tax.type == TaxType.FIXED:
            tax_val = Decimal(str(tax.rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if tax.inclusive:
                net_taxable = (gross_amount - tax_val).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                total_val = gross_amount
            else:
                net_taxable = gross_amount
                total_val = (gross_amount + tax_val).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return TaxCalculateResponse(
                tax_id=tax.id,
                name=tax.name,
                rate=Decimal(str(tax.rate)),
                inclusive=tax.inclusive,
                taxable_amount=net_taxable,
                tax_amount=tax_val,
                total_amount=total_val,
            )

        # Percentage Calculation
        rate_val = Decimal(str(tax.rate))
        r = rate_val / Decimal("100")

        if tax.inclusive:
            # inclusive_tax = amount - amount / (1 + rate)
            net_taxable = (gross_amount / (Decimal("1") + r)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            tax_amount = (gross_amount - net_taxable).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_amount = gross_amount
        else:
            # exclusive_tax = amount * rate
            net_taxable = gross_amount
            tax_amount = (gross_amount * r).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total_amount = (gross_amount + tax_amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        return TaxCalculateResponse(
            tax_id=tax.id,
            name=tax.name,
            rate=rate_val,
            inclusive=tax.inclusive,
            taxable_amount=net_taxable,
            tax_amount=tax_amount,
            total_amount=total_amount,
        )

    @classmethod
    def calculate_breakdown(
        cls,
        db: Session,
        tax_id: Optional[str],
        taxable_amount: Decimal,
    ) -> TaxBreakdown:
        """
        Internal domain contract helper satisfying app.core.contracts.TaxCalculationProtocol.
        Consumed by invoicing and subscription line calculation engines.
        """
        res = cls.calculate_tax(db=db, tax_id=tax_id, amount=taxable_amount)
        return TaxBreakdown(
            tax_id=res.tax_id,
            rate=res.rate,
            inclusive=res.inclusive,
            tax_amount=res.tax_amount,
            taxable_amount=res.taxable_amount,
        )
