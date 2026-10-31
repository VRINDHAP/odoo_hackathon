"""
Unit & Integration Tests for BE-4.1 & BE-4.2 (Discounts Engine & Atomic Usage) [PDF 5.8, 7.3, 8].
"""
from datetime import date, timedelta
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.discounts.models import DiscountRule, DiscountScope, DiscountType
from app.modules.discounts.service import DiscountService

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(DiscountRule).delete()
        db.query(User).filter(User.email.like("disctest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_discount_creation_and_listing():
    """Verify Admin can create and list discounts [PDF 5.8, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="disctest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        token = create_access_token(user_id=admin.id, role=admin.role.value)

        # Create percentage discount
        today = date.today()
        res = client.post(
            "/api/v1/discounts",
            json={
                "name": "BLACKFRIDAY20",
                "type": "percent",
                "value": "20.00",
                "min_purchase_amount": "50.00",
                "min_quantity": 1,
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=30)).isoformat(),
                "usage_limit": 100,
                "scope": "subscription",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "BLACKFRIDAY20"
        assert float(data["value"]) == 20.0

        # List discounts
        res = client.get("/api/v1/discounts", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert len(res.json()) >= 1
    finally:
        db.close()


def test_discount_evaluation_picks_highest_relief():
    """Verify evaluator picks single best discount yielding highest relief [PDF 7.3]."""
    db = SessionLocal()
    try:
        today = date.today()
        # 10% off
        r1 = DiscountRule(
            name="10PCT",
            type=DiscountType.PERCENT,
            value=Decimal("10.00"),
            min_quantity=1,
            start_date=today,
            end_date=today + timedelta(days=30),
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        # 50 fixed off
        r2 = DiscountRule(
            name="50FLAT",
            type=DiscountType.FIXED,
            value=Decimal("50.00"),
            min_quantity=1,
            start_date=today,
            end_date=today + timedelta(days=30),
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        db.add_all([r1, r2])
        db.commit()

        # Subtotal 1000: 10% is 100 relief vs 50 flat relief -> 10PCT should win
        res1 = DiscountService.evaluate_discount(
            subtotal=Decimal("1000.00"),
            lines=[{"product_id": "p1", "quantity": 1, "subtotal": "1000.00"}],
            invoice_date=today,
            db=db,
        )
        assert res1 is not None
        best_rule, relief = res1
        assert best_rule.name == "10PCT"
        assert relief == Decimal("100.00")

        # Subtotal 100: 10% is 10 relief vs 50 flat relief -> 50FLAT should win
        res2 = DiscountService.evaluate_discount(
            subtotal=Decimal("100.00"),
            lines=[{"product_id": "p1", "quantity": 1, "subtotal": "100.00"}],
            invoice_date=today,
            db=db,
        )
        assert res2 is not None
        best_rule2, relief2 = res2
        assert best_rule2.name == "50FLAT"
        assert relief2 == Decimal("50.00")
    finally:
        db.close()


def test_atomic_discount_usage_counter():
    """Verify atomic usage increment blocks redemptions exceeding usage_limit [PDF 5.8, 7.3]."""
    db = SessionLocal()
    try:
        today = date.today()
        rule = DiscountRule(
            name="LIMITED1",
            type=DiscountType.FIXED,
            value=Decimal("15.00"),
            start_date=today,
            end_date=today + timedelta(days=30),
            usage_limit=1,
            usage_count=0,
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)

        # First redemption succeeds
        ok = DiscountService.redeem_discount_atomic(
            discount_id=rule.id,
            invoice_id="inv-fake-1",
            subscription_id=None,
            amount=Decimal("15.00"),
            db=db,
        )
        assert ok is True

        # Second redemption is rejected (usage_limit = 1 reached)
        ok2 = DiscountService.redeem_discount_atomic(
            discount_id=rule.id,
            invoice_id="inv-fake-2",
            subscription_id=None,
            amount=Decimal("15.00"),
            db=db,
        )
        assert ok2 is False
    finally:
        db.close()
