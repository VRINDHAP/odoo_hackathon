"""
Database Repository for Subscription Plans [PDF 5.2, 8].
"""
from typing import List, Optional
from sqlalchemy.orm import Session
from app.modules.plans.models import BillingPeriod, Plan


class PlanRepository:
    """Encapsulates SQL operations for subscription plans."""

    @staticmethod
    def get_by_id(db: Session, plan_id: str) -> Optional[Plan]:
        return db.query(Plan).filter(Plan.id == plan_id).first()

    @staticmethod
    def list_plans(
        db: Session,
        skip: int = 0,
        limit: int = 20,
        active_only: bool = True,
        billing_period: Optional[BillingPeriod] = None,
    ) -> List[Plan]:
        query = db.query(Plan)
        if active_only:
            query = query.filter(Plan.is_active == True)  # noqa: E712
        if billing_period:
            query = query.filter(Plan.billing_period == billing_period)
        return query.order_by(Plan.name.asc()).offset(skip).limit(limit).all()

    @staticmethod
    def create_plan(db: Session, **kwargs) -> Plan:
        plan = Plan(**kwargs)
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan

    @staticmethod
    def update_plan(db: Session, plan: Plan, **kwargs) -> Plan:
        for key, value in kwargs.items():
            if value is not None and hasattr(plan, key):
                setattr(plan, key, value)
        db.commit()
        db.refresh(plan)
        return plan

    @staticmethod
    def soft_delete_plan(db: Session, plan: Plan) -> Plan:
        plan.is_active = False
        db.commit()
        db.refresh(plan)
        return plan
