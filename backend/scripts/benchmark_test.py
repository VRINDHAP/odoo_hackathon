"""
Performance Benchmark Suite [PDF 5.11, 7.2, 8, 11].
Measures query and batch latency against the design specification SLA:
- All operations & API queries complete in < 2.0s even under high record volume.
- p95 individual read latencies stay strictly under 300ms.

Benchmarks evaluated:
1. Querying subscriptions with line items (evaluating eager-loading & pagination).
2. Executing batch billing run across 100 due active subscriptions.
3. Querying overdue invoices utilizing the partial index (idx_invoices_overdue).
"""
import concurrent.futures
from datetime import date, datetime, timedelta
from decimal import Decimal
import os
import sys
import time
from typing import List, Tuple
import uuid

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
import app.db.base  # Ensures all ORM models are registered in Base.metadata
from app.db.indexes import create_performance_indexes
from app.modules.audit.models import AuditLog
from app.modules.billing.engine import BillingEngine
from app.modules.catalog.models import Product, ProductType
from app.modules.customers.models import Customer
from app.modules.discounts.models import DiscountProduct, DiscountRedemption, DiscountRule
from app.modules.invoices.models import Invoice, InvoiceLine, InvoiceStatus
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.plans.models import BillingPeriod, Plan
from app.modules.subscriptions.models import Subscription, SubscriptionLine, SubscriptionStatus
from app.modules.subscriptions.service import SubscriptionService
from app.modules.taxes.models import Tax


def percentile(data: List[float], p: float) -> float:
    """Computes p-th percentile from a list of numeric timings."""
    if not data:
        return 0.0
    sorted_d = sorted(data)
    k = (len(sorted_d) - 1) * (p / 100.0)
    f = int(k)
    c = f + 1
    if c < len(sorted_d):
        return sorted_d[f] + (k - f) * (sorted_d[c] - sorted_d[f])
    return sorted_d[f]


