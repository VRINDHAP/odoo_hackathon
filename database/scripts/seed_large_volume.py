"""Generate performance-test data in brightloop_perf_db."""

import os
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

DATABASE_NAME = os.getenv("DATABASE_NAME", "brightloop_perf_db")
DATABASE_PORT = int(os.getenv("DATABASE_PORT", "5433"))

CUSTOMER_COUNT = 100
SUBSCRIPTION_COUNT = 50_000
INVOICES_PER_SUBSCRIPTION = 10


def main():
    if DATABASE_NAME != "brightloop_perf_db":
        raise RuntimeError(
            "This script only runs against brightloop_perf_db. "
            "Set DATABASE_NAME=brightloop_perf_db."
        )

    started = time.perf_counter()

    with psycopg.connect(
        host=os.getenv("DATABASE_HOST", "localhost"),
        port=DATABASE_PORT,
        dbname=DATABASE_NAME,
        user="brightloop_user",
        password=os.environ["POSTGRES_PASSWORD"],
    ) as conn:
        with conn.cursor() as cur:

            # Refuse to duplicate an existing performance dataset.
            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM subscriptions),
                    (SELECT COUNT(*) FROM invoices)
            """)
            subscriptions, invoices = cur.fetchone()

            if subscriptions or invoices:
                raise RuntimeError(
                    f"Database already contains {subscriptions} subscriptions "
                    f"and {invoices} invoices. Refusing to duplicate data."
                )

            print("Creating prerequisite customers...")

            cur.execute("""
                INSERT INTO customers (
                    id, name, email, billing_address
                )
                SELECT
                    md5('perf-customer-' || n::TEXT)::UUID,
                    'Performance Customer ' || n,
                    'perf-customer-' || n || '@example.com',
                    jsonb_build_object(
                        'city', 'Thrissur',
                        'state', 'Kerala',
                        'country', 'India'
                    )
                FROM generate_series(1, 100) AS n
            """)

            print("Creating prerequisite plans...")

            cur.execute("""
                INSERT INTO plans (
                    id, name, price, billing_period, valid_from
                )
                SELECT
                    md5('perf-plan-' || n::TEXT)::UUID,
                    'Performance Plan ' || n,
                    CASE n
                        WHEN 1 THEN 1500
                        WHEN 2 THEN 48000
                        ELSE 500
                    END,
                    CASE n
                        WHEN 1 THEN 'monthly'::billing_period
                        WHEN 2 THEN 'yearly'::billing_period
                        ELSE 'weekly'::billing_period
                    END,
                    CURRENT_DATE - 365
                FROM generate_series(1, 3) AS n
            """)

            print("Creating payment terms...")

            cur.execute("""
                INSERT INTO payment_terms (id, name, days)
                VALUES
                    (md5('perf-term-1')::UUID, 'Immediate', 0),
                    (md5('perf-term-2')::UUID, 'Net 15', 15),
                    (md5('perf-term-3')::UUID, 'Net 30', 30)
            """)

            print("Generating 50,000 subscriptions...")

            cur.execute("""
                INSERT INTO subscriptions (
                    id, number, customer_id, plan_id, status,
                    start_date, next_billing_date, anchor_day,
                    payment_term_id, subtotal, tax_total, total
                )
                SELECT
                    md5('perf-sub-' || n::TEXT)::UUID,
                    'PERF-SUB-' || lpad(n::TEXT, 6, '0'),
                    md5(
                        'perf-customer-' ||
                        (((n - 1) % 100) + 1)::TEXT
                    )::UUID,
                    md5(
                        'perf-plan-' ||
                        (((n - 1) % 3) + 1)::TEXT
                    )::UUID,
                    CASE
                        WHEN n % 20 = 0 THEN 'closed'::subscription_status
                        WHEN n % 20 IN (1, 2) THEN 'paused'::subscription_status
                        ELSE 'active'::subscription_status
                    END,
                    CURRENT_DATE - (n % 365),
                    CASE
                        WHEN n % 20 NOT IN (0, 1, 2)
                        THEN CURRENT_DATE + ((n % 61) - 30)
                        ELSE NULL
                    END,
                    ((n - 1) % 28) + 1,
                    md5(
                        'perf-term-' ||
                        (((n - 1) % 3) + 1)::TEXT
                    )::UUID,
                    CASE ((n - 1) % 3)
                        WHEN 0 THEN 1500
                        WHEN 1 THEN 48000
                        ELSE 500
                    END,
                    CASE ((n - 1) % 3)
                        WHEN 0 THEN 270
                        WHEN 1 THEN 8640
                        ELSE 90
                    END,
                    CASE ((n - 1) % 3)
                        WHEN 0 THEN 1770
                        WHEN 1 THEN 56640
                        ELSE 590
                    END
                FROM generate_series(1, 50000) AS n
            """)

            print("Generating 500,000 invoices...")

            cur.execute("""
                INSERT INTO invoices (
                    id, number, subscription_id, customer_id,
                    status, invoice_date, due_date,
                    period_start, period_end, currency,
                    subtotal, discount_total, tax_total,
                    total, amount_paid, balance
                )
                SELECT
                    md5(
                        'perf-invoice-' || s.n::TEXT || '-' ||
                        g.invoice_no::TEXT
                    )::UUID,
                    'PERF-INV-' || lpad(s.n::TEXT, 6, '0') ||
                    '-' || lpad(g.invoice_no::TEXT, 2, '0'),
                    md5('perf-sub-' || s.n::TEXT)::UUID,
                    md5(
                        'perf-customer-' ||
                        (((s.n - 1) % 100) + 1)::TEXT
                    )::UUID,
                    CASE g.invoice_no % 4
                        WHEN 0 THEN 'confirmed'::invoice_status
                        WHEN 1 THEN 'paid'::invoice_status
                        WHEN 2 THEN 'draft'::invoice_status
                        ELSE 'cancelled'::invoice_status
                    END,
                    CURRENT_DATE - ((g.invoice_no + 1) * 30),
                    CASE
                        WHEN g.invoice_no % 4 = 0 AND s.n % 100 = 0
                        THEN CURRENT_DATE - ((g.invoice_no + 1) * 30) + 15
                        ELSE CURRENT_DATE + 15
                    END,
                    CURRENT_DATE - ((g.invoice_no + 1) * 30),
                    CURRENT_DATE - ((g.invoice_no + 1) * 30) + 29,
                    'INR',
                    1000.00,
                    0.00,
                    180.00,
                    1180.00,
                    CASE WHEN g.invoice_no % 4 = 1
                         THEN 1180.00 ELSE 0.00 END,
                    CASE WHEN g.invoice_no % 4 = 0
                         OR g.invoice_no % 4 = 2
                         THEN 1180.00 ELSE 0.00 END
                FROM generate_series(1, 50000) AS s(n)
                CROSS JOIN generate_series(1, 10) AS g(invoice_no)
            """)

            print("Updating database statistics...")
            cur.execute("ANALYZE subscriptions")
            cur.execute("ANALYZE invoices")

            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM subscriptions),
                    (SELECT COUNT(*) FROM invoices)
            """)
            subscription_count, invoice_count = cur.fetchone()

            if subscription_count != SUBSCRIPTION_COUNT:
                raise RuntimeError(
                    f"Expected 50,000 subscriptions, got {subscription_count}"
                )

            expected_invoices = (
                SUBSCRIPTION_COUNT * INVOICES_PER_SUBSCRIPTION
            )
            if invoice_count != expected_invoices:
                raise RuntimeError(
                    f"Expected {expected_invoices} invoices, got {invoice_count}"
                )

    elapsed = time.perf_counter() - started

    print("\nPerformance dataset created successfully.")
    print(f"Subscriptions: {subscription_count:,}")
    print(f"Invoices:      {invoice_count:,}")
    print(f"Time taken:    {elapsed:.2f} seconds")


if __name__ == "__main__":
    main()
