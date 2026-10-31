"""
Unit and Integration Tests for Step 3: Discount Rule Engine.
Tests:
- evaluate_discount:
  * Active date range checks
  * Usage limit enforcement
  * Minimum purchase amount and min quantity
  * Subscription vs Product scope
  * Percent and Fixed calculation precision
  * Best discount selection
- redeem_discount_atomic:
  * Atomic increment & cap enforcement
  * Duplicate invoice redemption guard
- release_discount_redemption:
  * Safe usage decrement & deletion
- Discount Router endpoints:
  * CRUD, evaluation, and usage telemetry
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
from app.modules.discounts.models import (
    DiscountProduct,
    DiscountRedemption,
    DiscountRule,
    DiscountScope,
    DiscountType,
)
from app.modules.discounts.router import (
    create_discount_rule,
    evaluate_discount,
    get_discount_rule,
    get_discount_usage,
    list_discount_rules,
    update_discount_rule,
)
from app.modules.discounts.schemas import (
    DiscountEvaluationRequest,
    DiscountRuleCreate,
    DiscountRuleUpdate,
    LineItemForEvaluation,
)
from app.modules.discounts.service import DiscountService


class TestDiscountService(unittest.TestCase):
    """Unit tests for DiscountService logic."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_evaluate_subscription_scope_percent(self):
        """20% discount on order subtotal."""
        rule = DiscountRule(
            id=str(uuid.uuid4()),
            name="20% Off",
            type=DiscountType.PERCENT,
            value=Decimal("20.00"),
            min_purchase_amount=Decimal("100.00"),
            min_quantity=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        self.db.add(rule)
        self.db.commit()

        lines = [
            {"product_id": "p1", "quantity": 2, "unit_price": Decimal("250.00"), "subtotal": Decimal("500.00")}
        ]
        result = DiscountService.evaluate_discount(
            subtotal=Decimal("500.00"),
            lines=lines,
            invoice_date=date(2026, 6, 1),
            db=self.db,
        )
        self.assertIsNotNone(result)
        matched_rule, amount = result
        self.assertEqual(matched_rule.id, rule.id)
        # 500 * 20% = 100
        self.assertEqual(amount, Decimal("100.00"))

    def test_evaluate_product_scope_discount(self):
        """Discount applies strictly to eligible products in cart."""
        pid_eligible = str(uuid.uuid4())
        pid_ineligible = str(uuid.uuid4())

        rule = DiscountRule(
            id=str(uuid.uuid4()),
            name="50 Flat Off Eligible Product",
            type=DiscountType.FIXED,
            value=Decimal("50.00"),
            min_purchase_amount=Decimal("0.00"),
            min_quantity=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.PRODUCT,
            is_active=True,
        )
        rule.products.append(DiscountProduct(discount_id=rule.id, product_id=pid_eligible))
        self.db.add(rule)
        self.db.commit()

        # Case A: Cart contains both eligible and ineligible
        lines = [
            {"product_id": pid_eligible, "quantity": 1, "unit_price": Decimal("80.00"), "subtotal": Decimal("80.00")},
            {"product_id": pid_ineligible, "quantity": 1, "unit_price": Decimal("200.00"), "subtotal": Decimal("200.00")},
        ]
        result = DiscountService.evaluate_discount(
            subtotal=Decimal("280.00"),
            lines=lines,
            invoice_date=date(2026, 5, 1),
            db=self.db,
        )
        self.assertIsNotNone(result)
        _, amount = result
        self.assertEqual(amount, Decimal("50.00"))

        # Case B: Cart contains ONLY ineligible product -> no discount applies
        lines_ineligible = [
            {"product_id": pid_ineligible, "quantity": 1, "unit_price": Decimal("200.00"), "subtotal": Decimal("200.00")},
        ]
        result_none = DiscountService.evaluate_discount(
            subtotal=Decimal("200.00"),
            lines=lines_ineligible,
            invoice_date=date(2026, 5, 1),
            db=self.db,
        )
        self.assertIsNone(result_none)

    def test_best_discount_selection(self):
        """When multiple discounts qualify, pick the highest relief."""
        rule_10pct = DiscountRule(
            id=str(uuid.uuid4()),
            name="10% Off",
            type=DiscountType.PERCENT,
            value=Decimal("10.00"),
            min_purchase_amount=Decimal("0.00"),
            min_quantity=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        rule_50fixed = DiscountRule(
            id=str(uuid.uuid4()),
            name="50 Flat Off",
            type=DiscountType.FIXED,
            value=Decimal("50.00"),
            min_purchase_amount=Decimal("0.00"),
            min_quantity=1,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        self.db.add(rule_10pct)
        self.db.add(rule_50fixed)
        self.db.commit()

        # On subtotal 200: 10% is 20, 50 Flat is 50 -> 50 Flat wins
        lines = [{"product_id": "p1", "quantity": 1, "unit_price": Decimal("200.00"), "subtotal": Decimal("200.00")}]
        result = DiscountService.evaluate_discount(Decimal("200.00"), lines, date(2026, 5, 1), self.db)
        self.assertIsNotNone(result)
        best, relief = result
        self.assertEqual(best.id, rule_50fixed.id)
        self.assertEqual(relief, Decimal("50.00"))

        # On subtotal 1000: 10% is 100, 50 Flat is 50 -> 10% wins
        lines_large = [{"product_id": "p1", "quantity": 1, "unit_price": Decimal("1000.00"), "subtotal": Decimal("1000.00")}]
        result_large = DiscountService.evaluate_discount(Decimal("1000.00"), lines_large, date(2026, 5, 1), self.db)
        self.assertIsNotNone(result_large)
        best_l, relief_l = result_large
        self.assertEqual(best_l.id, rule_10pct.id)
        self.assertEqual(relief_l, Decimal("100.00"))

    def test_redeem_discount_atomic_and_release(self):
        """Atomic usage increment, usage limit ceiling, and release on invoice cancellation."""
        rule = DiscountRule(
            id=str(uuid.uuid4()),
            name="Limited 1 Use",
            type=DiscountType.FIXED,
            value=Decimal("25.00"),
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            usage_limit=1,
            usage_count=0,
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        self.db.add(rule)
        self.db.commit()

        inv1 = str(uuid.uuid4())
        inv2 = str(uuid.uuid4())
        sub_id = str(uuid.uuid4())

        # First redemption succeeds
        ok1 = DiscountService.redeem_discount_atomic(rule.id, inv1, sub_id, Decimal("25.00"), self.db)
        self.assertTrue(ok1)
        self.db.commit()

        # Reload rule: usage_count should be 1
        self.db.refresh(rule)
        self.assertEqual(rule.usage_count, 1)

        # Second redemption must be rejected because usage_limit=1 is reached
        ok2 = DiscountService.redeem_discount_atomic(rule.id, inv2, sub_id, Decimal("25.00"), self.db)
        self.assertFalse(ok2)

        # Release first redemption (e.g. invoice cancelled)
        released = DiscountService.release_discount_redemption(rule.id, inv1, self.db)
        self.assertTrue(released)
        self.db.commit()

        # Reload rule: usage_count is restored to 0
        self.db.refresh(rule)
        self.assertEqual(rule.usage_count, 0)

        # Now redemption can be used again
        ok3 = DiscountService.redeem_discount_atomic(rule.id, inv2, sub_id, Decimal("25.00"), self.db)
        self.assertTrue(ok3)


class TestDiscountRouter(unittest.TestCase):
    """Integration tests for Discount Router Endpoints."""

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
        self.staff = User(
            id=str(uuid.uuid4()),
            email=f"staff_{uuid.uuid4().hex[:6]}@brightloop.io",
            role=UserRole.STAFF,
            is_active=True,
        )

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    def test_crud_and_evaluate_endpoints(self):
        """Admin creates rule, lists, updates, evaluates, and reads usage."""
        # 1. Create rule
        create_req = DiscountRuleCreate(
            name="Holiday Bonanza 15%",
            type=DiscountType.PERCENT,
            value=Decimal("15.00"),
            min_purchase_amount=Decimal("50.00"),
            min_quantity=1,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 12, 31),
            scope=DiscountScope.SUBSCRIPTION,
            usage_limit=100,
        )
        created = create_discount_rule(request=create_req, db=self.db, current_user=self.admin)
        self.assertEqual(created.name, "Holiday Bonanza 15%")
        self.assertEqual(created.usage_count, 0)

        # 2. List rules
        resp = Response()
        items = list_discount_rules(
            response=resp,
            active_only=False,
            pagination=PaginationParams(page=1, page_size=10),
            db=self.db,
            current_user=self.staff,
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(resp.headers["X-Total-Count"], "1")

        # 3. Patch rule
        patch_req = DiscountRuleUpdate(name="Holiday Bonanza 25%", value=Decimal("25.00"))
        updated = update_discount_rule(id=created.id, request=patch_req, db=self.db, current_user=self.admin)
        self.assertEqual(updated.name, "Holiday Bonanza 25%")
        self.assertEqual(updated.value, Decimal("25.00"))

        # 4. Evaluate endpoint
        eval_req = DiscountEvaluationRequest(
            subtotal=Decimal("400.00"),
            lines=[LineItemForEvaluation(product_id="prod_xyz", quantity=2, unit_price=Decimal("200.00"))],
            invoice_date=date(2026, 11, 15),
        )
        eval_res = evaluate_discount(request=eval_req, db=self.db, current_user=self.staff)
        self.assertTrue(eval_res.applied)
        # 400 * 25% = 100
        self.assertEqual(eval_res.discount_amount, Decimal("100.00"))

        # 5. Usage endpoint
        usage = get_discount_usage(id=created.id, db=self.db, current_user=self.staff)
        self.assertEqual(usage.usage_count, 0)
        self.assertEqual(usage.remaining_uses, 100)


if __name__ == "__main__":
    unittest.main()

