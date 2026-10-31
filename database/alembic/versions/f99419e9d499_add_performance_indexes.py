"""Add performance indexes.

Revision ID: f99419e9d499
Revises: 9afa2c25a683
"""

from alembic import op
import sqlalchemy as sa


revision = "f99419e9d499"
down_revision = "9afa2c25a683"
branch_labels = None
depends_on = None


def upgrade():
    # Ensure subscription numbers are unique.
    op.create_index(
        "uq_subscriptions_number",
        "subscriptions",
        ["number"],
        unique=True,
    )

    # Find subscriptions by status and next billing date.
    op.create_index(
        "idx_subscriptions_status_billing_date",
        "subscriptions",
        ["status", "next_billing_date"],
    )

    # Filter a customer's invoices by status.
    op.create_index(
        "idx_invoices_customer_status",
        "invoices",
        ["customer_id", "status"],
    )

    # Index confirmed invoices with outstanding balances.
    op.create_index(
        "idx_invoices_overdue",
        "invoices",
        ["status", "due_date"],
        postgresql_where=sa.text(
            "status = 'confirmed' AND balance > 0"
        ),
    )


def downgrade():
    op.drop_index("idx_invoices_overdue", table_name="invoices")
    op.drop_index("idx_invoices_customer_status", table_name="invoices")
    op.drop_index(
        "idx_subscriptions_status_billing_date",
        table_name="subscriptions",
    )
    op.drop_index("uq_subscriptions_number", table_name="subscriptions")
