"""
Unit & Integration Tests for BE-6.1, BE-6.2, BE-6.3 & BE-7.2 [PDF 10, 11, 2, 8].
(MRR/ARR Normalization, KPI Mosaics, CSV Exports, Customer Portal Profile)
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import engine, Base, SessionLocal
from app.core.security import create_access_token, hash_password
from app.modules.auth.models import User, UserRole
from app.modules.customers.models import Customer
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.plans.models import Plan, BillingPeriod
from app.modules.reports.service import ReportsService
from app.modules.subscriptions.models import Subscription, SubscriptionStatus

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(Payment).delete()
        db.query(Invoice).delete()
        db.query(Subscription).delete()
        db.query(Plan).delete()
        db.query(Customer).delete()
        db.query(User).filter(User.email.like("reptest_%@brightloop.io")).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_mrr_arr_normalization():
    """Verify MRR normalization formula across daily, weekly, monthly, yearly plans [PDF 10]."""
    db = SessionLocal()
    try:
        cust = Customer(
            name="Test Customer",
            email="cust@test.com",
            billing_address={"line1": "123 Road", "city": "Bengaluru", "country": "India"},
        )
        # 1. Monthly plan: ₹100/mo -> MRR = 100
        p_mo = Plan(name="Monthly Plan", price=Decimal("100.00"), billing_period=BillingPeriod.MONTHLY)
        # 2. Yearly plan: ₹1200/yr -> MRR = 100
        p_yr = Plan(name="Yearly Plan", price=Decimal("1200.00"), billing_period=BillingPeriod.YEARLY)
        # 3. Weekly plan: ₹100/wk -> MRR = (100 * 52) / 12 = 433.33
        p_wk = Plan(name="Weekly Plan", price=Decimal("100.00"), billing_period=BillingPeriod.WEEKLY)
        # 4. Daily plan: ₹10/day -> MRR = (10 * 365) / 12 = 304.17
        p_dy = Plan(name="Daily Plan", price=Decimal("10.00"), billing_period=BillingPeriod.DAILY)
        # 5. Paused plan: should be excluded
        p_paused = Plan(name="Paused Plan", price=Decimal("500.00"), billing_period=BillingPeriod.MONTHLY)

        db.add_all([cust, p_mo, p_yr, p_wk, p_dy, p_paused])
        db.commit()

        s1 = Subscription(number="SUB-M", customer_id=cust.id, plan_id=p_mo.id, status=SubscriptionStatus.ACTIVE, start_date=date.today(), total_amount=Decimal("100.00"), anchor_day=1)
        s2 = Subscription(number="SUB-Y", customer_id=cust.id, plan_id=p_yr.id, status=SubscriptionStatus.ACTIVE, start_date=date.today(), total_amount=Decimal("1200.00"), anchor_day=1)
        s3 = Subscription(number="SUB-W", customer_id=cust.id, plan_id=p_wk.id, status=SubscriptionStatus.ACTIVE, start_date=date.today(), total_amount=Decimal("100.00"), anchor_day=1)
        s4 = Subscription(number="SUB-D", customer_id=cust.id, plan_id=p_dy.id, status=SubscriptionStatus.ACTIVE, start_date=date.today(), total_amount=Decimal("10.00"), anchor_day=1)
        s5 = Subscription(number="SUB-P", customer_id=cust.id, plan_id=p_paused.id, status=SubscriptionStatus.PAUSED, start_date=date.today(), total_amount=Decimal("500.00"), anchor_day=1)

        db.add_all([s1, s2, s3, s4, s5])
        db.commit()

        mrr, arr = ReportsService.calculate_mrr_arr(db)
        # Expected: 100 + 100 + 433.33 + 304.17 = 937.50
        assert float(mrr) == pytest.approx(937.50, rel=1e-2)
        assert float(arr) == pytest.approx(937.50 * 12, rel=1e-2)
    finally:
        db.close()


def test_reports_endpoints_and_csv_export():
    """Verify summary metrics, filterable endpoints, and CSV exports [PDF 8, 10, 11]."""
    db = SessionLocal()
    try:
        admin = User(email="reptest_admin@brightloop.io", password_hash=hash_password("AdminPass#2026"), role=UserRole.ADMIN, is_active=True)
        cust = Customer(name="Acme Reports", email="acme@reports.com", billing_address={"line1": "123 Road", "city": "Bengaluru", "country": "India"})
        plan = Plan(name="Standard SaaS", price=Decimal("100.00"), billing_period=BillingPeriod.MONTHLY)
        db.add_all([admin, cust, plan])
        db.commit()

        sub = Subscription(number="SUB-REP-01", customer_id=cust.id, plan_id=plan.id, status=SubscriptionStatus.ACTIVE, start_date=date.today(), total_amount=Decimal("100.00"), anchor_day=1)
        inv = Invoice(
            number="INV-REP-01",
            customer_id=cust.id,
            status=InvoiceStatus.CONFIRMED,
            invoice_date=date.today(),
            due_date=date.today() - timedelta(days=5), # Overdue!
            period_start=date.today() - timedelta(days=30),
            period_end=date.today(),
            total=Decimal("100.00"),
            amount_paid=Decimal("40.00"),
            balance=Decimal("60.00"),
        )
        db.add_all([sub, inv])
        db.commit()

        token = create_access_token(user_id=admin.id, role=admin.role.value)

        # 1. Dashboard summary endpoint
        res = client.get("/api/v1/reports/summary?refresh=true", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.json()
        assert data["active_subscriptions"] == 1
        assert float(data["mrr"]) == 100.00
        assert data["overdue_invoice_count"] == 1
        assert float(data["overdue_amount"]) == 60.00

        # 2. Active subscriptions CSV export
        res_csv = client.get("/api/v1/reports/active-subscriptions?format=csv", headers={"Authorization": f"Bearer {token}"})
        assert res_csv.status_code == 200
        assert "text/csv" in res_csv.headers["content-type"]
        assert "SUB-REP-01" in res_csv.text

        # 3. Revenue report CSV export
        res_rev = client.get("/api/v1/reports/revenue?format=csv", headers={"Authorization": f"Bearer {token}"})
        assert res_rev.status_code == 200
        assert "text/csv" in res_rev.headers["content-type"]
        assert "INV-REP-01" in res_rev.text

        # 4. Overdue report
        res_over = client.get("/api/v1/reports/overdue", headers={"Authorization": f"Bearer {token}"})
        assert res_over.status_code == 200
        assert res_over.json()["overdue_count"] == 1

        # 5. Outstanding report
        res_out = client.get("/api/v1/reports/outstanding", headers={"Authorization": f"Bearer {token}"})
        assert res_out.status_code == 200
        assert res_out.json()["outstanding_count"] == 1
    finally:
        db.close()


def test_customer_portal_profile_update():
    """Verify Customer can view and update their own profile (BE-7.2) [PDF 2, 8]."""
    db = SessionLocal()
    try:
        cust_user = User(
            email="reptest_portal@brightloop.io",
            password_hash=hash_password("PortalPass#2026"),
            role=UserRole.CUSTOMER,
            is_active=True,
        )
        db.add(cust_user)
        db.commit()
        db.refresh(cust_user)

        token = create_access_token(user_id=cust_user.id, role=cust_user.role.value)

        # GET /me/profile
        res = client.get("/api/v1/me/profile", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["email"] == cust_user.email

        # PATCH /me/profile
        res_patch = client.patch(
            "/api/v1/me/profile",
            json={
                "phone": "+91-9876543210",
                "billing_address": {
                    "line1": "77 Brigade Road",
                    "city": "Bengaluru",
                    "state": "Karnataka",
                    "postal_code": "560025",
                    "country": "India",
                },
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res_patch.status_code == 200
        data = res_patch.json()
        assert data["phone"] == "+91-9876543210"
        assert data["billing_address"]["city"] == "Bengaluru"
    finally:
        db.close()
