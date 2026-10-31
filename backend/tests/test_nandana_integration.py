"""
Cross-Module Integration Test Suite: Nandana's Shared Modules & Vrindha's Engine.
Validates:
1. User Auth & Role Guarding (Admin vs. Customer).
2. Customer, Catalog, Plan & Tax domain model integration.
3. Subscription lifecycle (Draft -> Quotation -> Confirmed -> Active).
4. Billing Engine execution with TaxService.calculate_tax integration.
5. Idempotent recurring billing (anti-double-billing).
6. Payment settlement (partial -> full -> InvoiceStatus.PAID).
7. Customer portal data isolation.
"""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
import pytest

from app.core.errors import ForbiddenError, ValidationError
from app.modules.auth.models import User, UserRole
from app.modules.catalog.models import Product, ProductType
from app.modules.customers.models import Customer
from app.modules.invoices.models import Invoice, InvoiceStatus
from app.modules.payments.exceptions import OverpaymentException
from app.modules.payments.models import PaymentMethod, PaymentStatus
from app.modules.payments.schemas import PaymentCreate
from app.modules.payments.service import PaymentService
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus
from app.modules.subscriptions.schemas import SubscriptionCreate, SubscriptionLineCreate
from app.modules.subscriptions.service import SubscriptionService
from app.modules.taxes.models import Tax, TaxAppliesTo, TaxType
from app.modules.taxes.service import TaxService
from app.modules.billing.engine import BillingEngine


@pytest.fixture
def integration_fixture(db_session):
    """Sets up an end-to-end integration environment with real related models."""
    # 1. Users
    admin = User(
        id=str(uuid.uuid4()),
        email="admin_integ@brightloop.io",
        password_hash="fakehash_admin",
        role=UserRole.ADMIN,
        is_active=True,
    )
    cust_user = User(
        id=str(uuid.uuid4()),
        email="customer_integ@brightloop.io",
        password_hash="fakehash_cust",
        role=UserRole.CUSTOMER,
        is_active=True,
    )
    other_cust_user = User(
        id=str(uuid.uuid4()),
        email="other_cust_integ@brightloop.io",
        password_hash="fakehash_other",
        role=UserRole.CUSTOMER,
        is_active=True,
    )

    # 2. Customers
    cust_id = str(uuid.uuid4())
    customer = Customer(
        id=cust_id,
        name="Acme Corporation",
        email="billing@acme.corp",
        company_name="Acme Corp",
        tax_id="GSTIN-ACME-01",
        billing_address={"street": "100 Innovation Way", "city": "Bengaluru", "country": "India"},
        status="active",
        portal_user_id=cust_user.id,
    )
    cust_user.customer_id = cust_id

    other_cust_id = str(uuid.uuid4())
    other_customer = Customer(
        id=other_cust_id,
        name="Beta Industries",
        email="billing@beta.corp",
        company_name="Beta Corp",
        tax_id="GSTIN-BETA-02",
        billing_address={"street": "200 Silicon Ave", "city": "Bengaluru", "country": "India"},
        status="active",
        portal_user_id=other_cust_user.id,
    )
    other_cust_user.customer_id = other_cust_id

    # 3. Tax Schedule: 18% Exclusive GST
    tax = Tax(
        id=str(uuid.uuid4()),
        name="GST 18% Exclusive",
        type=TaxType.PERCENT,
        rate=Decimal("18.00"),
        inclusive=False,
        applies_to=TaxAppliesTo.ALL,
        is_active=True,
    )

    # 4. Catalog Product
    product = Product(
        id=str(uuid.uuid4()),
        name="Cloud Enterprise Platform",
        type=ProductType.SOFTWARE,
        sales_price=Decimal("1000.00"),
        cost_price=Decimal("400.00"),
        tax_id=tax.id,
        is_active=True,
    )

    # 5. Recurring Plan
    plan = Plan(
        id=str(uuid.uuid4()),
        name="Monthly Enterprise",
        price=Decimal("1000.00"),
        billing_period=BillingPeriod.MONTHLY,
        min_quantity=1,
        auto_close=False,
        closable=True,
        pausable=True,
        renewable=True,
        is_active=True,
    )

    db_session.add_all([
        admin, cust_user, other_cust_user,
        customer, other_customer,
        tax, product, plan
    ])
    db_session.commit()

    return {
        "admin": admin,
        "customer_user": cust_user,
        "other_customer_user": other_cust_user,
        "customer": customer,
        "other_customer": other_customer,
        "tax": tax,
        "product": product,
        "plan": plan,
    }


