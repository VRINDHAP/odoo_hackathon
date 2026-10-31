"""create discount redemptions"""

from alembic import op

revision = "e2acf131e62f"
down_revision = "50f7f98b9e51"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE discount_redemptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            discount_id UUID NOT NULL REFERENCES discount_rules(id) ON DELETE RESTRICT,
            invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
            amount NUMERIC(14,2) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT uq_discount_invoice UNIQUE (discount_id, invoice_id)
        );

        CREATE INDEX idx_discount_redemptions_sub_id
        ON discount_redemptions(subscription_id);

        CREATE INDEX idx_discount_redemptions_discount_id
        ON discount_redemptions(discount_id);

        CREATE INDEX idx_discount_redemptions_invoice_id
        ON discount_redemptions(invoice_id);
    """)


def downgrade():
    op.execute("DROP TABLE discount_redemptions")
