"""
Unit & Integration Tests for BE-3.1 (Customer Profiles, Billing Address, History Aggregation) [PDF 5.2, 8, 9, 12.2].
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.customers.models import Customer, CustomerStatus

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(Customer).delete()
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("custtest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_customer_creation_staff_and_admin():
    """Verify Staff and Admin can create customers, but Customer role is forbidden [PDF 2, 5.2, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="custtest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="custtest_staff@brightloop.io",
            password_hash=hash_password("StaffPass#2026"),
            role=UserRole.STAFF,
            is_active=True,
        )
        portal_cust = User(
            email="custtest_portal@brightloop.io",
            password_hash=hash_password("CustPass#2026"),
            role=UserRole.CUSTOMER,
            is_active=True,
        )
        db.add_all([admin, staff, portal_cust])
        db.commit()
        db.refresh(admin)
        db.refresh(staff)
        db.refresh(portal_cust)

        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        staff_token = create_access_token(user_id=staff.id, role=staff.role.value)
        cust_token = create_access_token(user_id=portal_cust.id, role=portal_cust.role.value)
    finally:
        db.close()

    payload = {
        "name": "Rajesh Kumar",
        "company_name": "Acme Technologies Pvt Ltd",
        "email": "rajesh@acme-tech.in",
        "phone": "+91 98765 43210",
        "tax_id": "29ABCDE1234F1Z5",
        "billing_address": {
            "line1": "Tech Park, Phase 1",
            "city": "Bengaluru",
            "state": "Karnataka",
            "postal_code": "560100",
            "country": "India",
        },
        "payment_terms": "Net 30",
    }

    # 1. Customer role receives 403 Forbidden
    resp_forbidden = client.post(
        "/api/v1/customers",
        json=payload,
        headers={"Authorization": f"Bearer {cust_token}"},
    )
    assert resp_forbidden.status_code == 403

    # 2. Staff user succeeds with 201 Created
    resp_staff = client.post(
        "/api/v1/customers",
        json=payload,
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_staff.status_code == 201
    data = resp_staff.json()
    assert data["name"] == "Rajesh Kumar"
    assert data["company_name"] == "Acme Technologies Pvt Ltd"
    assert data["email"] == "rajesh@acme-tech.in"
    assert data["tax_id"] == "29ABCDE1234F1Z5"
    assert data["billing_address"]["city"] == "Bengaluru"
    assert data["payment_terms"] == "Net 30"
    assert data["status"] == "active"
    assert data["deleted_at"] is None

    # 3. Duplicate email returns 409 Conflict
    resp_dup = client.post(
        "/api/v1/customers",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_dup.status_code == 409
    assert resp_dup.json()["code"] == "CONFLICT"


def test_customer_pagination_and_search():
    """Verify customer directory search by name/email/company and pagination [PDF 8, 11]."""
    db = SessionLocal()
    try:
        admin = User(
            email="custtest_admin2@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)

        c1 = Customer(
            name="Alice Walker",
            company_name="Delta Software",
            email="alice@delta.com",
            status=CustomerStatus.ACTIVE,
        )
        c2 = Customer(
            name="Bob Smith",
            company_name="Echo Logistics",
            email="bob@echo.com",
            status=CustomerStatus.ACTIVE,
        )
        c3 = Customer(
            name="Charlie Brown",
            company_name="Delta Services",
            email="charlie@delta.com",
            status=CustomerStatus.INACTIVE,
        )
        db.add_all([c1, c2, c3])
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
    finally:
        db.close()

    # Search by company "Delta"
    resp = client.get(
        "/api/v1/customers?search=Delta",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    res = resp.json()
    assert res["total"] == 2
    names = [c["name"] for c in res["items"]]
    assert "Alice Walker" in names
    assert "Charlie Brown" in names
    assert "Bob Smith" not in names

    # Filter by status "active"
    resp_active = client.get(
        "/api/v1/customers?status=active",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_active.status_code == 200
    res_active = resp_active.json()
    assert res_active["total"] == 2


def test_customer_detail_and_history_aggregation():
    """Verify GET /customers/{id} returns customer profile and relational history [PDF 12.2]."""
    db = SessionLocal()
    try:
        admin = User(
            email="custtest_admin3@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)

        cust = Customer(
            name="Vikram Patel",
            company_name="Zenith Corp",
            email="vikram@zenith.com",
            phone="+91 91234 56789",
            tax_id="33AAAAA0000A1Z5",
            billing_address={"city": "Chennai", "country": "India"},
            status=CustomerStatus.ACTIVE,
        )
        db.add(cust)
        db.commit()
        db.refresh(admin)
        db.refresh(cust)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        cust_id = cust.id
    finally:
        db.close()

    resp = client.get(
        f"/api/v1/customers/{cust_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    detail = resp.json()
    assert "customer" in detail
    assert detail["customer"]["id"] == cust_id
    assert detail["customer"]["name"] == "Vikram Patel"
    assert "subscriptions" in detail
    assert "invoices" in detail
    assert "payments" in detail


def test_customer_update_and_audit():
    """Verify modifying customer profile records immutable audit log [PDF 5.2, 9]."""
    db = SessionLocal()
    try:
        admin = User(
            email="custtest_admin4@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)

        cust = Customer(
            name="Original Name",
            company_name="Original Corp",
            email="original@test.com",
            phone="1111111111",
            status=CustomerStatus.ACTIVE,
        )
        db.add(cust)
        db.commit()
        db.refresh(admin)
        db.refresh(cust)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        cust_id = cust.id
    finally:
        db.close()

    # Update phone and company name
    patch_resp = client.patch(
        f"/api/v1/customers/{cust_id}",
        json={"name": "Updated Name", "phone": "9999999999"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["name"] == "Updated Name"
    assert patch_resp.json()["phone"] == "9999999999"

    # Verify audit log
    db = SessionLocal()
    try:
        audit = db.query(AuditLog).filter(AuditLog.entity_id == cust_id, AuditLog.action == "UPDATE").first()
        assert audit is not None
        assert audit.before_json["name"] == "Original Name"
        assert audit.after_json["name"] == "Updated Name"
        assert audit.before_json["phone"] == "1111111111"
        assert audit.after_json["phone"] == "9999999999"
    finally:
        db.close()


def test_customer_soft_delete():
    """Verify soft deleting sets deleted_at and deactivates status without dropping row [PDF 5.2]."""
    db = SessionLocal()
    try:
        admin = User(
            email="custtest_admin5@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)

        cust = Customer(
            name="Deletable Customer",
            company_name="Deletable Inc",
            email="delete@me.com",
            status=CustomerStatus.ACTIVE,
        )
        db.add(cust)
        db.commit()
        db.refresh(admin)
        db.refresh(cust)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        cust_id = cust.id
    finally:
        db.close()

    # Admin deletes customer
    del_resp = client.delete(
        f"/api/v1/customers/{cust_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "inactive"
    assert del_resp.json()["deleted_at"] is not None

    # Normal listing excludes soft deleted
    list_active = client.get(
        "/api/v1/customers",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert list_active.status_code == 200
    ids = [c["id"] for c in list_active.json()["items"]]
    assert cust_id not in ids

    # Listing with include_deleted=true includes it
    list_all = client.get(
        "/api/v1/customers?include_deleted=true",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert list_all.status_code == 200
    all_ids = [c["id"] for c in list_all.json()["items"]]
    assert cust_id in all_ids
