"""
Pytest Suite for Automated Recurring Billing Engine [PDF 5.9, 7.2, 8].
Owned by Vrindha.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
import pytest

from app.modules.billing.engine import BillingEngine, run_billing
from app.modules.invoices.models import Invoice
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus


def test_billing_engine_processes_due_subscription(db_session, admin_user, sample_plans):
    """Due active subscription generates invoice and advances billing date."""
    plan = sample_plans["standard"]
    target_date = date.today()

    sub = Subscription(
        id=str(uuid.uuid4()),
        number="SUB-TEST-BILL-1",
        customer_id=admin_user.id,
        plan_id=plan.id,
        status=SubscriptionStatus.ACTIVE,
        start_date=target_date - timedelta(days=30),
        next_billing_date=target_date,
        anchor_day=target_date.day,
        currency="INR",
        total_amount=Decimal("1000.00"),
    )
    line = SubscriptionLine(
        id=str(uuid.uuid4()),
        subscription_id=sub.id,
        product_id="prod-cloud",
        quantity=1,
        unit_price=Decimal("1000.00"),
        subtotal=Decimal("1000.00"),
        total=Decimal("1000.00"),
    )
    db_session.add_all([sub, line])
    db_session.commit()

    run = run_billing(target_date=target_date, db=db_session)

    assert run.created_count == 1
    assert run.skipped_count == 0
    assert run.failed_count == 0

    # Verify invoice was created
    inv = db_session.query(Invoice).filter(Invoice.subscription_id == sub.id).first()
    assert inv is not None
    assert inv.total == Decimal("1000.00")
    assert len(inv.lines) == 1

    # Verify subscription dates advanced
    db_session.refresh(sub)
    assert sub.next_billing_date > target_date
    assert sub.last_billed_through is not None


def test_billing_engine_strict_idempotency(db_session, admin_user, sample_plans):
    """Running billing engine twice on the same day safely skips already-billed periods."""
    plan = sample_plans["standard"]
    target_date = date.today()

    sub = Subscription(
        id=str(uuid.uuid4()),
        number="SUB-IDEM-01",
        customer_id=admin_user.id,
        plan_id=plan.id,
        status=SubscriptionStatus.ACTIVE,
        start_date=target_date,
        next_billing_date=target_date,
        anchor_day=target_date.day,
        total_amount=Decimal("500.00"),
    )
    db_session.add(sub)
    db_session.commit()

    # Run 1: Creates invoice
    run1 = run_billing(target_date=target_date, db=db_session)
    assert run1.created_count == 1

    # Reset next_billing_date to target_date to simulate re-running against the same period
    sub.next_billing_date = target_date
    db_session.commit()

    # Run 2: Skips duplicate period
    run2 = run_billing(target_date=target_date, db=db_session)
    assert run2.created_count == 0
    assert run2.skipped_count == 1


def test_billing_engine_autoclose_on_plan_expiration(db_session, admin_user, sample_plans):
    """Subscription reaching expiration date auto-closes if plan.auto_close is True."""
    plan = sample_plans["autoclose"]
    target_date = date.today()

    sub = Subscription(
        id=str(uuid.uuid4()),
        number="SUB-EXP-AUTO",
        customer_id=admin_user.id,
        plan_id=plan.id,
        status=SubscriptionStatus.ACTIVE,
        start_date=target_date - timedelta(days=30),
        end_date=target_date,
        next_billing_date=target_date,
        anchor_day=target_date.day,
        total_amount=Decimal("500.00"),
    )
    db_session.add(sub)
    db_session.commit()

    run = run_billing(target_date=target_date, db=db_session)
    assert run.created_count == 1

    db_session.refresh(sub)
    assert sub.status == SubscriptionStatus.CLOSED
    assert sub.closed_at is not None

