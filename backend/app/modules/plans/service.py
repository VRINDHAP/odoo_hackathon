"""
Plans Business Logic Service [PDF 5.2, 8, 9].
Handles plan configuration, behavioral rule verification,
and audit trail recording.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.modules.audit.service import AuditService
from app.modules.auth.models import User
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.plans.repository import PlanRepository
from app.modules.plans.schemas import PlanCreateRequest, PlanResponse, PlanUpdateRequest


class PlanService:
    """Orchestrates plan lifecycle, validation guards, and audit trail."""

    @staticmethod
    def list_plans(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        active_only: bool = True,
        billing_period: Optional[BillingPeriod] = None,
    ) -> List[PlanResponse]:
        """Lists plans with optional active and cadence filters."""
        plans = PlanRepository.list_plans(
            db=db,
            skip=skip,
            limit=limit,
            active_only=active_only,
            billing_period=billing_period,
        )
        return [PlanResponse.model_validate(p) for p in plans]

    @staticmethod
    def get_plan(db: Session, plan_id: str) -> PlanResponse:
        """Retrieves a single plan by ID or raises 404."""
        plan = PlanRepository.get_by_id(db, plan_id)
        if not plan:
            raise NotFoundError("Plan", plan_id)
        return PlanResponse.model_validate(plan)

    @staticmethod
    def create_plan(
        db: Session,
        data: PlanCreateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> PlanResponse:
        """Registers a new subscription plan with behavior flags [PDF 5.2, 9]."""
        plan = PlanRepository.create_plan(
            db=db,
            name=data.name.strip(),
            price=data.price,
            billing_period=data.billing_period,
            min_quantity=data.min_quantity,
            valid_from=data.valid_from,
            valid_to=data.valid_to,
            auto_close=data.auto_close,
            closable=data.closable,
            pausable=data.pausable,
            renewable=data.renewable,
            is_active=data.is_active,
        )

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="plan",
            entity_id=plan.id,
            action="CREATE",
            after_json={
                "name": plan.name,
                "price": str(plan.price),
                "billing_period": plan.billing_period.value,
                "min_quantity": plan.min_quantity,
                "auto_close": plan.auto_close,
                "closable": plan.closable,
                "pausable": plan.pausable,
                "renewable": plan.renewable,
                "is_active": plan.is_active,
            },
            ip=ip,
        )

        return PlanResponse.model_validate(plan)

    @staticmethod
    def update_plan(
        db: Session,
        plan_id: str,
        data: PlanUpdateRequest,
        current_user: User,
        ip: Optional[str] = None,
    ) -> PlanResponse:
        """Modifies plan properties or flags, logging before/after state to audit trail."""
        plan = PlanRepository.get_by_id(db, plan_id)
        if not plan:
            raise NotFoundError("Plan", plan_id)

        before_state = {
            "name": plan.name,
            "price": str(plan.price),
            "billing_period": plan.billing_period.value,
            "min_quantity": plan.min_quantity,
            "auto_close": plan.auto_close,
            "closable": plan.closable,
            "pausable": plan.pausable,
            "renewable": plan.renewable,
            "is_active": plan.is_active,
        }

        updated = PlanRepository.update_plan(
            db=db,
            plan=plan,
            name=data.name.strip() if data.name else None,
            price=data.price,
            billing_period=data.billing_period,
            min_quantity=data.min_quantity,
            valid_from=data.valid_from,
            valid_to=data.valid_to,
            auto_close=data.auto_close,
            closable=data.closable,
            pausable=data.pausable,
            renewable=data.renewable,
            is_active=data.is_active,
        )

        after_state = {
            "name": updated.name,
            "price": str(updated.price),
            "billing_period": updated.billing_period.value,
            "min_quantity": updated.min_quantity,
            "auto_close": updated.auto_close,
            "closable": updated.closable,
            "pausable": updated.pausable,
            "renewable": updated.renewable,
            "is_active": updated.is_active,
        }

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="plan",
            entity_id=updated.id,
            action="UPDATE",
            before_json=before_state,
            after_json=after_state,
            ip=ip,
        )

        return PlanResponse.model_validate(updated)

    @staticmethod
    def delete_plan(
        db: Session,
        plan_id: str,
        current_user: User,
        ip: Optional[str] = None,
    ) -> PlanResponse:
        """Soft-deletes a plan, preventing future subscriptions from selecting it."""
        plan = PlanRepository.get_by_id(db, plan_id)
        if not plan:
            raise NotFoundError("Plan", plan_id)

        soft_deleted = PlanRepository.soft_delete_plan(db, plan)

        AuditService.record(
            db=db,
            actor_id=current_user.id,
            entity="plan",
            entity_id=soft_deleted.id,
            action="SOFT_DELETE",
            after_json={"is_active": False},
            ip=ip,
        )

        return PlanResponse.model_validate(soft_deleted)

    @staticmethod
    def validate_plan_for_subscription(db: Session, plan_id: str) -> Plan:
        """
        Guarantees that a plan is eligible to create or renew a subscription [PDF 5.2, 6.1].
        Throws 404 if plan doesn't exist, or 422 if inactive or expired.
        """
        plan = PlanRepository.get_by_id(db, plan_id)
        if not plan:
            raise NotFoundError("Plan", plan_id)

        if not plan.is_active:
            raise ValidationError(f"Plan '{plan.name}' is inactive and cannot accept new subscriptions.")

        now = datetime.utcnow()
        if plan.valid_to and now > plan.valid_to:
            raise ValidationError(f"Plan '{plan.name}' expired on {plan.valid_to.strftime('%Y-%m-%d')}.")

        return plan
