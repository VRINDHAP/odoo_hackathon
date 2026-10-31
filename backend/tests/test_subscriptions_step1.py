"""
Unit and Integration Tests for Vrindha's Step 1: Subscriptions Data Layer and Date Utilities.
Tests:
- Subscriptions & SubscriptionLine ORM models & relationships
- Pydantic validation schemas and serialization
- Date calculation utilities (calculate_next_billing_date) with calendar month-end clamping
"""
import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal
import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.modules.subscriptions.models import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatus,
)
from app.modules.subscriptions.schemas import (
    SubscriptionCreate,
    SubscriptionLineCreate,
    SubscriptionResponse,
    SubscriptionTransitionRequest,
    SubscriptionLineResponse,
)
from app.modules.subscriptions.utils import (
    calculate_next_billing_date,
    calculate_billing_period_range,
    generate_subscription_number,
    calculate_line_amounts,
    calculate_subscription_totals,
)


class TestSubscriptionModelsAndRelations(unittest.TestCase):
    """Test SQLAlchemy ORM Models and Database Mapping."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_create_subscription_with_lines_relationship(self):
        """Verify subscription and child lines can be created and queried through relationship."""
        sub_id = str(uuid.uuid4())
        customer_id = str(uuid.uuid4())
        plan_id = str(uuid.uuid4())
        prod_id1 = str(uuid.uuid4())
        prod_id2 = str(uuid.uuid4())

        sub = Subscription(
            id=sub_id,
            number="SUB-2026-000001",
            customer_id=customer_id,
            plan_id=plan_id,
            status=SubscriptionStatus.DRAFT,
            start_date=date(2026, 1, 1),
            anchor_day=1,
            quotation_expires_at=date(2026, 1, 15),
            subtotal=Decimal("1500.00"),
            tax_amount=Decimal("270.00"),
            discount_amount=Decimal("100.00"),
            total_amount=Decimal("1670.00"),
        )

        line1 = SubscriptionLine(
            subscription_id=sub_id,
            product_id=prod_id1,
            quantity=2,
            unit_price=Decimal("500.00"),
            tax_rate=Decimal("18.0000"),
            discount_amount=Decimal("50.00"),
            subtotal=Decimal("1000.00"),
            total=Decimal("1121.00"),
            description="Service Plan Alpha",
        )

        line2 = SubscriptionLine(
            subscription_id=sub_id,
            product_id=prod_id2,
            quantity=1,
            unit_price=Decimal("500.00"),
            tax_rate=Decimal("18.0000"),
            discount_amount=Decimal("50.00"),
            subtotal=Decimal("500.00"),
            total=Decimal("531.00"),
            description="Add-on Alpha",
        )

        sub.lines = [line1, line2]
        self.db.add(sub)
        self.db.commit()

        # Query back
        loaded_sub = self.db.query(Subscription).filter_by(id=sub_id).one()
        self.assertEqual(loaded_sub.number, "SUB-2026-000001")
        self.assertEqual(loaded_sub.status, SubscriptionStatus.DRAFT)
        self.assertEqual(len(loaded_sub.lines), 2)
        self.assertEqual(loaded_sub.lines[0].subscription_id, sub_id)
        self.assertEqual(loaded_sub.lines[0].subscription, loaded_sub)

        # Test property aliases
        self.assertEqual(loaded_sub.total, Decimal("1670.00"))
        self.assertEqual(loaded_sub.tax_total, Decimal("270.00"))
        self.assertEqual(loaded_sub.discount_total, Decimal("100.00"))
        self.assertEqual(loaded_sub.quote_valid_until, date(2026, 1, 15))

    def test_line_cascade_delete(self):
        """Deleting subscription should delete associated lines (cascade='all, delete-orphan')."""
        sub = Subscription(
            number="SUB-2026-000002",
            customer_id=str(uuid.uuid4()),
            plan_id=str(uuid.uuid4()),
            status=SubscriptionStatus.DRAFT,
            start_date=date(2026, 2, 1),
            anchor_day=1,
        )
        line = SubscriptionLine(
            product_id=str(uuid.uuid4()),
            quantity=1,
            unit_price=Decimal("100.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
        )
        sub.lines.append(line)
        self.db.add(sub)
        self.db.commit()

        sub_id = sub.id
        line_id = line.id

        # Delete parent
        self.db.delete(sub)
        self.db.commit()

        self.assertIsNone(self.db.query(Subscription).filter_by(id=sub_id).first())
        self.assertIsNone(self.db.query(SubscriptionLine).filter_by(id=line_id).first())


class TestDateUtilities(unittest.TestCase):
    """Test calculate_next_billing_date and month-end clamping logic."""

    def test_monthly_month_end_clamping_non_leap_year(self):
        """
        Anchor day 31 starting Jan 31 in 2026 (non-leap year).
        Jan 31 -> Feb 28 (clamped) -> Mar 31 (restored to anchor_day 31).
        """
        anchor_day = 31
        d1 = date(2026, 1, 31)

        d2 = calculate_next_billing_date(d1, "monthly", anchor_day)
        self.assertEqual(d2, date(2026, 2, 28), "Feb in 2026 should clamp to 28")

        d3 = calculate_next_billing_date(d2, "monthly", anchor_day)
        self.assertEqual(d3, date(2026, 3, 31), "March should restore to anchor_day 31")

        d4 = calculate_next_billing_date(d3, "monthly", anchor_day)
        self.assertEqual(d4, date(2026, 4, 30), "April has 30 days, clamp to 30")

        d5 = calculate_next_billing_date(d4, "monthly", anchor_day)
        self.assertEqual(d5, date(2026, 5, 31), "May has 31 days, restore to 31")

    def test_monthly_month_end_clamping_leap_year(self):
        """
        Anchor day 31 in 2024 (leap year).
        Jan 31 -> Feb 29 (clamped) -> Mar 31 (restored).
        """
        anchor_day = 31
        d1 = date(2024, 1, 31)

        d2 = calculate_next_billing_date(d1, "monthly", anchor_day)
        self.assertEqual(d2, date(2024, 2, 29), "Feb in leap year 2024 should clamp to 29")

        d3 = calculate_next_billing_date(d2, "monthly", anchor_day)
        self.assertEqual(d3, date(2024, 3, 31), "March should restore to 31")

    def test_anchor_day_30(self):
        """Anchor day 30: Jan 30 -> Feb 28 -> Mar 30 -> Apr 30."""
        anchor_day = 30
        d1 = date(2026, 1, 30)

        d2 = calculate_next_billing_date(d1, "monthly", anchor_day)
        self.assertEqual(d2, date(2026, 2, 28))

        d3 = calculate_next_billing_date(d2, "monthly", anchor_day)
        self.assertEqual(d3, date(2026, 3, 30))

        d4 = calculate_next_billing_date(d3, "monthly", anchor_day)
        self.assertEqual(d4, date(2026, 4, 30))

    def test_yearly_period_with_leap_year(self):
        """Yearly: Leap day 2024-02-29 -> 2025-02-28 -> 2028-02-29."""
        anchor_day = 29
        d1 = date(2024, 2, 29)

        d2 = calculate_next_billing_date(d1, "yearly", anchor_day)
        self.assertEqual(d2, date(2025, 2, 28), "2025 is non-leap, clamp to 28")

        d3 = calculate_next_billing_date(d2, "yearly", anchor_day)
        self.assertEqual(d3, date(2026, 2, 28))

        # Test advancing from 2027 to 2028 (leap year)
        d_2027 = date(2027, 2, 28)
        d_2028 = calculate_next_billing_date(d_2027, "yearly", anchor_day)
        self.assertEqual(d_2028, date(2028, 2, 29), "2028 is leap year, restored to 29")

    def test_weekly_period(self):
        """Weekly advances strictly by 7 days."""
        d = date(2026, 3, 1)
        next_d = calculate_next_billing_date(d, "weekly", anchor_day=1)
        self.assertEqual(next_d, date(2026, 3, 8))

    def test_daily_period(self):
        """Daily advances strictly by 1 day."""
        d = date(2026, 3, 1)
        next_d = calculate_next_billing_date(d, "daily", anchor_day=1)
        self.assertEqual(next_d, date(2026, 3, 2))

    def test_invalid_anchor_day(self):
        """Anchor day < 1 or > 31 must raise ValueError."""
        with self.assertRaises(ValueError):
            calculate_next_billing_date(date(2026, 1, 1), "monthly", 0)

        with self.assertRaises(ValueError):
            calculate_next_billing_date(date(2026, 1, 1), "monthly", 32)

    def test_invalid_period(self):
        """Invalid period must raise ValueError."""
        with self.assertRaises(ValueError):
            calculate_next_billing_date(date(2026, 1, 1), "hourly", 15)

    def test_generate_subscription_number(self):
        """Subscription number generator formatting."""
        num = generate_subscription_number(123, prefix="SUB", year=2026)
        self.assertEqual(num, "SUB-2026-000123")


class TestSubscriptionSchemas(unittest.TestCase):
    """Test Pydantic Validation Models."""

    def test_subscription_create_valid(self):
        payload = {
            "customer_id": str(uuid.uuid4()),
            "plan_id": str(uuid.uuid4()),
            "start_date": "2026-02-01",
            "anchor_day": 15,
            "lines": [
                {
                    "product_id": str(uuid.uuid4()),
                    "quantity": 2,
                    "unit_price": "99.99",
                }
            ],
        }
        sub_create = SubscriptionCreate(**payload)
        self.assertEqual(sub_create.anchor_day, 15)
        self.assertEqual(len(sub_create.lines), 1)
        self.assertEqual(sub_create.lines[0].quantity, 2)

    def test_subscription_transition_case_insensitive(self):
        """Verify state transition accepts lower, upper, and enum inputs."""
        req1 = SubscriptionTransitionRequest(target="active")
        self.assertEqual(req1.target, SubscriptionStatus.ACTIVE)

        req2 = SubscriptionTransitionRequest(target="CONFIRMED")
        self.assertEqual(req2.target, SubscriptionStatus.CONFIRMED)

        req3 = SubscriptionTransitionRequest(target=SubscriptionStatus.PAUSED)
        self.assertEqual(req3.target, SubscriptionStatus.PAUSED)

    def test_invalid_transition_status(self):
        with self.assertRaises(Exception):
            SubscriptionTransitionRequest(target="flying")


if __name__ == "__main__":
    unittest.main()

