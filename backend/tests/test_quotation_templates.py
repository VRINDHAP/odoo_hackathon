"""
Unit & Integration Tests for BE-3.2 (Quotation Templates & One-Click Factory) [PDF 5.5, 8].
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.audit.models import AuditLog
from app.modules.catalog.models import Product, ProductVariant
from app.modules.customers.models import Customer
from app.modules.plans.models import Plan, BillingPeriod
from app.modules.quotation_templates.models import QuotationTemplate, QuotationTemplateLine
from app.modules.subscriptions.models import Subscription, SubscriptionLine

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(SubscriptionLine).delete()
        db.query(Subscription).delete()
        db.query(QuotationTemplateLine).delete()
        db.query(QuotationTemplate).delete()
        db.query(ProductVariant).delete()
        db.query(Product).delete()
        db.query(Plan).delete()
        db.query(Customer).delete()
        db.query(AuditLog).delete()
        db.query(User).filter(User.email.like("tpltest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_quotation_template_crud_and_listing():
    """Verify Staff and Admin can create and list quotation templates [PDF 5.5, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="tpltest_admin@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        staff = User(
            email="tpltest_staff@brightloop.io",
            password_hash=hash_password("StaffPass#2026"),
            role=UserRole.STAFF,
            is_active=True,
        )
        customer_user = User(
            email="tpltest_cust@brightloop.io",
            password_hash=hash_password("CustPass#2026"),
            role=UserRole.CUSTOMER,
            is_active=True,
        )
        plan = Plan(
            name="Professional SaaS",
            price=Decimal("99.00"),
            billing_period=BillingPeriod.MONTHLY,
            is_active=True,
        )
        prod = Product(
            name="Cloud Storage 100GB",
            sales_price=Decimal("25.00"),
            cost_price=Decimal("10.00"),
            is_active=True,
        )
        db.add_all([admin, staff, customer_user, plan, prod])
        db.commit()
        db.refresh(admin)
        db.refresh(staff)
        db.refresh(customer_user)
        db.refresh(plan)
        db.refresh(prod)

        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)
        staff_token = create_access_token(user_id=staff.id, role=staff.role.value)
        cust_token = create_access_token(user_id=customer_user.id, role=customer_user.role.value)

        # 1. Customer role is forbidden
        res = client.post(
            "/api/v1/quotation-templates",
            json={
                "name": "Standard Onboarding",
                "validity_days": 15,
                "plan_id": plan.id,
                "lines": [{"product_id": prod.id, "quantity": 2, "unit_price": "20.00"}],
            },
            headers={"Authorization": f"Bearer {cust_token}"},
        )
        assert res.status_code == 403

        # 2. Staff creates a template
        res = client.post(
            "/api/v1/quotation-templates",
            json={
                "name": "Standard Onboarding",
                "validity_days": 15,
                "plan_id": plan.id,
                "notes": "Introductory bundle with 20% discount on storage",
                "lines": [{"product_id": prod.id, "quantity": 2, "unit_price": "20.00"}],
            },
            headers={"Authorization": f"Bearer {staff_token}"},
        )
        assert res.status_code == 201
        tpl_data = res.json()
        assert tpl_data["name"] == "Standard Onboarding"
        assert tpl_data["validity_days"] == 15
        assert len(tpl_data["lines"]) == 1
        assert tpl_data["lines"][0]["quantity"] == 2
        assert float(tpl_data["lines"][0]["unit_price"]) == 20.0
        tpl_id = tpl_data["id"]

        # 3. Retrieve template by ID
        res = client.get(
            f"/api/v1/quotation-templates/{tpl_id}",
            headers={"Authorization": f"Bearer {staff_token}"},
        )
        assert res.status_code == 200
        assert res.json()["id"] == tpl_id

        # 4. List templates
        res = client.get(
            "/api/v1/quotation-templates",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200
        assert len(res.json()) >= 1

        # 5. Check Audit log recorded
        audit = db.query(AuditLog).filter(
            AuditLog.entity == "quotation_template",
            AuditLog.action == "CREATE",
        ).first()
        assert audit is not None
        assert audit.actor_id == staff.id
    finally:
        db.close()


def test_one_click_create_quotation_factory():
    """Verify one-click generation of draft subscription from template [PDF 5.5, 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="tpltest_admin2@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        customer = Customer(
            name="Acme Corp",
            email="billing@acme.com",
            billing_address={"line1": "456 Market St", "city": "Bengaluru", "country": "India"},
        )
        plan = Plan(
            name="Enterprise Annual",
            price=Decimal("1200.00"),
            billing_period=BillingPeriod.YEARLY,
            is_active=True,
        )
        prod1 = Product(name="Enterprise Seats", sales_price=Decimal("150.00"), cost_price=Decimal("80.00"), is_active=True)
        prod2 = Product(name="Dedicated Support", sales_price=Decimal("300.00"), cost_price=Decimal("120.00"), is_active=True)
        db.add_all([admin, customer, plan, prod1, prod2])
        db.commit()
        db.refresh(admin)
        db.refresh(customer)
        db.refresh(plan)
        db.refresh(prod1)
        db.refresh(prod2)

        # Create template with 2 products
        template = QuotationTemplate(
            name="Enterprise Custom Pitch",
            validity_days=21,
            plan_id=plan.id,
            notes="Exclusive bundle for Acme",
        )
        db.add(template)
        db.flush()

        line1 = QuotationTemplateLine(
            template_id=template.id,
            product_id=prod1.id,
            quantity=5,
            unit_price=Decimal("140.00"),
        )
        line2 = QuotationTemplateLine(
            template_id=template.id,
            product_id=prod2.id,
            quantity=1,
            unit_price=Decimal("250.00"),
        )
        db.add_all([line1, line2])
        db.commit()
        db.refresh(template)

        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        # Call factory endpoint
        res = client.post(
            f"/api/v1/quotation-templates/{template.id}/create-quotation",
            json={"customer_id": customer.id},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 201
        sub_data = res.json()
        assert sub_data["customer_id"] == customer.id
        assert sub_data["plan_id"] == plan.id
        assert sub_data["status"] in ("quotation", "draft")
        assert sub_data["number"].startswith("SUB-")

        # Check calculated expiration date (today + 21 days)
        expected_expiry = (date.today() + timedelta(days=21)).isoformat()
        assert sub_data["quotation_expires_at"] == expected_expiry

        # Check lines cloned in DB
        sub_id = sub_data["id"]
        sub_db = db.query(Subscription).filter(Subscription.id == sub_id).first()
        assert sub_db is not None
        assert len(sub_db.lines) == 2
        quantities = sorted([l.quantity for l in sub_db.lines])
        assert quantities == [1, 5]

        # Audit log verified
        audit = db.query(AuditLog).filter(
            AuditLog.entity == "subscription",
            AuditLog.action == "CREATE_QUOTATION_FROM_TEMPLATE",
        ).first()
        assert audit is not None
        assert audit.actor_id == admin.id
    finally:
        db.close()


def test_quotation_template_validation_and_errors():
    """Verify validation guards for invalid plans, products, or customers [PDF 8]."""
    db = SessionLocal()
    try:
        admin = User(
            email="tpltest_admin3@brightloop.io",
            password_hash=hash_password("AdminPass#2026"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        admin_token = create_access_token(user_id=admin.id, role=admin.role.value)

        # Non-existent plan returns 404
        res = client.post(
            "/api/v1/quotation-templates",
            json={
                "name": "Invalid Plan Template",
                "validity_days": 10,
                "plan_id": "00000000-0000-0000-0000-000000000000",
                "lines": [],
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 404

        # Non-existent template for create-quotation returns 404
        res = client.post(
            "/api/v1/quotation-templates/00000000-0000-0000-0000-000000000000/create-quotation",
            json={"customer_id": "00000000-0000-0000-0000-000000000000"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 404
    finally:
        db.close()
