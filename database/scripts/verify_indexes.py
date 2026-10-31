import os
import json
import hashlib
import psycopg
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DB_NAME = os.getenv("DATABASE_NAME", "brightloop_db")

if DB_NAME != "brightloop_perf_db":
    raise SystemExit("Error: Run this script only against brightloop_perf_db.")

conn = psycopg.connect(
    host=os.getenv("DATABASE_HOST", "127.0.0.1"),
    port=os.getenv("DATABASE_PORT", "5433"),
    dbname=DB_NAME,
    user=os.getenv("POSTGRES_USER", "brightloop_user"),
    password=os.getenv("POSTGRES_PASSWORD"),
)

queries = [
    (
        "Billing query",
        """
        SELECT id, number, customer_id, plan_id, next_billing_date
        FROM subscriptions
        WHERE status = 'active'
          AND next_billing_date <= CURRENT_DATE
        """,
        (),
        "idx_subscriptions_status_billing_date",
        10,
    ),
    (
        "Overdue invoices query",
        """
        SELECT id, number, customer_id, due_date, balance
        FROM invoices
        WHERE status = 'confirmed'
          AND balance > 0
          AND due_date < CURRENT_DATE
        """,
        (),
        "idx_invoices_overdue_partial",
        5,
    ),
    (
        "Customer invoices query",
        """
        SELECT id, number, invoice_date, due_date, total, balance
        FROM invoices
        WHERE customer_id = %s
          AND status = 'confirmed'
        """,
        (str(__import__("uuid").UUID(hashlib.md5(
            b"perf-customer-1"
        ).hexdigest())),),
        "idx_invoices_customer_id_status",
        2,
    ),
]


def find_indexes(node):
    indexes = []

    if isinstance(node, dict):
        if "Index Name" in node:
            indexes.append(node["Index Name"])

        for value in node.values():
            indexes.extend(find_indexes(value))

    elif isinstance(node, list):
        for item in node:
            indexes.extend(find_indexes(item))

    return indexes


try:
    with conn.cursor() as cur:
        for name, query, params, expected_index, target in queries:
            print(f"\n{'=' * 60}")
            print(name)
            print(f"{'=' * 60}")

            cur.execute(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query,
                params,
            )

            result = cur.fetchone()[0]

            if isinstance(result, str):
                result = json.loads(result)

            plan = result[0]
            execution_time = plan["Execution Time"]
            indexes = find_indexes(plan["Plan"])

            print(f"Expected index : {expected_index}")
            print(f"Used indexes   : {indexes or 'None'}")
            print(f"Execution time : {execution_time:.3f} ms")
            print(f"Target         : < {target} ms")

            if expected_index in indexes and execution_time < target:
                print("Result         : PASS")
            else:
                print("Result         : NEEDS REVIEW")

finally:
    conn.close()
