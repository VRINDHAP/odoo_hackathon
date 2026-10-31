"""
Unit & Integration Tests for BE-2.3 (Tax Engine: Inclusive vs Exclusive Calculations) [PDF 5.7, 7.1, 8, 9].
"""
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.contracts import TaxBreakdown
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.taxes.models import Tax, TaxType, TaxAppliesTo
from app.modules.taxes.service import TaxService

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(Tax).delete()
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("taxtest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_tax_creation_admin_only():
    """Verify tax creation is restricted to Admin (HTTP 403 for Staff/Customer) [PDF 2, 5.7, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="taxtest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="taxtest_staff@brightloop.io",
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
        "name": "GST 18%",
        "type": "percent",
        "rate": "18.0000",
        "inclusive": False,
        "applies_to": "all",
    }

    # 1. Staff user should receive HTTP 403 Forbidden
    resp_staff = client.post(
        "/api/v1/taxes",
        json=payload,
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_staff.status_code == 403
    assert resp_staff.json()["code"] == "FORBIDDEN"

    # 2. Admin user succeeds with HTTP 201 Created
    resp_admin = client.post(
        "/api/v1/taxes",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_admin.status_code == 201
    data = resp_admin.json()
    assert data["name"] == "GST 18%"
    assert Decimal(str(data["rate"])) == Decimal("18.0000")
    assert data["inclusive"] is False
    assert data["applies_to"] == "all"
    assert data["is_active"] is True


def test_exact_18_percent_exclusive_tax_calculation():
    """
    Acceptance Test [PDF 7.1, TASKS.md]:
    Confirm exact tax calculation for 18% Exclusive tax on INR 1,000.00:
    - taxable base = 1000.00
    - tax amount = 1000.00 * 0.18 = 180.00
    - invoice total = 1000.00 + 180.00 = 1180.00
    """
    db = SessionLocal()
    try:
        tax = Tax(
            name="GST 18% Exclusive",
            type=TaxType.PERCENT,
            rate=Decimal("18.0000"),
            inclusive=False,
            applies_to=TaxAppliesTo.ALL,
            is_active=True,
        )
        db.add(tax)
        db.commit()
        db.refresh(tax)
        tax_id = tax.id

        calc = TaxService.calculate_tax(db, tax_id=tax_id, amount=Decimal("1000.00"))
        assert calc.taxable_amount == Decimal("1000.00")
        assert calc.tax_amount == Decimal("180.00")
        assert calc.total_amount == Decimal("1180.00")
        assert calc.inclusive is False
    finally:
        db.close()

    # Also test through HTTP endpoint POST /api/v1/taxes/calculate
    resp = client.post(
        "/api/v1/taxes/calculate",
        json={"tax_id": tax_id, "amount": "1000.00"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert Decimal(str(body["taxable_amount"])) == Decimal("1000.00")
    assert Decimal(str(body["tax_amount"])) == Decimal("180.00")
    assert Decimal(str(body["total_amount"])) == Decimal("1180.00")


def test_exact_18_percent_inclusive_tax_calculation():
    """
    Acceptance Test [PDF 7.1, TASKS.md]:
    Confirm exact tax calculation for 18% Inclusive tax on INR 1,000.00:
    - total gross = 1000.00
    - net taxable = 1000.00 / 1.18 = 847.46
    - tax amount = 1000.00 - 847.46 = 152.54
    - invoice total = 1000.00
    """
    db = SessionLocal()
    try:
        tax = Tax(
            name="GST 18% Inclusive",
            type=TaxType.PERCENT,
            rate=Decimal("18.0000"),
            inclusive=True,
            applies_to=TaxAppliesTo.ALL,
            is_active=True,
        )
        db.add(tax)
        db.commit()
        db.refresh(tax)
        tax_id = tax.id

        calc = TaxService.calculate_tax(db, tax_id=tax_id, amount=Decimal("1000.00"))
        assert calc.tax_amount == Decimal("152.54")
        assert calc.taxable_amount == Decimal("847.46")
        assert calc.total_amount == Decimal("1000.00")
        assert calc.inclusive is True
    finally:
        db.close()

    # Verify through HTTP endpoint
    resp = client.post(
        "/api/v1/taxes/calculate",
        json={"tax_id": tax_id, "amount": "1000.00"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert Decimal(str(body["tax_amount"])) == Decimal("152.54")
    assert Decimal(str(body["taxable_amount"])) == Decimal("847.46")
    assert Decimal(str(body["total_amount"])) == Decimal("1000.00")


def test_fixed_tax_calculations():
    """Verify fixed surcharge tax calculation in both inclusive and exclusive modes."""
    db = SessionLocal()
    try:
        tax_excl = Tax(
            name="Environmental Fee Exclusive",
            type=TaxType.FIXED,
            rate=Decimal("50.0000"),
            inclusive=False,
            is_active=True,
        )
        tax_incl = Tax(
            name="Environmental Fee Inclusive",
            type=TaxType.FIXED,
            rate=Decimal("50.0000"),
            inclusive=True,
            is_active=True,
        )
        db.add_all([tax_excl, tax_incl])
        db.commit()
        db.refresh(tax_excl)
        db.refresh(tax_incl)

        # Exclusive: 1000 + 50 = 1050
        res_excl = TaxService.calculate_tax(db, tax_excl.id, Decimal("1000.00"))
        assert res_excl.taxable_amount == Decimal("1000.00")
        assert res_excl.tax_amount == Decimal("50.00")
        assert res_excl.total_amount == Decimal("1050.00")

        # Inclusive: 1000 total (950 taxable + 50 tax)
        res_incl = TaxService.calculate_tax(db, tax_incl.id, Decimal("1000.00"))
        assert res_incl.taxable_amount == Decimal("950.00")
        assert res_incl.tax_amount == Decimal("50.00")
        assert res_incl.total_amount == Decimal("1000.00")
    finally:
        db.close()


def test_tax_update_and_audit_trail():
    """Verify modifying a tax rule logs immutable before/after state diff [PDF 5.7, 9]."""
    db = SessionLocal()
    try:
        admin = User(
            email="taxtest_admin2@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        tax = Tax(
            name="Old VAT Rate",
            type=TaxType.PERCENT,
            rate=Decimal("5.0000"),
            inclusive=False,
            is_active=True,
        )
        db.add(tax)
        db.commit()
        db.refresh(tax)
        tax_id = tax.id
    finally:
        db.close()

    # Update tax rate to 12.00%
    patch_resp = client.patch(
        f"/api/v1/taxes/{tax_id}",
        json={"name": "Updated VAT Rate", "rate": "12.0000"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert patch_resp.status_code == 200
    assert Decimal(str(patch_resp.json()["rate"])) == Decimal("12.0000")

    # Verify audit log entry
    db = SessionLocal()
    try:
        audit = db.query(AuditLog).filter(AuditLog.entity_id == tax_id, AuditLog.action == "UPDATE").first()
        assert audit is not None
        assert audit.before_json["rate"] == "5.0000"
        assert audit.after_json["rate"] == "12.0000"
    finally:
        db.close()


def test_tax_soft_delete_and_domain_contract():
    """Verify soft deleting tax and test TaxBreakdown internal domain protocol."""
    db = SessionLocal()
    try:
        admin = User(
            email="taxtest_admin3@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        tax = Tax(
            name="Municipal Tax",
            type=TaxType.PERCENT,
            rate=Decimal("2.0000"),
            inclusive=False,
            is_active=True,
        )
        db.add(tax)
        db.commit()
        db.refresh(tax)
        tax_id = tax.id

        # Check domain contract helper calculate_breakdown
        breakdown = TaxService.calculate_breakdown(db, tax_id=tax_id, taxable_amount=Decimal("500.00"))
        assert isinstance(breakdown, TaxBreakdown)
        assert breakdown.tax_amount == Decimal("10.00")
        assert breakdown.taxable_amount == Decimal("500.00")
    finally:
        db.close()

    # Soft delete via endpoint
    del_resp = client.delete(
        f"/api/v1/taxes/{tax_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False

    # Listing excludes deactivated tax
    list_resp = client.get("/api/v1/taxes?active_only=true")
    assert list_resp.status_code == 200
    ids = [t["id"] for t in list_resp.json()]
    assert tax_id not in ids
