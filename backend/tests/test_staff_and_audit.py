"""
Unit & Integration Tests for BE-1.6 (Staff Provisioning & Last-Admin Guard)
and BE-1.7 (Audit Logging Interceptor) [PDF 2, 5.10, 8, 9].
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.audit.service import AuditService

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("stafftest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_staff_creation_requires_admin_role():
    """Verify staff creation is restricted strictly to Admins (HTTP 403 for Customer/Staff) [PDF 2, 8]."""
    db = SessionLocal()
    try:
        # Create a Customer and an Admin user
        customer = User(
            email="stafftest_customer@brightloop.io",
            password_hash=hash_password("Pass#12345"),
            role=UserRole.CUSTOMER,
            is_active=True,
        )
        admin = User(
            email="stafftest_admin@brightloop.io",
            password_hash=hash_password("Pass#12345"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add_all([customer, admin])
        db.commit()
        db.refresh(customer)
        db.refresh(admin)

        cust_token = create_access_token(user_id=customer.id, role=customer.role.value)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
    finally:
        db.close()

    staff_payload = {
        "email": "stafftest_newrep@brightloop.io",
        "password": "RepPassword#2026",
        "role": "staff",
    }

    # 1. Anonymous caller receives 401
    res_anon = client.post("/api/v1/users/staff", json=staff_payload)
    assert res_anon.status_code == 401

    # 2. Customer receives 403 Forbidden [PDF 2]
    res_cust = client.post(
        "/api/v1/users/staff",
        json=staff_payload,
        headers={"Authorization": f"Bearer {cust_token}"},
    )
    assert res_cust.status_code == 403

    # 3. Admin successfully provisions staff account
    res_admin = client.post(
        "/api/v1/users/staff",
        json=staff_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res_admin.status_code == 201
    data = res_admin.json()
    assert data["email"] == staff_payload["email"]
    assert data["role"] == "staff"


def test_last_admin_demotion_guard():
    """Verify rule preventing deletion/demotion of last admin [PDF 9]."""
    db = SessionLocal()
    try:
        # Clean up any other admins to ensure exactly one admin exists for this test
        db.query(User).filter(User.role == UserRole.ADMIN).delete()
        db.commit()

        solo_admin = User(
            email="stafftest_solo_admin@brightloop.io",
            password_hash=hash_password("Pass#12345"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(solo_admin)
        db.commit()
        db.refresh(solo_admin)

        admin_token = create_access_token(user_id=solo_admin.id, role="admin")
        admin_id = solo_admin.id
    finally:
        db.close()

    # Attempt to demote the sole admin to staff
    demote_res = client.patch(
        f"/api/v1/users/{admin_id}",
        json={"role": "staff"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Must fail with 400 Bad Request
    assert demote_res.status_code == 400
    assert "last remaining active administrator" in demote_res.json()["message"].lower()

    # Attempt to deactivate the sole admin
    deactivate_res = client.patch(
        f"/api/v1/users/{admin_id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert deactivate_res.status_code == 400
    assert "last remaining active administrator" in deactivate_res.json()["message"].lower()


def test_audit_log_recording_and_retrieval():
    """Verify AuditService records immutable before/after diffs [PDF 5.10, 9]."""
    db = SessionLocal()
    try:
        admin = User(
            email="stafftest_audit_admin@brightloop.io",
            password_hash=hash_password("Pass#12345"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role="admin")

        # Record a price modification audit event
        AuditService.record(
            db=db,
            actor_id=admin.id,
            entity="products",
            entity_id="prod-1234",
            action="UPDATE_PRICE",
            before_json={"sales_price": "100.00"},
            after_json={"sales_price": "150.00"},
            ip="127.0.0.1",
        )
    finally:
        db.close()

    # Query audit logs endpoint as Admin
    res = client.get("/api/v1/audit_logs", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    logs = res.json()
    assert len(logs) >= 1
    target = next((l for l in logs if l["entity_id"] == "prod-1234"), None)
    assert target is not None
    assert target["action"] == "UPDATE_PRICE"
    assert target["before_json"]["sales_price"] == "100.00"
    assert target["after_json"]["sales_price"] == "150.00"
