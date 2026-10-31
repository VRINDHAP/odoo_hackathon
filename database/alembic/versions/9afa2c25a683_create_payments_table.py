"""Create payments table.

Revision ID: 9afa2c25a683
Revises: c6bbb06fc6c2
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "9afa2c25a683"
down_revision = "c6bbb06fc6c2"
branch_labels = None
depends_on = None


def upgrade():
    # Create the payment method enum.
    op.execute("""
        CREATE TYPE payment_method AS ENUM (
            'card',
            'upi',
            'bank_transfer',
            'cash',
            'cheque',
            'other'
        )
    """)

    op.create_table(
        "payments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "invoice_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("invoices.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "method",
            postgresql.ENUM(
                "card",
                "upi",
                "bank_transfer",
                "cash",
                "cheque",
                "other",
                name="payment_method",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("payment_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reference", sa.String(255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "recorded_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(50),
            nullable=False,
            server_default="completed",
        ),
        sa.Column(
            "reversed_payment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("payments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reversal_reason", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
    )

    op.create_index(
        "idx_payments_invoice_id",
        "payments",
        ["invoice_id"],
    )

    op.create_index(
        "idx_payments_payment_date",
        "payments",
        ["payment_date"],
    )

    op.create_index(
        "idx_payments_reversed_payment_id",
        "payments",
        ["reversed_payment_id"],
    )


def downgrade():
    op.drop_index("idx_payments_reversed_payment_id", table_name="payments")
    op.drop_index("idx_payments_payment_date", table_name="payments")
    op.drop_index("idx_payments_invoice_id", table_name="payments")

    op.drop_table("payments")
    op.execute("DROP TYPE payment_method")
