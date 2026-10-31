"""Align performance index names with specification."""

from alembic import op

revision = "d12c67af93c7"
down_revision = "2c4887c9116f"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER INDEX idx_invoices_overdue
        RENAME TO idx_invoices_overdue_partial;
    """)

    op.execute("""
        ALTER INDEX idx_invoices_customer_status
        RENAME TO idx_invoices_customer_id_status;
    """)


def downgrade():
    op.execute("""
        ALTER INDEX idx_invoices_overdue_partial
        RENAME TO idx_invoices_overdue;
    """)

    op.execute("""
        ALTER INDEX idx_invoices_customer_id_status
        RENAME TO idx_invoices_customer_status;
    """)
