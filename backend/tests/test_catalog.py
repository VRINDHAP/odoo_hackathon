"""
Unit & Integration Tests for BE-2.1 (Catalog: Products, Variants, Admin Margin Masking) [PDF 5.3, 8, 9].
"""
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.catalog.models import Product, ProductVariant, ProductType
from app.modules.catalog.service import CatalogService

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(ProductVariant).delete()
        db.query(Product).delete()
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("cattest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_product_creation_admin_only():
    """Verify product creation is restricted to Admin (HTTP 403 for Staff/Customer) [PDF 2, 5.3, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="cattest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="cattest_staff@brightloop.io",
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
        "name": "Cloud Storage Pro",
        "type": "software",
        "sales_price": "1000.00",
        "cost_price": "600.00",
        "notes": "100GB High-Performance Storage",
    }

    # 1. Staff user should be forbidden (403)
    resp_staff = client.post(
        "/api/v1/products",
        json=payload,
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_staff.status_code == 403
    assert resp_staff.json()["code"] == "FORBIDDEN"

    # 2. Admin should succeed (201)
    resp_admin = client.post(
        "/api/v1/products",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_admin.status_code == 201
    data = resp_admin.json()
    assert data["name"] == "Cloud Storage Pro"
    assert Decimal(str(data["sales_price"])) == Decimal("1000.00")
    # Admin sees cost_price and margin
    assert Decimal(str(data["cost_price"])) == Decimal("600.00")
    assert Decimal(str(data["margin"])) == Decimal("400.00")


def test_margin_masking_for_non_admins():
    """
    Verify Margin = Sales Price - Cost Price is visible to Admin only [PDF 5.3].
    Non-admin callers must receive None for both cost_price and margin.
    """
    db = SessionLocal()
    try:
        admin = User(
            email="cattest_admin2@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="cattest_staff2@brightloop.io",
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

        product = Product(
            name="ERP Suite",
            type=ProductType.SOFTWARE,
            sales_price=Decimal("1500.00"),
            cost_price=Decimal("900.00"),
            is_active=True,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        product_id = product.id
    finally:
        db.close()

    # Admin requests GET /products/{id} -> Sees cost_price=900, margin=600
    res_admin = client.get(
        f"/api/v1/products/{product_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res_admin.status_code == 200
    admin_body = res_admin.json()
    assert Decimal(str(admin_body["cost_price"])) == Decimal("900.00")
    assert Decimal(str(admin_body["margin"])) == Decimal("600.00")

    # Staff requests GET /products/{id} -> cost_price is None, margin is None
    res_staff = client.get(
        f"/api/v1/products/{product_id}",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert res_staff.status_code == 200
    staff_body = res_staff.json()
    assert staff_body["cost_price"] is None
    assert staff_body["margin"] is None

    # Unauthenticated / Portal caller -> cost_price is None, margin is None
    res_anon = client.get(f"/api/v1/products/{product_id}")
    assert res_anon.status_code == 200
    anon_body = res_anon.json()
    assert anon_body["cost_price"] is None
    assert anon_body["margin"] is None


def test_product_variants_and_effective_pricing():
    """
    Test variant surcharges dynamically added to base sales price (PDF 5.3).
    Also test composite uniqueness rejecting duplicate variants with HTTP 409 Conflict.
    """
    db = SessionLocal()
    try:
        admin = User(
            email="cattest_admin3@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        product = Product(
            name="POS Terminal",
            type=ProductType.PHYSICAL,
            sales_price=Decimal("500.00"),
            cost_price=Decimal("300.00"),
            is_active=True,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        product_id = product.id
    finally:
        db.close()

    # 1. Add variant (Brand: Odoo, Extra Price: $560.00) [PDF 5.3 example]
    variant_payload = {
        "attribute": "Brand",
        "value": "Odoo",
        "extra_price": "560.00",
    }
    resp_v = client.post(
        f"/api/v1/products/{product_id}/variants",
        json=variant_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_v.status_code == 201
    v_data = resp_v.json()
    assert v_data["attribute"] == "Brand"
    assert v_data["value"] == "Odoo"
    assert Decimal(str(v_data["extra_price"])) == Decimal("560.00")
    variant_id = v_data["id"]

    # 2. Check effective price calculation: 500.00 + 560.00 = 1060.00
    db = SessionLocal()
    try:
        effective_price = CatalogService.calculate_effective_price(db, product_id, variant_id)
        assert effective_price == Decimal("1060.00")
    finally:
        db.close()

    # 3. Duplicate variant should be rejected with HTTP 409 Conflict
    resp_dup = client.post(
        f"/api/v1/products/{product_id}/variants",
        json=variant_payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_dup.status_code == 409
    assert resp_dup.json()["code"] == "CONFLICT"


def test_product_update_and_soft_delete():
    """Verify price updates log to audit table and soft delete deactivates product."""
    db = SessionLocal()
    try:
        admin = User(
            email="cattest_admin4@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        product = Product(
            name="Consulting Hours",
            type=ProductType.SERVICE,
            sales_price=Decimal("150.00"),
            cost_price=Decimal("50.00"),
            is_active=True,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        product_id = product.id
    finally:
        db.close()

    # 1. Update sales price
    update_resp = client.patch(
        f"/api/v1/products/{product_id}",
        json={"sales_price": "200.00"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert update_resp.status_code == 200
    assert Decimal(str(update_resp.json()["sales_price"])) == Decimal("200.00")
    assert Decimal(str(update_resp.json()["margin"])) == Decimal("150.00")

    # Verify audit log recorded update
    db = SessionLocal()
    try:
        audit = db.query(AuditLog).filter(AuditLog.entity_id == product_id, AuditLog.action == "UPDATE").first()
        assert audit is not None
        assert audit.before_json["sales_price"] == "150.00"
        assert audit.after_json["sales_price"] == "200.00"
    finally:
        db.close()

    # 2. Soft delete product
    del_resp = client.delete(
        f"/api/v1/products/{product_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False

    # 3. Active listing should not return the deactivated product
    list_resp = client.get("/api/v1/products?active_only=true")
    assert list_resp.status_code == 200
    ids = [p["id"] for p in list_resp.json()]
    assert product_id not in ids