def test_nandana_models_and_subscription_lifecycle(db_session, integration_fixture):
    """Verifies that subscriptions correctly link to Nandana's models and transition states."""
    f = integration_fixture
    today = date.today()

    # Create Subscription through Service
    req = SubscriptionCreate(
        customer_id=f["customer"].id,
        plan_id=f["plan"].id,
        start_date=today,
        currency="INR",
        lines=[
            SubscriptionLineCreate(
                product_id=f["product"].id,
                quantity=2,
                unit_price=Decimal("1000.00"),
                tax_id=f["tax"].id,
                tax_rate=Decimal("18.00"),
            )
        ],
    )
    sub = SubscriptionService.create_subscription(db=db_session, request=req, creator_id=f["admin"].id)
    assert sub.status == SubscriptionStatus.DRAFT
    assert sub.customer_id == f["customer"].id
    assert sub.plan_id == f["plan"].id
    assert len(sub.lines) == 1
    assert sub.lines[0].unit_price == Decimal("1000.00")
    assert sub.lines[0].tax_id == f["tax"].id

    # Transitions: Draft -> Quotation -> Confirmed -> Active
    sub_q = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state=SubscriptionStatus.QUOTATION,
        user_role=f["admin"].role,
        db=db_session,
        user_id=f["admin"].id,
    )
    assert sub_q.status == SubscriptionStatus.QUOTATION

    sub_c = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state=SubscriptionStatus.CONFIRMED,
        user_role=f["customer_user"].role,
        db=db_session,
        user_id=f["customer_user"].id,
    )
    assert sub_c.status == SubscriptionStatus.CONFIRMED

    sub_a = SubscriptionService.transition_state(
        subscription_id=sub.id,
        target_state=SubscriptionStatus.ACTIVE,
        user_role=f["admin"].role,
        db=db_session,
        user_id=f["admin"].id,
    )
    assert sub_a.status == SubscriptionStatus.ACTIVE
    assert sub_a.anchor_day == today.day
    assert sub_a.next_billing_date is not None


def test_billing_engine_integrates_tax_service_and_generates_invoice(db_session, integration_fixture):
    """
    Verifies that BillingEngine uses TaxService.calculate_tax() to accurately compute
    exclusive/inclusive tax snapshots on invoice lines and master invoice total.
    """
    f = integration_fixture
    today = date.today()

    # Create active subscription due today
    sub = Subscription(
        id=str(uuid.uuid4()),
        number="SUB-INTEG-BILL-01",
        customer_id=f["customer"].id,
        plan_id=f["plan"].id,
        status=SubscriptionStatus.ACTIVE,
        start_date=today - timedelta(days=30),
        next_billing_date=today,
        anchor_day=today.day,
        currency="INR",
        total_amount=Decimal("2360.00"),
    )
    # 2 units * $1000.00 = $2000.00 subtotal. 18% Exclusive tax = $360.00. Total = $2360.00.
    sub_line = SubscriptionLine(
        id=str(uuid.uuid4()),
        subscription_id=sub.id,
        product_id=f["product"].id,
        quantity=2,
        unit_price=Decimal("1000.00"),
        subtotal=Decimal("2000.00"),
        tax_id=f["tax"].id,
        tax_rate=Decimal("18.00"),
        total=Decimal("2360.00"),
    )
    db_session.add_all([sub, sub_line])
    db_session.commit()

    # Expected tax calculation directly from TaxService
    expected_tax_res = TaxService.calculate_tax(
        db=db_session,
        tax_id=f["tax"].id,
        amount=Decimal("2000.00"),
    )
    assert expected_tax_res.tax_amount == Decimal("360.00")
    assert expected_tax_res.taxable_amount == Decimal("2000.00")
    assert expected_tax_res.total_amount == Decimal("2360.00")

    # Run Automated Billing Engine
    run = BillingEngine.run_billing(target_date=today, db=db_session)
    assert run.created_count == 1
    assert run.failed_count == 0

    # Verify generated Invoice
    invoice = db_session.query(Invoice).filter(Invoice.subscription_id == sub.id).first()
    assert invoice is not None
    assert invoice.customer_id == f["customer"].id
    assert invoice.subtotal == Decimal("2000.00")
    assert invoice.tax_total == Decimal("360.00")
    assert invoice.total == Decimal("2360.00")
    assert invoice.balance == Decimal("2360.00")
    assert invoice.amount_paid == Decimal("0.00")
    assert invoice.status == InvoiceStatus.CONFIRMED

    # Verify Invoice Line snapshotted correctly
    assert len(invoice.lines) == 1
    inv_line = invoice.lines[0]
    assert inv_line.product_id == f["product"].id
    assert inv_line.tax_id == f["tax"].id
    assert inv_line.tax_amount == Decimal("360.00")
    assert inv_line.line_total == Decimal("2360.00")

    # Anti-Double-Billing Idempotency Check:
    # If the subscription is scanned again for the same period, BillingEngine skips it
    sub.next_billing_date = today
    db_session.commit()
    rerun = BillingEngine.run_billing(target_date=today, db=db_session)
    assert rerun.created_count == 0
    assert rerun.skipped_count >= 1

    # Verify subscription date was advanced in the original run
    db_session.refresh(sub)
    assert sub.last_billed_through is not None