def setup_benchmark_dataset(session, count_subscriptions: int = 1000, count_due_billing: int = 100):
    """Populates database with high-volume benchmark dataset."""
    print(f"[*] Generating benchmark dataset: {count_subscriptions} subscriptions, {count_due_billing} due for billing...")
    today = date.today()

    # 1. Base Customer, Plan, Product
    cust = Customer(
        id="bench-cust-001",
        name="Benchmark Enterprise Corp",
        email="benchmark@enterprise.io",
        company_name="Benchmark Inc",
        status="active",
        billing_address={"city": "Bengaluru", "country": "India"},
    )
    plan = Plan(
        id="bench-plan-monthly",
        name="Pro Monthly Plan",
        price=Decimal("100.00"),
        billing_period=BillingPeriod.MONTHLY,
        auto_close=False,
        closable=True,
        pausable=True,
        renewable=True,
        is_active=True,
    )
    product = Product(
        id="bench-prod-core",
        name="Core SaaS Seat",
        type=ProductType.SOFTWARE,
        sales_price=Decimal("100.00"),
        cost_price=Decimal("20.00"),
        is_active=True,
    )
    session.add_all([cust, plan, product])
    session.commit()

    # 2. Subscriptions & Lines
    subs = []
    lines = []
    for i in range(1, count_subscriptions + 1):
        is_due = (i <= count_due_billing)
        sub_id = f"bench-sub-{i:05d}"
        next_bill = today if is_due else (today + timedelta(days=i % 28 + 1))
        status = SubscriptionStatus.ACTIVE if (is_due or i % 3 != 0) else SubscriptionStatus.QUOTATION

        sub = Subscription(
            id=sub_id,
            number=f"SUB-BNCH-{i:06d}",
            customer_id=cust.id,
            plan_id=plan.id,
            status=status,
            start_date=today - timedelta(days=60),
            next_billing_date=next_bill,
            anchor_day=min(28, (i % 28) + 1),
            total_amount=Decimal("100.00"),
            currency="INR",
        )
        line = SubscriptionLine(
            id=f"bench-line-{i:05d}",
            subscription_id=sub_id,
            product_id=product.id,
            quantity=1,
            unit_price=Decimal("100.00"),
            tax_rate=Decimal("0.00"),
            subtotal=Decimal("100.00"),
            total=Decimal("100.00"),
        )
        subs.append(sub)
        lines.append(line)

    session.bulk_save_objects(subs)
    session.bulk_save_objects(lines)
    session.commit()

    # 3. Invoices (100 overdue matching partial index: status='confirmed' AND balance > 0)
    invoices = []
    for i in range(1, 201):
        is_overdue = (i <= 100)
        inv_status = InvoiceStatus.CONFIRMED if is_overdue else InvoiceStatus.PAID
        bal = Decimal("100.00") if is_overdue else Decimal("0.00")
        due = (today - timedelta(days=10)) if is_overdue else (today + timedelta(days=15))

        inv = Invoice(
            id=f"bench-inv-{i:05d}",
            number=f"INV-BNCH-{i:06d}",
            subscription_id=subs[i - 1].id,
            customer_id=cust.id,
            status=inv_status,
            invoice_date=today - timedelta(days=25),
            due_date=due,
            period_start=today - timedelta(days=25),
            period_end=today + timedelta(days=5),
            subtotal=Decimal("100.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=Decimal("100.00"),
            amount_paid=Decimal("0.00") if is_overdue else Decimal("100.00"),
            balance=bal,
        )
        invoices.append(inv)

    session.bulk_save_objects(invoices)
    session.commit()
    print(f"[OK] Benchmark dataset seeded: {len(subs)} subscriptions, {len(invoices)} invoices.")


def run_benchmark():
    """Executes the performance test suite and prints SLA metrics."""
    # Build isolated benchmark database
    bench_db_url = "sqlite:///./benchmark_perf.db"
    if os.path.exists("./benchmark_perf.db"):
        try:
            os.remove("./benchmark_perf.db")
        except Exception:
            pass

    engine = create_engine(bench_db_url, connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    session = Session()

    Base.metadata.create_all(bind=engine)
    create_performance_indexes(engine=engine)

    setup_benchmark_dataset(session, count_subscriptions=1000, count_due_billing=100)

    print("\n" + "=" * 80)
    print(" Brightloop Performance Benchmark Suite (Step 11 - SLA Verification)")
    print("=" * 80)

    results = []

    # ------------------------------------------------------------------------
    # Benchmark 1: Querying Subscriptions with Eager Loading (50 queries)
    # ------------------------------------------------------------------------
    print("\n[Benchmark 1/3] Measuring Subscription List & Eager Loading Latency...")
    sub_latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        subs, total = SubscriptionService.list_subscriptions(
            db=session,
            skip=0,
            limit=50,
        )
        # Touch eager-loaded lines to verify zero N+1 queries
        for s in subs:
            _ = len(s.lines)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        sub_latencies.append(dt_ms)

    p50_sub = percentile(sub_latencies, 50)
    p95_sub = percentile(sub_latencies, 95)
    max_sub = max(sub_latencies)
    pass_sub = p95_sub < 300.0
    results.append(("Subscription Listing (Eager Load)", 50, p50_sub, p95_sub, max_sub, "< 300 ms", pass_sub))

    # ------------------------------------------------------------------------
    # Benchmark 2: Batch Billing Run across 100 Due Subscriptions
    # ------------------------------------------------------------------------
    print("\n[Benchmark 2/3] Executing Automated Billing Run across 100 Subscriptions...")
    today = date.today()
    t0_billing = time.perf_counter()
    billing_run = BillingEngine.run_billing(
        target_date=today,
        batch_size=100,
        db=session,
    )
    total_billing_s = time.perf_counter() - t0_billing
    pass_billing = total_billing_s < 2.0
    results.append(("Batch Billing Run (100 subs)", 1, total_billing_s * 1000.0, total_billing_s * 1000.0, total_billing_s * 1000.0, "< 2.0 s", pass_billing))

    # ------------------------------------------------------------------------
    # Benchmark 3: Overdue Invoices Scan via Partial Index (50 queries)
    # ------------------------------------------------------------------------
    print("\n[Benchmark 3/3] Querying Overdue Invoices using Partial Index...")
    inv_latencies = []
    overdue_stmt = text(
        "SELECT id, number, customer_id, balance, due_date "
        "FROM invoices "
        "WHERE status = 'confirmed' AND balance > 0 AND due_date <= :today "
        "ORDER BY due_date ASC "
        "LIMIT 50"
    )

    for _ in range(50):
        t0 = time.perf_counter()
        rows = session.execute(overdue_stmt, {"today": today}).fetchall()
        dt_ms = (time.perf_counter() - t0) * 1000.0
        inv_latencies.append(dt_ms)

    p50_inv = percentile(inv_latencies, 50)
    p95_inv = percentile(inv_latencies, 95)
    max_inv = max(inv_latencies)
    pass_inv = p95_inv < 300.0
    results.append(("Overdue Invoices (Partial Index)", 50, p50_inv, p95_inv, max_inv, "< 300 ms", pass_inv))

    # ------------------------------------------------------------------------
    # Telemetry Summary Table
    # ------------------------------------------------------------------------
    print("\n" + "-" * 88)
    print(f"{'Benchmark Target':<35} | {'Runs':<5} | {'p50 (ms)':<9} | {'p95 (ms)':<9} | {'Max (ms)':<9} | {'SLA Target':<10} | {'Status'}")
    print("-" * 88)
    all_passed = True
    for name, runs, p50, p95, max_val, target, status in results:
        status_str = "PASS [OK]" if status else "FAIL [X]"
        if not status:
            all_passed = False
        print(f"{name:<35} | {runs:<5} | {p50:<9.2f} | {p95:<9.2f} | {max_val:<9.2f} | {target:<10} | {status_str}")
    print("-" * 88)

    session.close()
    if os.path.exists("./benchmark_perf.db"):
        try:
            os.remove("./benchmark_perf.db")
        except Exception:
            pass

    if all_passed:
        print("\n[SUCCESS] All operations and query responses completed well within the < 2s design SLA.")
        return 0
    else:
        print("\n[FAILURE] One or more benchmarks exceeded the required latency threshold.")
        return 1


if __name__ == "__main__":
    sys.exit(run_benchmark())
