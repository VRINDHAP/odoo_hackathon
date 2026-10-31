"""
Pytest Suite for Subscriptions Core & State Machine [PDF 5.6, 6.1, 7.2, 8].
Owned by Vrindha.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import pytest

from app.core.errors import ConflictError
from app.modules.subscriptions.exceptions import (
    InvalidStateTransitionException,
    PlanPolicyViolationException,
    QuotationExpiredException,
)
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus
from app.modules.subscriptions.schemas import SubscriptionCreate, SubscriptionLineCreate
from app.modules.subscriptions.service import SubscriptionService
from app.modules.subscriptions.utils import calculate_next_billing_date


# ============================================================================
# 1. BILLING DATE MATH & ANCHOR DAY CLAMPING TESTS [PDF 7.2]
# ============================================================================

def test_month_end_clamping_non_leap_year():
    """Jan 31 clamps to Feb 28 in non-leap year (2025)."""
    next_date = calculate_next_billing_date(
        current_date=date(2025, 1, 31),
        billing_period="monthly",
        anchor_day=31,
    )
    assert next_date == date(2025, 2, 28)


def test_month_end_clamping_leap_year():
    """Jan 31 clamps to Feb 29 in leap year (2024)."""
    next_date = calculate_next_billing_date(
        current_date=date(2024, 1, 31),
        billing_period="monthly",
        anchor_day=31,
    )
    assert next_date == date(2024, 2, 29)


def test_anchor_day_preserved_for_march():
    """Anchor day 31 is preserved when advancing from clamped Feb 28 to March."""
    next_date = calculate_next_billing_date(
        current_date=date(2025, 2, 28),
        billing_period="monthly",
        anchor_day=31,
    )
    assert next_date == date(2025, 3, 31)


def test_daily_and_weekly_intervals():
    """Daily (+1 day) and Weekly (+7 days) interval calculation."""
    daily = calculate_next_billing_date(date(2026, 4, 1), "daily", anchor_day=1)
    assert daily == date(2026, 4, 2)

    weekly = calculate_next_billing_date(date(2026, 4, 1), "weekly", anchor_day=1)
    assert weekly == date(2026, 4, 8)


# ============================================================================
# 2. SUBSCRIPTION STATE MACHINE & POLICY GUARD TESTS [PDF 6.1, 8]
# ============================================================================

def test_valid_lifecycle_transitions(db_session, admin_user, sample_plans):
    """Full lifecycle: Draft -> Quotation -> Confirmed -> Active -> Closed."""
    plan = sample_plans["standard"]
    payload = SubscriptionCreate(
        customer_id=admin_user.id,
        plan_id=plan.id,
        start_date=date.today(),
        lines=[
            SubscriptionLineCreate(
                product_id="prod-host",
                quantity=1,
                unit_price=Decimal("1000.00"),
                tax_rate=Decimal("18.00"),
            )
        ],
    )
    sub = SubscriptionService.create_subscription(db=db_session, request=payload, creator_id=admin_user.id)
    assert sub.status == SubscriptionStatus.DRAFT

    # 1. Draft -> Quotation
    sub = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state="quotation",
        user_role=admin_user.role,
        db=db_session,
        user_id=admin_user.id,
    )
    assert sub.status == SubscriptionStatus.QUOTATION

    # 2. Quotation -> Confirmed
    sub = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state="confirmed",
        user_role=admin_user.role,
        db=db_session,
        user_id=admin_user.id,
    )
    assert sub.status == SubscriptionStatus.CONFIRMED

    # 3. Confirmed -> Active
    sub = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state="active",
        user_role=admin_user.role,
        db=db_session,
        user_id=admin_user.id,
    )
    assert sub.status == SubscriptionStatus.ACTIVE
    assert sub.next_billing_date is not None

    # 4. Active -> Closed
    sub = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state="closed",
        user_role=admin_user.role,
        db=db_session,
        reason="Customer requested termination",
        user_id=admin_user.id,
    )
    assert sub.status == SubscriptionStatus.CLOSED
    assert sub.closed_at is not None


def test_guard_rejects_pausing_when_plan_not_pausable(db_session, admin_user, sample_plans):
    """Strict plan (pausable=False) rejects pause transition with 409 Conflict."""
    strict_plan = sample_plans["strict"]
    payload = SubscriptionCreate(
        customer_id=admin_user.id,
        plan_id=strict_plan.id,
        start_date=date.today(),
        lines=[SubscriptionLineCreate(product_id="prod-lock", quantity=1, unit_price=Decimal("12000.00"))],
    )
    sub = SubscriptionService.create_subscription(db=db_session, request=payload, creator_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "quotation", admin_user.role, db_session, user_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "confirmed", admin_user.role, db_session, user_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "active", admin_user.role, db_session, user_id=admin_user.id)

    with pytest.raises((PlanPolicyViolationException, InvalidStateTransitionException, ConflictError)):
        SubscriptionService.transition_state(sub.id, "paused", admin_user.role, db_session, user_id=admin_user.id)


def test_guard_rejects_closing_when_plan_not_closable(db_session, admin_user, sample_plans):
    """Strict plan (closable=False) rejects early cancellation/closure."""
    strict_plan = sample_plans["strict"]
    payload = SubscriptionCreate(
        customer_id=admin_user.id,
        plan_id=strict_plan.id,
        start_date=date.today(),
        lines=[SubscriptionLineCreate(product_id="prod-lock", quantity=1, unit_price=Decimal("12000.00"))],
    )
    sub = SubscriptionService.create_subscription(db=db_session, request=payload, creator_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "quotation", admin_user.role, db_session, user_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "confirmed", admin_user.role, db_session, user_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "active", admin_user.role, db_session, user_id=admin_user.id)

    with pytest.raises((PlanPolicyViolationException, InvalidStateTransitionException, ConflictError)):
        SubscriptionService.transition_state(sub.id, "closed", admin_user.role, db_session, reason="I want out", user_id=admin_user.id)


def test_rejection_of_illegal_transition(db_session, admin_user, sample_plans):
    """Illegal transitions (e.g. Quotation directly to Paused) are rejected with HTTP 409."""
    plan = sample_plans["standard"]
    payload = SubscriptionCreate(
        customer_id=admin_user.id,
        plan_id=plan.id,
        start_date=date.today(),
        lines=[SubscriptionLineCreate(product_id="prod-1", quantity=1, unit_price=Decimal("500.00"))],
    )
    sub = SubscriptionService.create_subscription(db=db_session, request=payload, creator_id=admin_user.id)
    sub = SubscriptionService.transition_state(sub.id, "quotation", admin_user.role, db_session, user_id=admin_user.id)

    with pytest.raises((InvalidStateTransitionException, ConflictError)):
        SubscriptionService.transition_state(sub.id, "paused", admin_user.role, db_session, user_id=admin_user.id)
