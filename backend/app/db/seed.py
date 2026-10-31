"""
Database Seeder Script for Local Dev and Demo [PDF 15].
Owned by Vrindha.

Populates realistic Brightloop business test fixtures:
- 3 Plans: Monthly Pro, Yearly Enterprise, Daily Trial
- 2 Products & Variants: Core Platform ($100), Brand Variant (+$560)
- 1 Tax: Standard VAT/GST (18% exclusive)
- 3 Customers with distinct billing addresses
- 6 Subscriptions across Quotation, Confirmed, Active (due today, billed through next month, anchor_day=31), and Paused states
- 2 Discounts: 1 Active 15% discount (min purchase + usage cap), 1 Expired fixed discount

Usage:
    python -m backend.app.db.seed
    or
    python -m app.db.seed
    or
    python backend/app/db/seed.py
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal

# Ensure backend root is on sys.path regardless of how the script is invoked
_current_dir = os.path.dirname(os.path.abspath(__file__))
_backend_root = os.path.abspath(os.path.join(_current_dir, "..", ".."))
_repo_root = os.path.abspath(os.path.join(_backend_root, ".."))

for _p in (_backend_root, _repo_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.core.database import Base, SessionLocal, engine
from app.modules.catalog.models import Product, ProductType, ProductVariant
from app.modules.customers.models import Customer
from app.modules.discounts.models import DiscountRule, DiscountScope, DiscountType
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus
from app.modules.taxes.models import Tax, TaxType


def seed_database() -> dict:
    """
    Populates database with idempotent demonstration fixtures.
    Safe to execute multiple times.
    """
    # Ensure physical schema exists in database
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        today = date.today()
        print(f"[*] Starting Brightloop database seeding (reference date: {today})...")

        # ====================================================================
        # 1. TAXES
        # ====================================================================
        tax_id = "tax-seed-gst-18"
        db.query(Tax).filter(Tax.id == tax_id).delete()

        tax_vat = Tax(
            id=tax_id,
            name="Standard VAT/GST (18% exclusive)",
            type=TaxType.PERCENT,
            rate=Decimal("18.00"),
            inclusive=False,
            is_active=True,
        )
        db.add(tax_vat)
        db.flush()
        print("  [+] Seeded Tax: Standard VAT/GST (18% exclusive)")

        # ====================================================================
        # 2. PLANS
        # ====================================================================
        plan_ids = ["plan-monthly-pro", "plan-yearly-enterprise", "plan-daily-trial"]
        db.query(Plan).filter(Plan.id.in_(plan_ids)).delete()

        plan_monthly = Plan(
            id="plan-monthly-pro",
            name="Monthly Pro",
            price=Decimal("100.00"),
            billing_period=BillingPeriod.MONTHLY,
            min_quantity=1,
            auto_close=False,
            closable=True,
            pausable=True,
            renewable=True,
            is_active=True,
        )
        plan_yearly = Plan(
            id="plan-yearly-enterprise",
            name="Yearly Enterprise",
            price=Decimal("1000.00"),
            billing_period=BillingPeriod.YEARLY,
            min_quantity=1,
            auto_close=False,
            closable=True,
            pausable=True,
            renewable=True,
            is_active=True,
        )
        plan_trial = Plan(
            id="plan-daily-trial",
            name="Daily Trial",
            price=Decimal("10.00"),
            billing_period=BillingPeriod.DAILY,
            min_quantity=1,
            auto_close=True,
            closable=True,
            pausable=False,
            renewable=False,
            is_active=True,
        )
        db.add_all([plan_monthly, plan_yearly, plan_trial])
        db.flush()
        print(f"  [+] Seeded {len(plan_ids)} Plans: Monthly Pro, Yearly Enterprise, Daily Trial")

        # ====================================================================
        # 3. PRODUCTS & VARIANTS
        # ====================================================================
        prod_ids = ["prod-core-platform", "prod-brand-variant"]
        db.query(ProductVariant).filter(ProductVariant.product_id.in_(prod_ids)).delete()
        db.query(Product).filter(Product.id.in_(prod_ids)).delete()

        prod_core = Product(
            id="prod-core-platform",
            name="Core Platform",
            type=ProductType.SOFTWARE,
            sales_price=Decimal("100.00"),
            cost_price=Decimal("30.00"),
            tax_id=tax_vat.id,
            notes="Standard monthly base platform access",
            is_active=True,
        )
        prod_brand = Product(
            id="prod-brand-variant",
            name="Brand Platform",
            type=ProductType.SOFTWARE,
            sales_price=Decimal("100.00"),
            cost_price=Decimal("30.00"),
            tax_id=tax_vat.id,
            notes="Platform with custom corporate branding",
            is_active=True,
        )
        db.add_all([prod_core, prod_brand])
        db.flush()

        variant_brand = ProductVariant(
            id="var-brand-custom",
            product_id=prod_brand.id,
            attribute="Brand",
            value="Enterprise Custom",
            extra_price=Decimal("560.00"),
            is_active=True,
        )
        db.add(variant_brand)
        db.flush()
        print("  [+] Seeded Products: Core Platform ($100), Brand Variant (+$560 extra)")

        # ====================================================================
        # 4. CUSTOMERS
        # ====================================================================
        cust_ids = ["cust-acme-corp", "cust-globex-uk", "cust-stark-labs"]
        # Delete existing subscriptions for these customers first to avoid FK errors
        sub_ids = [
            "sub-seed-quotation",
            "sub-seed-confirmed",
            "sub-seed-active-due",
            "sub-seed-active-future",
            "sub-seed-active-anchor31",
            "sub-seed-paused",
        ]
        db.query(SubscriptionLine).filter(SubscriptionLine.subscription_id.in_(sub_ids)).delete()
        db.query(Subscription).filter(Subscription.id.in_(sub_ids)).delete()
        db.query(Customer).filter(Customer.id.in_(cust_ids)).delete()

        cust_acme = Customer(
            id="cust-acme-corp",
            name="Acme Corporation",
            email="billing@acmecorp.io",
            phone="+1-555-0199",
            company_name="Acme Corp LLC",
            tax_id="US-EIN-987654321",
            billing_address={
                "street": "100 Market St, Suite 400",
                "city": "San Francisco",
                "state": "CA",
                "zip": "94105",
                "country": "USA",
            },
            status="active",
        )
        cust_globex = Customer(
            id="cust-globex-uk",
            name="Globex Industries",
            email="accounts@globex.co.uk",
            phone="+44-20-7946-0912",
            company_name="Globex UK Ltd",
            tax_id="GB-VAT-123456789",
            billing_address={
                "street": "250 Bishopsgate",
                "city": "London",
                "state": "Greater London",
                "zip": "EC2M 4AA",
                "country": "UK",
            },
            status="active",
        )
        cust_stark = Customer(
            id="cust-stark-labs",
            name="Stark Labs",
            email="finance@starklabs.in",
            phone="+91-80-2345-6789",
            company_name="Stark Technologies Pvt Ltd",
            tax_id="IN-GSTIN-29AAAAA0000A1Z5",
            billing_address={
                "street": "Plot 42, Outer Ring Road",
                "city": "Bengaluru",
                "state": "Karnataka",
                "zip": "560103",
                "country": "India",
            },
            status="active",
        )
        db.add_all([cust_acme, cust_globex, cust_stark])
        db.flush()
        print(f"  [+] Seeded {len(cust_ids)} Customers: Acme Corp (US), Globex (UK), Stark Labs (IN)")

        # ====================================================================
        # 5. SUBSCRIPTIONS
        # ====================================================================
        # 1. Quotation state
        sub_quote = Subscription(
            id="sub-seed-quotation",
            number="SUB-SEED-QUOTE-001",
            customer_id=cust_acme.id,
            plan_id=plan_monthly.id,
            status=SubscriptionStatus.QUOTATION,
            start_date=today,
            quotation_expires_at=today + timedelta(days=14),
            anchor_day=today.day,
            currency="INR",
            subtotal=Decimal("100.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("18.00"),
            total_amount=Decimal("118.00"),
        )
        sub_quote_line = SubscriptionLine(
            id="subline-quote-1",
            subscription_id=sub_quote.id,
            product_id=prod_core.id,
            quantity=1,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("118.00"),
            description="Core Platform License (Quotation)",
        )

        # 2. Confirmed state
        sub_conf = Subscription(
            id="sub-seed-confirmed",
            number="SUB-SEED-CONF-002",
            customer_id=cust_globex.id,
            plan_id=plan_yearly.id,
            status=SubscriptionStatus.CONFIRMED,
            start_date=today + timedelta(days=5),
            anchor_day=(today + timedelta(days=5)).day,
            currency="INR",
            subtotal=Decimal("660.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("118.80"),
            total_amount=Decimal("778.80"),
        )
        sub_conf_line = SubscriptionLine(
            id="subline-conf-1",
            subscription_id=sub_conf.id,
            product_id=prod_brand.id,
            quantity=1,
            unit_price=Decimal("660.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("660.00"),
            total=Decimal("778.80"),
            description="Brand Platform with Customization (Confirmed)",
        )

        # 3. Active state: Due for billing today (next_billing_date <= today)
        sub_active_due = Subscription(
            id="sub-seed-active-due",
            number="SUB-SEED-DUE-003",
            customer_id=cust_acme.id,
            plan_id=plan_monthly.id,
            status=SubscriptionStatus.ACTIVE,
            start_date=today - timedelta(days=30),
            next_billing_date=today,
            anchor_day=today.day,
            currency="INR",
            subtotal=Decimal("200.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("36.00"),
            total_amount=Decimal("236.00"),
        )
        sub_active_due_line = SubscriptionLine(
            id="subline-due-1",
            subscription_id=sub_active_due.id,
            product_id=prod_core.id,
            quantity=2,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("200.00"),
            total=Decimal("236.00"),
            description="Core Platform x2 (Due for Billing)",
        )

        # 4. Active state: Billed through next month
        future_billing_date = today + timedelta(days=30)
        sub_active_future = Subscription(
            id="sub-seed-active-future",
            number="SUB-SEED-FUTR-004",
            customer_id=cust_stark.id,
            plan_id=plan_monthly.id,
            status=SubscriptionStatus.ACTIVE,
            start_date=today,
            last_billed_through=future_billing_date,
            next_billing_date=future_billing_date,
            anchor_day=today.day,
            currency="INR",
            subtotal=Decimal("660.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("118.80"),
            total_amount=Decimal("778.80"),
        )
        sub_active_future_line = SubscriptionLine(
            id="subline-futr-1",
            subscription_id=sub_active_future.id,
            product_id=prod_brand.id,
            quantity=1,
            unit_price=Decimal("660.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("660.00"),
            total=Decimal("778.80"),
            description="Brand Platform (Billed Through Next Month)",
        )

        # 5. Active state: With anchor_day=31
        sub_active_anchor31 = Subscription(
            id="sub-seed-active-anchor31",
            number="SUB-SEED-ANC31-005",
            customer_id=cust_globex.id,
            plan_id=plan_monthly.id,
            status=SubscriptionStatus.ACTIVE,
            start_date=date(today.year, 1, 31),
            next_billing_date=date(today.year, 2, 28) if today.month <= 2 else date(today.year, today.month, 28),
            anchor_day=31,
            currency="INR",
            subtotal=Decimal("100.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("18.00"),
            total_amount=Decimal("118.00"),
        )
        sub_active_anchor31_line = SubscriptionLine(
            id="subline-anc31-1",
            subscription_id=sub_active_anchor31.id,
            product_id=prod_core.id,
            quantity=1,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("118.00"),
            description="Core Platform (Anchor Day 31)",
        )

        # 6. Paused state
        sub_paused = Subscription(
            id="sub-seed-paused",
            number="SUB-SEED-PAUS-006",
            customer_id=cust_stark.id,
            plan_id=plan_monthly.id,
            status=SubscriptionStatus.PAUSED,
            start_date=today - timedelta(days=60),
            paused_at=datetime.utcnow() - timedelta(days=10),
            anchor_day=today.day,
            currency="INR",
            subtotal=Decimal("100.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("18.00"),
            total_amount=Decimal("118.00"),
        )
        sub_paused_line = SubscriptionLine(
            id="subline-paus-1",
            subscription_id=sub_paused.id,
            product_id=prod_core.id,
            quantity=1,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("18.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("118.00"),
            description="Core Platform (Temporarily Paused)",
        )

        db.add_all([
            sub_quote, sub_quote_line,
            sub_conf, sub_conf_line,
            sub_active_due, sub_active_due_line,
            sub_active_future, sub_active_future_line,
            sub_active_anchor31, sub_active_anchor31_line,
            sub_paused, sub_paused_line,
        ])
        db.flush()
        print("  [+] Seeded 6 Subscriptions across Quotation, Confirmed, Active (Due, Future, Anchor 31), and Paused")

        # ====================================================================
        # 6. DISCOUNTS
        # ====================================================================
        disc_ids = ["disc-seed-active-15", "disc-seed-expired-50"]
        db.query(DiscountRule).filter(DiscountRule.id.in_(disc_ids)).delete()

        # 1. Active 15% discount with min_purchase threshold and usage_limit=10
        disc_active = DiscountRule(
            id="disc-seed-active-15",
            name="Spring Boost 15% Off",
            type=DiscountType.PERCENT,
            value=Decimal("15.00"),
            min_purchase_amount=Decimal("150.00"),
            min_quantity=1,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=90),
            usage_limit=10,
            usage_count=2,
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )

        # 2. Expired fixed-amount discount
        disc_expired = DiscountRule(
            id="disc-seed-expired-50",
            name="Holiday Flash $50 Off",
            type=DiscountType.FIXED,
            value=Decimal("50.00"),
            min_purchase_amount=Decimal("200.00"),
            min_quantity=1,
            start_date=date(today.year - 1, 12, 1),
            end_date=date(today.year - 1, 12, 31),
            usage_limit=50,
            usage_count=48,
            scope=DiscountScope.SUBSCRIPTION,
            is_active=True,
        )

        db.add_all([disc_active, disc_expired])
        db.commit()
        print("  [+] Seeded 2 Discounts: 1 Active 15% (min purchase $150, limit 10), 1 Expired fixed $50")

        print("[OK] Seeding successfully completed!")
        return {
            "taxes": 1,
            "plans": 3,
            "products": 2,
            "customers": 3,
            "subscriptions": 6,
            "discounts": 2,
        }

    except Exception as exc:
        db.rollback()
        print(f"[!] Seeding failed with error: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()