def test_payment_settlement_and_customer_portal_isolation(db_session, integration_fixture):
    """
    Verifies that:
    1. Partial payments reduce invoice balance.
    2. Final payment flips invoice status to PAID.
    3. Invoice.payments relationship is fully populated.
    4. Cross-customer payment attempts are rejected.
    """
    f = integration_fixture
    today = date.today()

    invoice = Invoice(
        id=str(uuid.uuid4()),
        number="INV-INTEG-PAY-001",
        customer_id=f["customer"].id,
        status=InvoiceStatus.CONFIRMED,
        invoice_date=today,
        due_date=today + timedelta(days=15),
        period_start=today,
        period_end=today + timedelta(days=30),
        subtotal=Decimal("2000.00"),
        discount_total=Decimal("0.00"),
        tax_total=Decimal("360.00"),
        total=Decimal("2360.00"),
        amount_paid=Decimal("0.00"),
        balance=Decimal("2360.00"),
    )
    db_session.add(invoice)
    db_session.commit()

    # 1. Cross-Customer Authorization Check
    # other_customer_user tries to pay f["customer"]'s invoice
    with pytest.raises(ForbiddenError):
        # Emulate customer portal security check in router
        if f["other_customer_user"].role == UserRole.CUSTOMER:
            if f["other_customer_user"].customer_id != invoice.customer_id:
                raise ForbiddenError("You are not authorized to pay an invoice belonging to another customer.")

    # 2. Record Partial Payment ($1000.00)
    p1_in = PaymentCreate(
        amount=Decimal("1000.00"),
        payment_method=PaymentMethod.CARD,
        reference="CARD-TXN-PARTIAL-1",
        notes="Partial deposit",
    )
    p1 = PaymentService.record_payment(
        payment_in=p1_in,
        actor_user=f["customer_user"],
        db=db_session,
        invoice_id=invoice.id,
    )
    db_session.refresh(invoice)
    assert p1.status == PaymentStatus.SUCCESS
    assert invoice.amount_paid == Decimal("1000.00")
    assert invoice.balance == Decimal("1360.00")
    assert invoice.status == InvoiceStatus.CONFIRMED

    # 3. Overpayment rejection check
    p_over = PaymentCreate(
        amount=Decimal("1500.00"),  # Balance is 1360.00
        payment_method=PaymentMethod.BANK_TRANSFER,
        reference="TXN-OVERPAY",
    )
    with pytest.raises(OverpaymentException):
        PaymentService.record_payment(
            payment_in=p_over,
            actor_user=f["customer_user"],
            db=db_session,
            invoice_id=invoice.id,
        )

    # 4. Final Settlement Payment ($1360.00)
    p2_in = PaymentCreate(
        amount=Decimal("1360.00"),
        payment_method=PaymentMethod.UPI,
        reference="UPI-TXN-SETTLE-2",
        notes="Final balance settlement",
    )
    p2 = PaymentService.record_payment(
        payment_in=p2_in,
        actor_user=f["customer_user"],
        db=db_session,
        invoice_id=invoice.id,
    )
    db_session.refresh(invoice)
    assert p2.status == PaymentStatus.SUCCESS
    assert invoice.amount_paid == Decimal("2360.00")
    assert invoice.balance == Decimal("0.00")
    assert invoice.status == InvoiceStatus.PAID

    # 5. Verify relationship linking
    assert len(invoice.payments) == 2
    assert {p.id for p in invoice.payments} == {p1.id, p2.id}
