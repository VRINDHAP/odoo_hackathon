"""Create reusable demo data for the Brightloop development database."""

import os
import uuid
from datetime import date, timedelta
from pathlib import Path

import psycopg
from argon2 import PasswordHasher
from dotenv import load_dotenv
from psycopg.types.json import Jsonb


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@Brightloop2026!")

# Match the backend's Argon2id configuration.
hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def demo_id(name):
    """Generate a consistent UUID for each demo record."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"brightloop-demo:{name}")


def main():
    password_hash = hasher.hash(DEMO_PASSWORD)
    today = date.today()

    with psycopg.connect(
        host="localhost",
        port=5433,
        dbname="brightloop_db",
        user="brightloop_user",
        password=os.environ["POSTGRES_PASSWORD"],
    ) as conn:
        with conn.cursor() as cur:

            # 1. GST
            tax_id = demo_id("gst-18")
            cur.execute("""
                INSERT INTO taxes (id, name, type, rate, inclusive, applies_to)
                VALUES (%s, 'GST 18%%', 'percent', 18, FALSE, 'all')
                ON CONFLICT (id) DO UPDATE
                SET name = EXCLUDED.name, rate = EXCLUDED.rate
            """, (tax_id,))

            # 2. Customers
            customer_data = [
                ("Aarav Technologies", "aarav@example.com"),
                ("Bluewave Solutions", "bluewave@example.com"),
                ("Cedar Innovations", "cedar@example.com"),
                ("Delta Systems", "delta@example.com"),
                ("Evergreen Digital", "evergreen@example.com"),
                ("Fusion Labs", "fusion@example.com"),
                ("Greenfield Retail", "greenfield@example.com"),
                ("Horizon Media", "horizon@example.com"),
                ("Indigo Networks", "indigo@example.com"),
                ("Juniper Works", "juniper@example.com"),
            ]

            customer_ids = []

            for name, email in customer_data:
                customer_id = demo_id(email)
                customer_ids.append(customer_id)

                cur.execute("""
                    INSERT INTO customers
                        (id, name, email, company_name, billing_address)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        email = EXCLUDED.email,
                        company_name = EXCLUDED.company_name
                """, (
                    customer_id, name, email, name,
                    Jsonb({
                        "address_line": "123 Demo Street",
                        "city": "Thrissur",
                        "state": "Kerala",
                        "country": "India",
                        "postal_code": "680001",
                    }),
                ))

            # 3. Products
            products = [
                ("Cloud Support", "service", 1500, 500),
                ("Business Software", "software", 5000, 2000),
                ("Extra Storage", "addon", 500, 100),
                ("Network Device", "physical", 2500, 1800),
            ]

            product_ids = []

            for name, product_type, price, cost in products:
                product_id = demo_id(f"product-{name}")
                product_ids.append(product_id)

                cur.execute("""
                    INSERT INTO products
                        (id, name, type, sales_price, cost_price, tax_id)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        sales_price = EXCLUDED.sales_price,
                        cost_price = EXCLUDED.cost_price,
                        tax_id = EXCLUDED.tax_id
                """, (product_id, name, product_type, price, cost, tax_id))

            # 4. Subscription plans
            plans = [
                ("Monthly Basic", 1500, "monthly"),
                ("Yearly Business", 48000, "yearly"),
                ("Weekly Starter", 500, "weekly"),
            ]

            plan_ids = []

            for name, price, period in plans:
                plan_id = demo_id(f"plan-{name}")
                plan_ids.append(plan_id)

                cur.execute("""
                    INSERT INTO plans
                        (id, name, price, billing_period, valid_from)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        price = EXCLUDED.price,
                        billing_period = EXCLUDED.billing_period
                """, (plan_id, name, price, period, today - timedelta(days=365)))

            # 5. Payment terms
            terms = [("Immediate", 0), ("Net 15", 15), ("Net 30", 30)]
            term_ids = []

            for name, days in terms:
                term_id = demo_id(f"payment-term-{name}")
                term_ids.append(term_id)

                cur.execute("""
                    INSERT INTO payment_terms (id, name, days)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        days = EXCLUDED.days
                """, (term_id, name, days))

            # 6. Admin and staff users
            users = [
                ("admin@brightloop.io", "admin", None),
                ("staff1@brightloop.io", "staff", None),
                ("staff2@brightloop.io", "staff", None),
            ]

            # Each demo customer also receives a portal login.
            for i, customer_id in enumerate(customer_ids, start=1):
                users.append((
                    f"customer{i}@brightloop.io",
                    "customer",
                    customer_id,
                ))

            for email, role, customer_id in users:
                user_id = demo_id(f"user-{email}")

                cur.execute("""
                    INSERT INTO users
                        (id, email, password_hash, role, customer_id)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (user_id, email, password_hash, role, customer_id))

                # Keep an existing account linked to its demo customer.
                cur.execute("""
                    UPDATE users
                    SET role = %s, customer_id = %s, is_active = TRUE
                    WHERE lower(email) = lower(%s)
                """, (role, customer_id, email))

            # 7. Ten sample customer subscriptions and their lines
            statuses = [
                "active", "active", "active", "active", "active",
                "active", "active", "paused", "closed", "active",
            ]

            for i, customer_id in enumerate(customer_ids):
                plan_id = plan_ids[i % len(plan_ids)]
                product_id = product_ids[i % len(product_ids)]
                term_id = term_ids[i % len(term_ids)]
                price = plans[i % len(plans)][1]
                status = statuses[i]

                subscription_id = demo_id(f"subscription-{i + 1}")
                subscription_number = f"DEMO-SUB-{i + 1:03d}"

                cur.execute("""
                    INSERT INTO subscriptions (
                        id, number, customer_id, plan_id, status,
                        start_date, next_billing_date, anchor_day,
                        payment_term_id, subtotal, tax_total, total
                    )
                    VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (number) DO UPDATE SET
                        customer_id = EXCLUDED.customer_id,
                        plan_id = EXCLUDED.plan_id,
                        status = EXCLUDED.status,
                        next_billing_date = EXCLUDED.next_billing_date,
                        total = EXCLUDED.total
                """, (
                    subscription_id,
                    subscription_number,
                    customer_id,
                    plan_id,
                    status,
                    today - timedelta(days=90),
                    today + timedelta(days=30) if status == "active" else None,
                    today.day,
                    term_id,
                    price,
                    round(price * 0.18, 2),
                    round(price * 1.18, 2),
                ))

                cur.execute("""
                    SELECT id FROM subscriptions WHERE number = %s
                """, (subscription_number,))
                actual_subscription_id = cur.fetchone()[0]

                line_id = demo_id(f"subscription-line-{i + 1}")
                tax_amount = round(price * 0.18, 2)

                cur.execute("""
                    INSERT INTO subscription_lines (
                        id, subscription_id, product_id, description,
                        quantity, unit_price, tax_id,
                        line_subtotal, line_tax, line_total
                    )
                    VALUES (%s, %s, %s, %s, 1, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        subscription_id = EXCLUDED.subscription_id,
                        product_id = EXCLUDED.product_id,
                        unit_price = EXCLUDED.unit_price,
                        line_total = EXCLUDED.line_total
                """, (
                    line_id, actual_subscription_id, product_id,
                    products[i % len(products)][0], price, tax_id,
                    price, tax_amount, price + tax_amount,
                ))

        # The connection context commits automatically on success.
        print("Demo seed completed successfully.")
        print("Customers: 10")
        print("Users: 13 (1 admin, 2 staff, 10 customer accounts)")
        print("Products: 4")
        print("Plans: 3")
        print("Taxes: 1")
        print("Payment terms: 3")
        print("Subscriptions: 10")
        print("Subscription lines: 10")
        print("Demo login password: set DEMO_PASSWORD or use the documented default.")


if __name__ == "__main__":
    main()
