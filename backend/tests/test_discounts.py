"""
Pytest Suite for Discount Rule Engine [PDF 5.8, 7.3].
Owned by Vrindha.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
import pytest

from app.modules.discounts.models import DiscountProduct, DiscountRule, DiscountScope, DiscountType
from app.modules.discounts.service import DiscountService


def test_date_expiration_filters_expired_discounts(db_session):
    """Expired discount rules are excluded from evaluation."""
    past_discount = DiscountRule(
        id=str(uuid.uuid4()),
        name="Expired Summer Sale",
        type=DiscountType.PERCENT,
        value=Decimal("20.00"),
        start_date=date(2025, 6, 1),
        end_date=date(2025, 6, 30),
        scope=DiscountScope.SUBSCRIPTION,
        is_active=True,
    )
    db_session.add(past_discount)
    db_session.commit()

    # Evaluate today (2026) -> should find nothing
    result = DiscountService.evaluate_discount(
        subtotal=Decimal("1000.00"),
        lines=[],
        invoice_date=date.today(),
        db=db_session,
    )
    assert result is None


def test_min_purchase_and_quantity_thresholds(db_session):
    """Discounts are not applied if subtotal or quantity thresholds are unmet."""
    rule = DiscountRule(
        id=str(uuid.uuid4()),
        name="Big Spender $500+",
        type=DiscountType.FIXED,
        value=Decimal("50.00"),
        min_purchase_amount=Decimal("500.00"),
        min_quantity=5,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=30),
        scope=DiscountScope.SUBSCRIPTION,
        is_active=True,
    )
    db_session.add(rule)
    db_session.commit()

    # Subtotal $400 (< $500 threshold) -> rejected
    line = type("Line", (), {"product_id": "p1", "quantity": 10, "subtotal": Decimal("400.00")})()
    res1 = DiscountService.evaluate_discount(Decimal("400.00"), [line], date.today(), db_session)
    assert res1 is None

    # Quantity 3 (< 5 threshold) -> rejected
    line2 = type("Line", (), {"product_id": "p1", "quantity": 3, "subtotal": Decimal("600.00")})()
    res2 = DiscountService.evaluate_discount(Decimal("600.00"), [line2], date.today(), db_session)
    assert res2 is None

    # Both met -> applied
    line3 = type("Line", (), {"product_id": "p1", "quantity": 5, "subtotal": Decimal("600.00")})()
    res3 = DiscountService.evaluate_discount(Decimal("600.00"), [line3], date.today(), db_session)
    assert res3 is not None
    matched_rule, discount_amount = res3
    assert matched_rule.id == rule.id
    assert discount_amount == Decimal("50.00")


def test_product_scoped_vs_subscription_scope(db_session):
    """Product-scoped discount applies only against eligible product lines."""
    eligible_product_id = "prod-pro-license"
    ineligible_product_id = "prod-basic-license"

    prod_rule = DiscountRule(
        id=str(uuid.uuid4()),
        name="20% Off Pro Licenses",
        type=DiscountType.PERCENT,
        value=Decimal("20.00"),
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=30),
        scope=DiscountScope.PRODUCT,
        is_active=True,
    )
    db_session.add(prod_rule)
    db_session.flush()

    assoc = DiscountProduct(discount_id=prod_rule.id, product_id=eligible_product_id)
    db_session.add(assoc)
    db_session.commit()

    lines = [
        type("Line", (), {"product_id": eligible_product_id, "quantity": 1, "subtotal": Decimal("200.00")})(),
        type("Line", (), {"product_id": ineligible_product_id, "quantity": 1, "subtotal": Decimal("800.00")})(),
    ]
    # Total subtotal is 1000.00, but only 200.00 is eligible -> 20% of 200 = 40.00
    res = DiscountService.evaluate_discount(Decimal("1000.00"), lines, date.today(), db_session)
    assert res is not None
    rule_matched, discount_val = res
    assert rule_matched.id == prod_rule.id
    assert discount_val == Decimal("40.00")


def test_atomic_usage_cap_enforcement(db_session):
    """Atomic redemption increments counter and blocks redemptions exceeding usage_limit."""
    rule = DiscountRule(
        id=str(uuid.uuid4()),
        name="Limited 2-Use Voucher",
        type=DiscountType.FIXED,
        value=Decimal("10.00"),
        usage_limit=2,
        usage_count=0,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=30),
        scope=DiscountScope.SUBSCRIPTION,
        is_active=True,
    )
    db_session.add(rule)
    db_session.commit()

    inv1_id = str(uuid.uuid4())
    inv2_id = str(uuid.uuid4())
    inv3_id = str(uuid.uuid4())
    sub_id = str(uuid.uuid4())

    # 1st redemption -> success
    ok1 = DiscountService.redeem_discount_atomic(rule.id, inv1_id, sub_id, Decimal("10.00"), db_session)
    assert ok1 is True

    # 2nd redemption -> success
    ok2 = DiscountService.redeem_discount_atomic(rule.id, inv2_id, sub_id, Decimal("10.00"), db_session)
    assert ok2 is True

    # 3rd redemption -> rejected (usage cap reached)
    ok3 = DiscountService.redeem_discount_atomic(rule.id, inv3_id, sub_id, Decimal("10.00"), db_session)
    assert ok3 is False

    db_session.refresh(rule)
    assert rule.usage_count == 2

