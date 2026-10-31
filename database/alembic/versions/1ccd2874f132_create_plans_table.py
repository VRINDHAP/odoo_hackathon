"""create plans table"""

from alembic import op

revision = "1ccd2874f132"
down_revision = "b7f45b161f0f"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TYPE billing_period AS ENUM
            ('daily', 'weekly', 'monthly', 'yearly');

        CREATE TABLE plans (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            price NUMERIC(14,2) NOT NULL,
            billing_period billing_period NOT NULL,
            min_quantity INTEGER NOT NULL DEFAULT 1,
            valid_from DATE NOT NULL,
            valid_to DATE,
            auto_close BOOLEAN NOT NULL DEFAULT FALSE,
            closable BOOLEAN NOT NULL DEFAULT TRUE,
            pausable BOOLEAN NOT NULL DEFAULT TRUE,
            renewable BOOLEAN NOT NULL DEFAULT TRUE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        CREATE INDEX idx_plans_is_active ON plans (is_active);
    """)


def downgrade():
    op.execute("DROP TABLE plans")
    op.execute("DROP TYPE billing_period")
