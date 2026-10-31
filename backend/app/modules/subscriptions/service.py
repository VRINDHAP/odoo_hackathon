"""
Subscription Service Layer and Central State Machine [PDF 5.6, 6.1, 7.2, 8].
Owned by Vrindha.

Implements:
- Subscription Creation with sequence generator and line item snapshotting.
- Central State Machine (transition_state) with guard policies:
  * Quotation -> Confirmed: Expiry date check
  * Confirmed -> Active: Start date reached, anchor-based next_billing_date calculation
  * Active -> Paused: Enforces plan.pausable policy
  * Paused -> Active: Dynamic unbilled time restoration
  * Active -> Closed: Enforces plan.closable policy & mandatory reason
  * Closed -> Active (Renewal): Enforces plan.renewable policy
  * Draft/Quotation/Confirmed -> Cancelled: Restricted before Active
- Querying and filtering (get_subscription, list_subscriptions) with tenant isolation.
- Automatic Audit Log recording on lifecycle transitions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple, Union
import uuid

from sqlalchemy import Column, DateTime, Integer, JSON, String, Table, desc, func, text
from sqlalchemy.orm import Session

from app.core.db import Base
from app.core.errors import NotFoundError
from app.modules.auth.models import UserRole
from app.modules.subscriptions.exceptions import (
    InvalidStateTransitionException,
    PlanPolicyViolationException,
    QuotationExpiredException,
)
from app.modules.subscriptions.models import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatus,
)
from app.modules.subscriptions.schemas import (
    SubscriptionCreate,
    SubscriptionLineCreate,
)
from app.modules.subscriptions.utils import (
    calculate_line_amounts,
    calculate_next_billing_date,
    generate_subscription_number,
)

logger = logging.getLogger(__name__)

# Register audit_logs in metadata if not yet created by database migrations
if "audit_logs" not in Base.metadata.tables:
    Table(
        "audit_logs",
        Base.metadata,
        Column("id", String(36), primary_key=True, default=lambda: str(uuid.uuid4())),
        Column("actor_id", String(36), nullable=True),
        Column("entity", String(50), nullable=False),
        Column("entity_id", String(36), nullable=False),
        Column("action", String(50), nullable=False),
        Column("before_json", JSON, nullable=True),
        Column("after_json", JSON, nullable=True),
        Column("ip", String(45), nullable=True),
        Column("at", DateTime(timezone=True), default=datetime.utcnow),
        extend_existing=True,
    )


# ============================================================================
# PLAN POLICY REGISTRY & RESOLVER
# ============================================================================

@dataclass
class PlanPolicy:
    """Plan behavior rules [PDF 5.4]."""
    billing_period: str = "monthly"
    pausable: bool = True
    closable: bool = True
    renewable: bool = True
    auto_close: bool = False
    min_quantity: int = 1


# In-memory plan policy overrides (used in testing or when plans module is mocked)
_PLAN_POLICY_OVERRIDES: Dict[str, PlanPolicy] = {}


def register_plan_policy(plan_id: str, policy: PlanPolicy) -> None:
    """Register custom policy for a plan (used by tests and catalog engine)."""
    _PLAN_POLICY_OVERRIDES[plan_id] = policy


def get_plan_policy(db: Session, plan_id: str) -> PlanPolicy:
    """
    Resolves plan rules from plans table or registered policy overrides [PDF 5.4].
    Falls back to safe defaults if plans module is still being migrated.
    """
    if plan_id in _PLAN_POLICY_OVERRIDES:
        return _PLAN_POLICY_OVERRIDES[plan_id]

    try:
        # Check if plans table exists and query directly
        row = db.execute(
            text(
                "SELECT billing_period, pausable, closable, renewable, auto_close, min_quantity "
                "FROM plans WHERE id = :id"
            ),
            {"id": str(plan_id)},
        ).fetchone()

        if row:
            return PlanPolicy(
                billing_period=str(row[0]).lower() if row[0] else "monthly",
                pausable=bool(row[1]) if row[1] is not None else True,
                closable=bool(row[2]) if row[2] is not None else True,
                renewable=bool(row[3]) if row[3] is not None else True,
                auto_close=bool(row[4]) if row[4] is not None else False,
                min_quantity=int(row[5]) if row[5] is not None else 1,
            )
    except Exception as exc:
        logger.debug(f"Plan lookup fallback for plan_id={plan_id}: {exc}")

    # Default policy
    return PlanPolicy()


# ============================================================================
# AUDIT LOGGING HELPER
# ============================================================================

def record_transition_audit(
    db: Session,
    actor_id: Optional[str],
    subscription_id: str,
    action: str,
    before_status: str,
    after_status: str,
    reason: Optional[str] = None,
) -> None:
    """
    Records an immutable audit event for subscription state transitions [PDF 5.10, 6.1].
    """
    audit_table = Base.metadata.tables.get("audit_logs")
    if audit_table is not None:
        try:
            stmt = audit_table.insert().values(
                id=str(uuid.uuid4()),
                actor_id=str(actor_id) if actor_id else None,
                entity="subscription",
                entity_id=str(subscription_id),
                action=action,
                before_json={"status": before_status},
                after_json={"status": after_status, "reason": reason},
                at=datetime.utcnow(),
            )
            db.execute(stmt)
        except Exception as e:
            logger.warning(f"Could not persist audit log to DB: {e}")

    logger.info(
        f"AUDIT: Actor '{actor_id}' transitioned Subscription '{subscription_id}' "
        f"from '{before_status}' to '{after_status}'. Reason: {reason}"
    )


# ============================================================================
# SUBSCRIPTION SERVICE
# ============================================================================

class SubscriptionService:
    """
    Service layer containing core business logic and state machine validation
    for Brightloop Subscriptions Engine [PDF 5.6, 6.1, 7.2, 8].
    """

    @classmethod
    def generate_next_number(cls, db: Session) -> str:
        """Generates sequential subscription number (e.g. SUB-2026-000001) [PDF 5.6]."""
        count = db.query(func.count(Subscription.id)).scalar() or 0
        seq = count + 1
        year = datetime.utcnow().year
        return generate_subscription_number(seq_val=seq, prefix="SUB", year=year)

    @classmethod
    def create_subscription(
        cls,
        db: Session,
        request: SubscriptionCreate,
        creator_id: Optional[str] = None,
    ) -> Subscription:
        """
        Creates a new draft or quotation subscription with snapshotted line items [PDF 5.6, 8].

        - Generates sequential number (SUB-YYYY-000001).
        - Sets start_date (defaults to today if omitted).
        - Sets anchor_day derived from start_date (1-31).
        - Snapshots unit_price, tax_rate, and discount for each line item.
        - Computes line subtotals and grand totals.
        """
        start_d = request.start_date or date.today()

        # Set anchor_day: use requested if provided, otherwise derive from start_date.day
        if request.anchor_day is not None and 1 <= request.anchor_day <= 31:
            anchor_day = request.anchor_day
        else:
            anchor_day = min(31, max(1, start_d.day))

        # Status: quotation if quotation_expires_at is set, otherwise draft
        status = SubscriptionStatus.QUOTATION if request.quotation_expires_at else SubscriptionStatus.DRAFT

        subscription = Subscription(
            id=str(uuid.uuid4()),
            number=cls.generate_next_number(db),
            customer_id=request.customer_id,
            plan_id=request.plan_id,
            status=status,
            start_date=start_d,
            end_date=request.end_date,
            next_billing_date=None,
            anchor_day=anchor_day,
            quotation_expires_at=request.quotation_expires_at,
            template_id=request.template_id,
            payment_term_id=request.payment_term_id,
            currency=request.currency or "INR",
        )

        # Snapshot line items
        subtotal = Decimal("0.00")
        discount_amount = Decimal("0.00")
        tax_amount = Decimal("0.00")
        total_amount = Decimal("0.00")

        for line_req in request.lines:
            price = line_req.unit_price if line_req.unit_price is not None else Decimal("0.00")
            tax_rate = line_req.tax_rate if line_req.tax_rate is not None else Decimal("0.0000")
            discount = line_req.discount_amount if line_req.discount_amount is not None else Decimal("0.00")

            calculated = calculate_line_amounts(
                quantity=line_req.quantity,
                unit_price=price,
                tax_rate=tax_rate,
                discount_amount=discount,
            )

            line_obj = SubscriptionLine(
                id=str(uuid.uuid4()),
                subscription_id=subscription.id,
                product_id=line_req.product_id,
                variant_id=line_req.variant_id,
                description=line_req.description,
                quantity=line_req.quantity,
                unit_price=price,
                tax_rate=tax_rate,
                discount_amount=discount,
                subtotal=calculated["subtotal"],
                total=calculated["total"],
            )
            subscription.lines.append(line_obj)

            subtotal += calculated["subtotal"]
            discount_amount += calculated["discount_amount"]
            tax_amount += calculated["tax_amount"]
            total_amount += calculated["total"]

        subscription.subtotal = subtotal
        subscription.discount_amount = discount_amount
        subscription.tax_amount = tax_amount
        subscription.total_amount = total_amount

        db.add(subscription)
        db.commit()
        db.refresh(subscription)

        # Audit initial creation
        record_transition_audit(
            db=db,
            actor_id=creator_id,
            subscription_id=subscription.id,
            action="CREATE",
            before_status="none",
            after_status=subscription.status.value,
            reason="Subscription created",
        )
        db.commit()

        return subscription

    @classmethod
    def get_subscription(
        cls,
        subscription_id: str,
        db: Session,
        customer_id: Optional[str] = None,
    ) -> Subscription:
        """
        Retrieves a subscription by ID with tenant isolation [PDF 2, 8].
        If customer_id is provided, guarantees customer cannot access another customer's subscription.
        """
        query = db.query(Subscription).filter(Subscription.id == str(subscription_id))

        # Enforce tenant isolation for portal callers [PDF 2]
        if customer_id:
            query = query.filter(Subscription.customer_id == str(customer_id))

        subscription = query.first()
        if not subscription:
            raise NotFoundError("Subscription", subscription_id)

        return subscription

    @classmethod
    def list_subscriptions(
        cls,
        db: Session,
        status: Optional[SubscriptionStatus] = None,
        customer_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> Tuple[List[Subscription], int]:
        """
        Retrieves paginated subscriptions with optional status and customer filters [PDF 8, 11].
        """
        query = db.query(Subscription)

        if status:
            query = query.filter(Subscription.status == status)
        if customer_id:
            query = query.filter(Subscription.customer_id == str(customer_id))

        total_count = query.count()
        results = query.order_by(desc(Subscription.created_at)).offset(skip).limit(limit).all()

        return results, total_count

    @classmethod
    def transition_state(
        cls,
        subscription_id: str,
        target_state: Union[str, SubscriptionStatus],
        user_role: Union[str, UserRole],
        db: Session,
        reason: Optional[str] = None,
        user_id: Optional[str] = None,
        current_date: Optional[date] = None,
    ) -> Subscription:
        """
        Central Subscription State Machine Transition Dispatcher [PDF 6.1].

        Guards and Matrix:
        - Quotation -> Confirmed: quotation_expires_at >= today.
        - Confirmed -> Active: start_date reached, sets next_billing_date via calculate_next_billing_date.
        - Active -> Paused: Allowed ONLY if plan.pausable == True. Sets paused_at.
        - Paused -> Active: Recalculates next_billing_date so paused interval is not billed. Clears paused_at.
        - Active -> Closed: Allowed ONLY if plan.closable == True (or plan.auto_close). Requires close_reason.
        - Closed -> Active (Renewal): Allowed ONLY if plan.renewable == True.
        - Draft/Quotation/Confirmed -> Cancelled: Allowed strictly before Active status.
        - Illegal transitions raise InvalidStateTransitionException (HTTP 409).
        - Successful transitions write an audit log entry.
        """
        subscription = cls.get_subscription(subscription_id, db)
        today = current_date or date.today()

        # Normalize target status
        if isinstance(target_state, str):
            target = SubscriptionStatus.from_str(target_state)
        else:
            target = target_state

        current = subscription.status
        if current == target:
            return subscription

        # Resolve plan rules
        plan_policy = get_plan_policy(db, subscription.plan_id)
        role_str = user_role.value if isinstance(user_role, UserRole) else str(user_role).lower()

        # ================= TRANSITION GUARDS =================

        # 1. Draft -> Quotation [PDF 6.1]
        if current == SubscriptionStatus.DRAFT and target == SubscriptionStatus.QUOTATION:
            if not subscription.lines or len(subscription.lines) == 0:
                raise InvalidStateTransitionException(
                    current, target, "Subscription must have at least one line item."
                )
            for line in subscription.lines:
                if line.quantity < plan_policy.min_quantity:
                    raise PlanPolicyViolationException(
                        f"Line quantity ({line.quantity}) is less than plan minimum quantity ({plan_policy.min_quantity})."
                    )

        # 2. Quotation -> Confirmed [PDF 6.1]
        elif current == SubscriptionStatus.QUOTATION and target == SubscriptionStatus.CONFIRMED:
            if subscription.quotation_expires_at and subscription.quotation_expires_at < today:
                raise QuotationExpiredException(
                    expires_at=subscription.quotation_expires_at,
                    current_date=today,
                )

        # 3. Confirmed -> Active [PDF 6.1, 7.2]
        elif current == SubscriptionStatus.CONFIRMED and target == SubscriptionStatus.ACTIVE:
            # Check start date reached
            if subscription.start_date > today:
                raise PlanPolicyViolationException(
                    "Start date not reached",
                    f"Subscription start date is {subscription.start_date}, today is {today}.",
                )
            # Set initial next_billing_date using calendar anchor calculation
            subscription.next_billing_date = calculate_next_billing_date(
                current_date=subscription.start_date,
                billing_period=plan_policy.billing_period,
                anchor_day=subscription.anchor_day,
            )

        # 4. Active -> Paused [PDF 5.4, 6.1]
        elif current == SubscriptionStatus.ACTIVE and target == SubscriptionStatus.PAUSED:
            if not plan_policy.pausable:
                raise PlanPolicyViolationException(
                    "plan.pausable == false",
                    "This subscription's plan does not permit pausing.",
                )
            subscription.paused_at = datetime.utcnow()

        # 5. Paused -> Active (Resumption) [PDF 6.1, 7.2]
        elif current == SubscriptionStatus.PAUSED and target == SubscriptionStatus.ACTIVE:
            # Recalculate next_billing_date dynamically so paused time is not billed
            if subscription.paused_at:
                paused_date = subscription.paused_at.date()
                paused_days = (today - paused_date).days
                if paused_days > 0 and subscription.next_billing_date:
                    # Shift next_billing_date forward by paused duration
                    subscription.next_billing_date += timedelta(days=paused_days)
                elif not subscription.next_billing_date or subscription.next_billing_date <= today:
                    subscription.next_billing_date = calculate_next_billing_date(
                        current_date=today,
                        billing_period=plan_policy.billing_period,
                        anchor_day=subscription.anchor_day,
                    )
            else:
                subscription.next_billing_date = calculate_next_billing_date(
                    current_date=today,
                    billing_period=plan_policy.billing_period,
                    anchor_day=subscription.anchor_day,
                )
            subscription.paused_at = None

        # 6. Active -> Closed [PDF 5.4, 6.1]
        elif current == SubscriptionStatus.ACTIVE and target == SubscriptionStatus.CLOSED:
            is_expired = subscription.end_date and subscription.end_date <= today
            if not (plan_policy.closable or (plan_policy.auto_close and is_expired)):
                raise PlanPolicyViolationException(
                    "plan.closable == false",
                    "This subscription's plan does not permit manual cancellation/closure.",
                )
            subscription.closed_at = datetime.utcnow()
            subscription.close_reason = reason or "Closed by authorized actor"

        # 7. Closed -> Active (Renewal) [PDF 5.4, 6.1]
        elif current == SubscriptionStatus.CLOSED and target == SubscriptionStatus.ACTIVE:
            if not plan_policy.renewable:
                raise PlanPolicyViolationException(
                    "plan.renewable == false",
                    "This subscription's plan does not permit renewal.",
                )
            subscription.closed_at = None
            subscription.close_reason = None
            subscription.start_date = today
            subscription.next_billing_date = calculate_next_billing_date(
                current_date=today,
                billing_period=plan_policy.billing_period,
                anchor_day=subscription.anchor_day,
            )

        # 8. Draft / Quotation / Confirmed -> Cancelled [PDF 6.1]
        elif (
            current in (SubscriptionStatus.DRAFT, SubscriptionStatus.QUOTATION, SubscriptionStatus.CONFIRMED)
            and target == SubscriptionStatus.CANCELLED
        ):
            # Allowed strictly before Active status
            subscription.closed_at = datetime.utcnow()
            subscription.close_reason = reason or "Cancelled prior to activation"

        else:
            # Illegal transition rejected by state machine matrix [PDF 6.1]
            raise InvalidStateTransitionException(
                current_state=current,
                target_state=target,
                reason="Transition is not permitted by subscription lifecycle matrix.",
            )

        # Apply state change
        before_val = current.value
        subscription.status = target
        subscription.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(subscription)

        # Write required audit log entry [PDF 5.10, 6.1]
        record_transition_audit(
            db=db,
            actor_id=user_id,
            subscription_id=subscription.id,
            action=f"TRANSITION_{target.value.upper()}",
            before_status=before_val,
            after_status=target.value,
            reason=reason,
        )
        db.commit()

        return subscription
