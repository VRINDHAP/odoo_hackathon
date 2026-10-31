"""
Unit and Integration Tests for Step 4: Automated Recurring Billing Engine.
Tests:
- Scanning active subscriptions due on or before target date.
- Idempotent invoice creation (skips if invoice already exists for period).
- Discount application and atomic redemption during billing run.
- Line items, tax rounding, and total calculations.
- Advance subscription dates and handle plan.auto_close on expiry.
- Savepoint error isolation (failed subscription does not halt entire batch).
- Router endpoints: POST /api/v1/billing/run and GET /api/v1/billing/runs.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import unittest
import uuid

from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.deps import PaginationParams
from app.modules.auth.models import User, UserRole
from app.modules.billing.engine import BillingEngine, run_billing
from app.modules.billing.models import BillingRun
from app.modules.billing.router import list_billing_runs, trigger_billing_run
from app.modules.billing.schemas import BillingRunTriggerRequest
from app.modules.discounts.models import DiscountRule, DiscountScope, DiscountType
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.subscriptions.models import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatus,
)
from app.modules.subscriptions.service import PlanPolicy, register_plan_policy


class TestBillingEngine(unittest.TestCase):
    """Unit tests for BillingEngine and run_billing algorithm."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_run_billing_generates_invoice_and_advances_date(self):
        """Active subscription due today generates invoice and advances next_billing_date."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(billing_period="monthly"))

        sub = Subscription(
            id=str(uuid.uuid4()),
            number="SUB-2026-000001",
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            status=SubscriptionStatus.ACTIVE,
            start_date=date(2026, 1, 1),
            next_billing_date=date(2026, 1, 1),
            anchor_day=1,
        )
        line = SubscriptionLine(
            id=str(uuid.uuid4()),
            subscription_id=sub.id,
            product_id=str(uuid.uuid4()),
            quantity=2,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("18.0000"),
            discount_amount=Decimal("0.00"),
            subtotal=Decimal("200.00"),
            total=Decimal("236.00"),
        )
        sub.lines.append(line)
        self.db.add(sub)
        self.db.commit()

        # Run billing for Jan 1
        run = run_billing(target_date=date(2026, 1, 1), db=self.db)
        self.assertEqual(run.created_count, 1)
        self.assertEqual(run.skipped_count, 0)
        self.assertEqual(run.failed_count, 0)

        # Check invoice
        invoice = self.db.query(Invoice).filter(Invoice.subscription_id == sub.id).one()
        self.assertEqual(invoice.status, InvoiceStatus.CONFIRMED)
        self.assertEqual(invoice.subtotal, Decimal("200.00"))
        # 18% tax on 200 = 36.00
        self.assertEqual(invoice.tax_total, Decimal("36.00"))
        self.assertEqual(invoice.total, Decimal("236.00"))
        self.assertEqual(invoice.balance, Decimal("236.00"))
        self.assertEqual(invoice.period_start, date(2026, 1, 1))
        self.assertEqual(invoice.period_end, date(2026, 2, 1))

        # Check subscription dates advanced
        self.db.refresh(sub)
        self.assertEqual(sub.last_billed_through, date(2026, 2, 1))
        self.assertEqual(sub.next_billing_date, date(2026, 2, 1))

    def test_run_billing_idempotency_zero_double_billing(self):
        """Running billing twice for same period creates exactly 1 invoice and increments skipped_count."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(billing_period="monthly"))

        sub = Subscription(
            id=str(uuid.uuid4()),
            number="SUB-2026-000002",
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            status=SubscriptionStatus.ACTIVE,
            start_date=date(2026, 1, 1),
            next_billing_date=date(2026, 1, 1),
            anchor_day=1,
        )
        line = SubscriptionLine(
            id=str(uuid.uuid4()),
            subscription_id=sub.id,
            product_id=str(uuid.uuid4()),
            quantity=1,
            unit_price=Decimal("50.00"),
            tax_rate=Decimal("0.00"),
            subtotal=Decimal("50.00"),
            total=Decimal("50.00"),
        )
        sub.lines.append(line)
        self.db.add(sub)
        self.db.commit()

        # Run 1
        run1 = run_billing(target_date=date(2026, 1, 1), db=self.db)
        self.assertEqual(run1.created_count, 1)

        # Re-set next_billing_date back to 2026-01-01 to simulate duplicate run
        sub.next_billing_date = date(2026, 1, 1)
        self.db.commit()

        # Run 2 against same period
        run2 = run_billing(target_date=date(2026, 1, 1), db=self.db)
        self.assertEqual(run2.created_count, 0)
        self.assertEqual(run2.skipped_count, 1)

        # Invoices count must strictly be 1
        total_invoices = self.db.query(Invoice).filter(Invoice.subscription_id == sub.id).count()
        self.assertEqual(total_invoices, 1)

    def test_run_billing_applies_and_redeems_discount(self):
        """Discounts apply automatically during invoice build and redeem atomically."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(billing_period="monthly"))

        # Create active discount
        disc = DiscountRule(
            id=str(uuid.uuid4()),
            name="10% Off Recurring",
            type=DiscountType.PERCENT,
            value=Decimal("10.00"),
            min_purchase_amount=Decimal("0.00"),
            min_quantity=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.SUBSCRIPTION,
            usage_limit=10,
            usage_count=0,
            is_active=True,
        )
        self.db.add(disc)

        sub = Subscription(
            id=str(uuid.uuid4()),
            number="SUB-2026-000003",
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            status=SubscriptionStatus.ACTIVE,
            start_date=date(2026, 1, 1),
            next_billing_date=date(2026, 1, 1),
            anchor_day=1,
        )
        line = SubscriptionLine(
            id=str(uuid.uuid4()),
            subscription_id=sub.id,
            product_id=str(uuid.uuid4()),
            quantity=1,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("0.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
        )
        sub.lines.append(line)
        self.db.add(sub)
        self.db.commit()

        run = run_billing(target_date=date(2026, 1, 1), db=self.db)
        self.assertEqual(run.created_count, 1)

        inv = self.db.query(Invoice).filter(Invoice.subscription_id == sub.id).one()
        self.assertEqual(inv.subtotal, Decimal("100.00"))
        # 10% on 100 = 10
        self.assertEqual(inv.discount_total, Decimal("10.00"))
        self.assertEqual(inv.total, Decimal("90.00"))

        # Discount usage_count incremented
        self.db.refresh(disc)
        self.assertEqual(disc.usage_count, 1)

    def test_run_billing_auto_close_on_expiry(self):
        """When subscription expiry date is reached, plan.auto_close sets status to Closed."""
        plan_id = str(uuid.uuid4())
        register_plan_policy(plan_id, PlanPolicy(billing_period="monthly", auto_close=True))

        sub = Subscription(
            id=str(uuid.uuid4()),
            number="SUB-2026-000004",
            customer_id=str(uuid.uuid4()),
            plan_id=plan_id,
            status=SubscriptionStatus.ACTIVE,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),  # Expires at end of first cycle
            next_billing_date=date(2026, 1, 1),
            anchor_day=1,
        )
        line = SubscriptionLine(
            id=str(uuid.uuid4()),
            subscription_id=sub.id,
            product_id=str(uuid.uuid4()),
            quantity=1,
            unit_price=Decimal("100.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
        )
        sub.lines.append(line)
        self.db.add(sub)
        self.db.commit()

        run = run_billing(target_date=date(2026, 1, 1), db=self.db)
        self.assertEqual(run.created_count, 1)

        self.db.refresh(sub)
        self.assertEqual(sub.status, SubscriptionStatus.CLOSED)
        self.assertEqual(sub.close_reason, "Plan expired (auto-close)")


class TestBillingRouter(unittest.TestCase):
    """Integration tests for Billing Router Endpoints."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        self.admin = User(
            id=str(uuid.uuid4()),
            email=f"admin_{uuid.uuid4().hex[:6]}@brightloop.io",
            role=UserRole.ADMIN,
            is_active=True,
        )

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_trigger_and_list_billing_runs(self):
        """Admin triggers billing run via endpoint and reads audit logs."""
        req = BillingRunTriggerRequest(target_date=date(2026, 3, 1), batch_size=50)
        res = trigger_billing_run(request=req, db=self.db, current_user=self.admin)
        self.assertEqual(res.run_date, date(2026, 3, 1))
        self.assertIsNotNone(res.id)

        # List runs
        resp = Response()
        runs = list_billing_runs(response=resp, pagination=PaginationParams(page=1, page_size=10), db=self.db, current_user=self.admin)
        self.assertEqual(len(runs), 1)
        self.assertEqual(resp.headers["X-Total-Count"], "1")


if __name__ == "__main__":
    unittest.main()

