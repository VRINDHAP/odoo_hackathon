"""
Unit & Integration Tests for BE-2.2 (Subscription Plans with Behavior Flags) [PDF 5.2, 8, 9].
"""
from datetime import datetime, timedelta
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.errors import ValidationError
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.plans.service import PlanService

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(Plan).delete()
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("plantest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_plan_creation_admin_only():
    """Verify plan creation is strictly restricted to Admin (HTTP 403 for Staff/Customer) [PDF 2, 5.2, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="plantest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="plantest_staff@brightloop.io",
            password_hash=hash_password("StaffPass#2026"),
            role=UserRole.STAFF,
            is_active=True,
        )
        db.add_all([admin, staff])
        db.commit()
        db.refresh(admin)
        db.refresh(staff)

        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        staff_token = create_access_token(user_id=staff.id, role=staff.role.value)
    finally:
        db.close()

    payload = {
        "name": "Enterprise Annual",
        "price": "12000.00",
        "billing_period": "yearly",
        "min_quantity": 5,
        "auto_close": True,
        "closable": False,
        "pausable": False,
        "renewable": True,
    }

    # 1. Staff user should receive HTTP 403 Forbidden
    resp_staff = client.post(
        "/api/v1/plans",
        json=payload,
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_staff.status_code == 403
    assert resp_staff.json()["code"] == "FORBIDDEN"

    # 2. Admin user succeeds with HTTP 201 Created
    resp_admin = client.post(
        "/api/v1/plans",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_admin.status_code == 201
    data = resp_admin.json()
    assert data["name"] == "Enterprise Annual"
    assert Decimal(str(data["price"])) == Decimal("12000.00")
    assert data["billing_period"] == "yearly"
    assert data["min_quantity"] == 5
    assert data["auto_close"] is True
    assert data["closable"] is False
    assert data["pausable"] is False
    assert data["renewable"] is True
    assert data["is_active"] is True


def test_plan_behavior_flag_toggles_and_audit():
    """Verify Admin can toggle behavioral flags and changes are logged to audit trail [PDF 5.2, 9]."""
    db = SessionLocal()
    try:
        admin = User(
            email="plantest_admin2@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        plan = Plan(
            name="Monthly Starter",
            price=Decimal("49.00"),
            billing_period=BillingPeriod.MONTHLY,
            pausable=True,
            closable=True,
            renewable=True,
            is_active=True,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        plan_id = plan.id
    finally:
        db.close()

    # Admin updates pausable to False
    patch_resp = client.patch(
        f"/api/v1/plans/{plan_id}",
        json={"pausable": False, "price": "59.00"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert patch_resp.status_code == 200
    res = patch_resp.json()
    assert res["pausable"] is False
    assert Decimal(str(res["price"])) == Decimal("59.00")

    # Verify audit trail
    db = SessionLocal()
    try:
        audit = db.query(AuditLog).filter(AuditLog.entity_id == plan_id, AuditLog.action == "UPDATE").first()
        assert audit is not None
        assert audit.before_json["pausable"] is True
        assert audit.after_json["pausable"] is False
        assert audit.before_json["price"] == "49.00"
        assert audit.after_json["price"] == "59.00"
    finally:
        db.close()


def test_plan_validation_guards():
    """Verify input validation rejecting inverted date ranges and invalid intervals [PDF 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="plantest_admin3@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
    finally:
        db.close()

    # 1. valid_to preceding valid_from -> 422
    now = datetime.utcnow()
    invalid_date_payload = {
        "name": "Invalid Date Plan",
        "price": "100.00",
        "valid_from": now.isoformat(),
        "valid_to": (now - timedelta(days=5)).isoformat(),
    }
    resp = client.post(
        "/api/v1/plans",
        json=invalid_date_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "VALIDATION_ERROR"

    # 2. Invalid billing cadence -> 422
    invalid_cadence_payload = {
        "name": "Bad Cadence Plan",
        "price": "100.00",
        "billing_period": "biweekly",  # Unsupported
    }
    resp2 = client.post(
        "/api/v1/plans",
        json=invalid_cadence_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 422


def test_inactive_and_expired_plan_validation():
    """Verify PlanService rejects inactive and expired plans from accepting new subscriptions [PDF 5.2]."""
    db = SessionLocal()
    try:
        inactive_plan = Plan(
            name="Deactivated Plan",
            price=Decimal("99.00"),
            billing_period=BillingPeriod.MONTHLY,
            is_active=False,
        )
        expired_plan = Plan(
            name="Expired Beta Plan",
            price=Decimal("99.00"),
            billing_period=BillingPeriod.MONTHLY,
            is_active=True,
            valid_to=datetime.utcnow() - timedelta(days=1),
        )
        active_plan = Plan(
            name="Current Plan",
            price=Decimal("99.00"),
            billing_period=BillingPeriod.MONTHLY,
            is_active=True,
        )
        db.add_all([inactive_plan, expired_plan, active_plan])
        db.commit()
        db.refresh(inactive_plan)
        db.refresh(expired_plan)
        db.refresh(active_plan)

        # Inactive plan raises ValidationError
        with pytest.raises(ValidationError) as exc1:
            PlanService.validate_plan_for_subscription(db, inactive_plan.id)
        assert "inactive" in str(exc1.value)

        # Expired plan raises ValidationError
        with pytest.raises(ValidationError) as exc2:
            PlanService.validate_plan_for_subscription(db, expired_plan.id)
        assert "expired" in str(exc2.value)

        # Active plan validates cleanly
        valid = PlanService.validate_plan_for_subscription(db, active_plan.id)
        assert valid.id == active_plan.id
    finally:
        db.close()


def test_plan_soft_delete_and_listing_filter():
    """Verify soft deleting plan toggles is_active and filters from active list [PDF 5.2]."""
    db = SessionLocal()
    try:
        admin = User(
            email="plantest_admin4@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        plan = Plan(
            name="Deprecating Plan",
            price=Decimal("25.00"),
            billing_period=BillingPeriod.MONTHLY,
            is_active=True,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        plan_id = plan.id
    finally:
        db.close()

    # Soft delete
    del_resp = client.delete(
        f"/api/v1/plans/{plan_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False

    # Listing with active_only=true excludes it
    list_resp = client.get("/api/v1/plans?active_only=true")
    assert list_resp.status_code == 200
    ids = [p["id"] for p in list_resp.json()]
    assert plan_id not in ids
