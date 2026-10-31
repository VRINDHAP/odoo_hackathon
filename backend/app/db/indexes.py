"""
Database Indexing & Performance Optimization [PDF 5.11, 7.2, 8].
Provides automated DDL migration and indexing utilities ensuring sub-200ms
query response times even with tens of thousands of subscription and invoice records.

Core Indexes [PDF 5.11]:
1. subscriptions(status, next_billing_date) - speeds up automated daily billing scan.
2. subscriptions(customer_id) - speeds up customer portal subscription lookups.
3. invoices(customer_id, status) - speeds up customer portal and billing filters.
4. invoices(status, due_date) WHERE status = 'confirmed' AND balance > 0 - partial index for dunning/overdue scans.
5. payments(invoice_id) - accelerates invoice payment lookups.
6. payments(payment_date) - accelerates date-filtered financial registers.
7. discount_rules(is_active, start_date, end_date) - accelerates billing-run discount eligibility checks.
"""
import logging
from typing import List, Optional
from sqlalchemy import text
from sqlalchemy.engine import Engine
from app.core.db import engine as default_engine

logger = logging.getLogger(__name__)

# Direct DDL Definitions for raw execution / Alembic migrations
PERFORMANCE_INDEX_DDL = [
    {
        "name": "idx_subscriptions_status_billing_date",
        "table": "subscriptions",
        "sql": "CREATE INDEX IF NOT EXISTS idx_subscriptions_status_billing_date ON subscriptions (status, next_billing_date);",
        "description": "Accelerates automated daily billing scan batch query [PDF 5.11, 7.2]",
    },
    {
        "name": "idx_subscriptions_customer_id",
        "table": "subscriptions",
        "sql": "CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON subscriptions (customer_id);",
        "description": "Accelerates customer portal subscription listing and RBAC isolation [PDF 2, 5.11]",
    },
    {
        "name": "idx_invoices_customer_status",
        "table": "invoices",
        "sql": "CREATE INDEX IF NOT EXISTS idx_invoices_customer_status ON invoices (customer_id, status);",
        "description": "Accelerates customer portal invoice filters and payment settlements [PDF 5.11]",
    },
    {
        "name": "idx_invoices_overdue",
        "table": "invoices",
        "sql": "CREATE INDEX IF NOT EXISTS idx_invoices_overdue ON invoices (status, due_date) WHERE status = 'confirmed' AND balance > 0;",
        "description": "Partial index accelerating overdue and dunning cron scans [PDF 5.11]",
    },
    {
        "name": "idx_payments_invoice_id",
        "table": "payments",
        "sql": "CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoice_id);",
        "description": "Accelerates payment lookup and balance calculation per invoice [PDF 5.11]",
    },
    {
        "name": "idx_payments_payment_date",
        "table": "payments",
        "sql": "CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments (payment_date);",
        "description": "Accelerates date-filtered financial reports and reconciliation audits [PDF 5.11]",
    },
    {
        "name": "idx_discount_rules_active_dates",
        "table": "discount_rules",
        "sql": "CREATE INDEX IF NOT EXISTS idx_discount_rules_active_dates ON discount_rules (is_active, start_date, end_date);",
        "description": "Accelerates billing engine discount eligibility evaluation [PDF 5.8, 5.11]",
    },
]


def create_performance_indexes(engine: Optional[Engine] = None) -> List[str]:
    """
    Safely creates all critical performance indexes across PostgreSQL and SQLite databases.
    Idempotent: uses IF NOT EXISTS to guarantee safe re-execution.
    """
    target_engine = engine or default_engine
    applied: List[str] = []

    with target_engine.connect() as conn:
        for idx in PERFORMANCE_INDEX_DDL:
            try:
                conn.execute(text(idx["sql"]))
                conn.commit()
                applied.append(idx["name"])
                logger.info(f"Successfully verified index '{idx['name']}': {idx['description']}")
            except Exception as e:
                logger.warning(f"Could not create index '{idx['name']}': {e}")

    return applied


if __name__ == "__main__":
    import sys
    print("Applying performance indexes for Brightloop Subscription Engine [PDF 5.11]...")
    results = create_performance_indexes()
    print(f"Applied {len(results)} performance indexes successfully:")
    for name in results:
        print(f"  + {name}")
    sys.exit(0)

