"""create taxes table"""

from alembic import op

revision = "eae22d768d81"
down_revision = "60b78cd158c6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TYPE tax_type AS ENUM ('percent', 'fixed');
        CREATE TYPE tax_applies_to AS ENUM ('all', 'product', 'category');

        CREATE TABLE taxes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(100) NOT NULL,
            type tax_type NOT NULL,
            rate NUMERIC(14,4) NOT NULL,
            inclusive BOOLEAN NOT NULL DEFAULT FALSE,
            applies_to tax_applies_to NOT NULL DEFAULT 'all',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );
    """)


def downgrade():
    op.execute("DROP TABLE taxes")
    op.execute("DROP TYPE tax_applies_to")
    op.execute("DROP TYPE tax_type")
