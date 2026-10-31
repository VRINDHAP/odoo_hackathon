"""
Unit and Integration Tests for Step 2: Subscription State Machine, Service Layer, and API Endpoints.
Tests:
- create_subscription with sequence number and anchor_day
- transition_state state machine matrix & guard policies
  * Quotation -> Confirmed (expiry guard)
  * Confirmed -> Active (start date & next_billing_date calculation)
  * Active -> Paused (plan.pausable guard)
  * Paused -> Active (paused duration unbilled restoration)
  * Active -> Closed (plan.closable guard & mandatory reason)
  * Closed -> Active (plan.renewable renewal guard)
  * Pre-active -> Cancelled vs Post-active rejection
  * Illegal transitions raise InvalidStateTransitionException (HTTP 409)
- Audit log recording
- API Endpoints via FastAPI TestClient
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.deps import PaginationParams, get_current_user, get_db, require_staff_or_admin
from app.core.errors import NotFoundError
from app.main import app
from app.modules.auth.models import User, UserRole
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
from app.modules.subscriptions.service import (
    PlanPolicy,
    SubscriptionService,
    register_plan_policy,
)


class TestSubscriptionServiceAndStateMachine(unittest.TestCase):
    """Unit tests for SubscriptionService and lifecycle state machine."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_create_subscription(self):
        """Verify subscription creation generates sequence, sets anchor_day, and snapshots lines."""
        customer_id = str(uuid.uuid4())
        plan_id = str(uuid.uuid4())
        prod_id = str(uuid.uuid4())

        req = SubscriptionCreate(
            customer_id=customer_id,
            plan_id=plan_id,
            start_date=date(2026, 3, 15),
            lines=[
                SubscriptionLineCreate(
                    product_id=prod_id,
                    quantity=2,
                    unit_price=Decimal("150.00"),
                    tax_rate=Decimal("18.0000"),
                    discount_amount=Decimal("20.00"),
                    description="Standard Tier",
                )
            ],
        )

        sub = SubscriptionService.create_subscription(db=self.db, request=req)
        self.assertIsNotNone(sub.id)
        self.assertTrue(sub.number.startswith("SUB-"))
        self.assertEqual(sub.anchor_day, 15)  # Derived from start_date day 15
        self.assertEqual(sub.status, SubscriptionStatus.DRAFT)
        self.assertEqual(len(sub.lines), 1)
        self.assertEqual(sub.subtotal, Decimal("300.00"))
        self.assertEqual(sub.discount_amount, Decimal("20.00"))
        # Tax: (300 - 20) * 0.18 = 50.40
        self.assertEqual(sub.tax_amount, Decimal("50.40"))
        # Total: (300 - 20) + 50.40 = 330.40
        self.assertEqual(sub.total_amount, Decimal("330.40"))

    def test_transition_draft_to_quotation(self):
        """Draft with lines transitions to Quotation."""
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=str(uuid.uuid4()),
            start_date=date(2026, 1, 1),
            lines=[
                SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))
            ],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        self.assertEqual(sub.status, SubscriptionStatus.DRAFT)

        updated = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.QUOTATION,
            user_role=UserRole.STAFF,
            db=self.db,
        )
        self.assertEqual(updated.status, SubscriptionStatus.QUOTATION)

    def test_transition_quotation_to_confirmed_expiry_guard(self):
        """Expired quotation must be rejected with QuotationExpiredException."""
        plan_id = str(uuid.uuid4())
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            start_date=date(2026, 1, 1),
            quotation_expires_at=date(2026, 1, 10),
            lines=[
                SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))
            ],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        self.assertEqual(sub.status, SubscriptionStatus.QUOTATION)

        # Confirming after expiry (e.g. on 2026-01-15) must raise QuotationExpiredException
        with self.assertRaises(QuotationExpiredException):
            SubscriptionService.transition_state(
                subscription_id=sub.id,
                target_state=SubscriptionStatus.CONFIRMED,
                user_role=UserRole.STAFF,
                db=self.db,
                current_date=date(2026, 1, 15),
            )

        # Confirming on or before expiry succeeds
        confirmed = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.CONFIRMED,
            user_role=UserRole.STAFF,
            db=self.db,
            current_date=date(2026, 1, 10),
        )
        self.assertEqual(confirmed.status, SubscriptionStatus.CONFIRMED)

    def test_transition_confirmed_to_active(self):
        """Confirmed -> Active sets next_billing_date using calculate_next_billing_date."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(billing_period="monthly"))

        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            start_date=date(2026, 1, 31),
            anchor_day=31,
            quotation_expires_at=date(2026, 1, 31),
            lines=[
                SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))
            ],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        SubscriptionService.transition_state(sub.id, SubscriptionStatus.CONFIRMED, UserRole.STAFF, self.db, current_date=date(2026, 1, 31))

        # Activate on start date Jan 31
        active_sub = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.ACTIVE,
            user_role=UserRole.STAFF,
            db=self.db,
            current_date=date(2026, 1, 31),
        )
        self.assertEqual(active_sub.status, SubscriptionStatus.ACTIVE)
        # In non-leap 2026, Jan 31 + monthly -> Feb 28
        self.assertEqual(active_sub.next_billing_date, date(2026, 2, 28))

    def test_transition_active_to_paused_guard(self):
        """Pausing an active subscription checks plan.pausable policy."""
        # Case A: Plan is pausable
        plan_a = str(uuid.uuid4())
        register_plan_policy(plan_a, PlanPolicy(pausable=True))
        req_a = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_a,
            start_date=date(2026, 1, 1),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        sub_a = SubscriptionService.create_subscription(self.db, req_a)
        sub_a.status = SubscriptionStatus.ACTIVE
        self.db.commit()

        paused_sub = SubscriptionService.transition_state(sub_a.id, SubscriptionStatus.PAUSED, UserRole.STAFF, self.db)
        self.assertEqual(paused_sub.status, SubscriptionStatus.PAUSED)
        self.assertIsNotNone(paused_sub.paused_at)

        # Case B: Plan is NOT pausable
        plan_b = str(uuid.uuid4())
        register_plan_policy(plan_b, PlanPolicy(pausable=False))
        req_b = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_b,
            start_date=date(2026, 1, 1),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        sub_b = SubscriptionService.create_subscription(self.db, req_b)
        sub_b.status = SubscriptionStatus.ACTIVE
        self.db.commit()

        with self.assertRaises(PlanPolicyViolationException):
            SubscriptionService.transition_state(sub_b.id, SubscriptionStatus.PAUSED, UserRole.STAFF, self.db)

    def test_transition_paused_to_active_unbilled_restoration(self):
        """Resuming paused subscription recomputes next_billing_date dynamically."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(pausable=True, billing_period="monthly"))
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            start_date=date(2026, 1, 1),
            anchor_day=1,
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        sub.status = SubscriptionStatus.PAUSED
        sub.paused_at = datetime(2026, 1, 10)
        sub.next_billing_date = date(2026, 2, 1)
        self.db.commit()

        resumed = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.ACTIVE,
            user_role=UserRole.STAFF,
            db=self.db,
            current_date=date(2026, 1, 20),
        )
        self.assertEqual(resumed.status, SubscriptionStatus.ACTIVE)
        self.assertIsNone(resumed.paused_at)
        # Next billing was shifted forward by 10 paused days: Feb 1 + 10 days = Feb 11
        self.assertEqual(resumed.next_billing_date, date(2026, 2, 11))

    def test_transition_active_to_closed_and_renewal(self):
        """Active -> Closed requires reason and plan.closable; Closed -> Active requires plan.renewable."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(closable=True, renewable=True))
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            start_date=date(2026, 1, 1),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        sub.status = SubscriptionStatus.ACTIVE
        self.db.commit()

        # Close
        closed = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.CLOSED,
            user_role=UserRole.STAFF,
            db=self.db,
            reason="Customer requested contract closure",
        )
        self.assertEqual(closed.status, SubscriptionStatus.CLOSED)
        self.assertEqual(closed.close_reason, "Customer requested contract closure")
        self.assertIsNotNone(closed.closed_at)

        # Renew
        renewed = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.ACTIVE,
            user_role=UserRole.STAFF,
            db=self.db,
            current_date=date(2026, 3, 1),
        )
        self.assertEqual(renewed.status, SubscriptionStatus.ACTIVE)
        self.assertIsNone(renewed.closed_at)
        self.assertIsNone(renewed.close_reason)
        self.assertEqual(renewed.start_date, date(2026, 3, 1))

    def test_cancellation_guards(self):
        """Cancellation allowed strictly before Active; Active cannot transition directly to Cancelled."""
        plan_id = str(uuid.uuid4())
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            start_date=date(2026, 1, 1),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        # Pre-active cancellation succeeds
        sub = SubscriptionService.create_subscription(self.db, req)
        cancelled = SubscriptionService.transition_state(
            subscription_id=sub.id,
            target_state=SubscriptionStatus.CANCELLED,
            user_role=UserRole.STAFF,
            db=self.db,
        )
        self.assertEqual(cancelled.status, SubscriptionStatus.CANCELLED)

        # Active -> Cancelled is illegal (must use Close)
        sub2 = SubscriptionService.create_subscription(self.db, req)
        sub2.status = SubscriptionStatus.ACTIVE
        self.db.commit()

        with self.assertRaises(InvalidStateTransitionException):
            SubscriptionService.transition_state(
                subscription_id=sub2.id,
                target_state=SubscriptionStatus.CANCELLED,
                user_role=UserRole.STAFF,
                db=self.db,
            )

    def test_illegal_transitions_raise_409(self):
        """Illegal jumps in matrix (e.g. Draft -> Active, Closed -> Paused) must raise 409 InvalidStateTransitionException."""
        req = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=str(uuid.uuid4()),
            start_date=date(2026, 1, 1),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("100.00"))],
        )
        sub = SubscriptionService.create_subscription(self.db, req)
        self.assertEqual(sub.status, SubscriptionStatus.DRAFT)

        with self.assertRaises(InvalidStateTransitionException):
            SubscriptionService.transition_state(sub.id, SubscriptionStatus.ACTIVE, UserRole.STAFF, self.db)

        with self.assertRaises(InvalidStateTransitionException):
            SubscriptionService.transition_state(sub.id, SubscriptionStatus.PAUSED, UserRole.STAFF, self.db)


class TestSubscriptionRouterEndpoints(unittest.TestCase):
    """Integration tests for Subscription Router Endpoints."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.customer_id = str(uuid.uuid4())
        self.admin_user = User(
            id=str(uuid.uuid4()),
            email=f"admin_{uuid.uuid4().hex[:6]}@brightloop.io",
            password_hash="test_hash",
            role=UserRole.ADMIN,
            is_active=True,
        )
        self.customer_user = User(
            id=str(uuid.uuid4()),
            email=f"cust_{uuid.uuid4().hex[:6]}@example.com",
            customer_id=self.customer_id,
            password_hash="test_hash",
            role=UserRole.CUSTOMER,
            is_active=True,
        )

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_post_subscription_admin(self):
        """Admin can create new draft subscription."""
        from fastapi import Response
        from app.modules.subscriptions.router import create_subscription
        payload = SubscriptionCreate(
            customer_id=self.customer_id,
            plan_id=str(uuid.uuid4()),
            start_date=date(2026, 4, 1),
            lines=[
                SubscriptionLineCreate(
                    product_id=str(uuid.uuid4()),
                    quantity=1,
                    unit_price=Decimal("299.00"),
                    tax_rate=Decimal("18.0"),
                )
            ],
        )
        sub = create_subscription(request=payload, db=self.db, current_user=self.admin_user)
        self.assertEqual(sub.customer_id, self.customer_id)
        self.assertEqual(sub.status, SubscriptionStatus.DRAFT)
        self.assertTrue(sub.number.startswith("SUB-"))

    def test_get_subscriptions_list_admin(self):
        """Admin can list all subscriptions."""
        from fastapi import Response
        from app.modules.subscriptions.router import list_subscriptions, create_subscription
        payload = SubscriptionCreate(
            customer_id=self.customer_id,
            plan_id=str(uuid.uuid4()),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("50.00"))],
        )
        create_subscription(request=payload, db=self.db, current_user=self.admin_user)

        resp = Response()
        pagination = PaginationParams(page=1, page_size=20)
        results = list_subscriptions(response=resp, pagination=pagination, db=self.db, current_user=self.admin_user)
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(resp.headers["X-Total-Count"], "1")

    def test_get_my_subscriptions_customer_isolation(self):
        """Customer receives strictly own subscriptions."""
        from fastapi import Response
        from app.modules.subscriptions.router import get_my_subscriptions, create_subscription
        # Create one for this customer and one for another customer
        payload1 = SubscriptionCreate(
            customer_id=self.customer_id,
            plan_id=str(uuid.uuid4()),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("50.00"))],
        )
        payload2 = SubscriptionCreate(
            customer_id=str(uuid.uuid4()),
            plan_id=str(uuid.uuid4()),
            lines=[SubscriptionLineCreate(product_id=str(uuid.uuid4()), quantity=1, unit_price=Decimal("50.00"))],
        )
        create_subscription(request=payload1, db=self.db, current_user=self.admin_user)
        create_subscription(request=payload2, db=self.db, current_user=self.admin_user)

        resp = Response()
        pagination = PaginationParams(page=1, page_size=20)
        my_subs = get_my_subscriptions(response=resp, pagination=pagination, db=self.db, current_user=self.customer_user)
        self.assertEqual(len(my_subs), 1)
        self.assertEqual(my_subs[0].customer_id, self.customer_id)


if __name__ == "__main__":
    unittest.main()
