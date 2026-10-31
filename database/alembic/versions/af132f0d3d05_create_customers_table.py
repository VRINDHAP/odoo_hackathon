"""create customers table"""

from alembic import op

revision = "af132f0d3d05"
down_revision = "1ccd2874f132"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE customers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            company_name VARCHAR(255),
            tax_id VARCHAR(50),
            billing_address JSONB NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'active',
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        ALTER TABLE users
        ADD CONSTRAINT fk_users_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

        CREATE INDEX idx_customers_email ON customers(email);
        CREATE INDEX idx_customers_deleted_at ON customers(deleted_at);
    """)


def downgrade():
    op.execute("ALTER TABLE users DROP CONSTRAINT fk_users_customer")
    op.execute("DROP TABLE customers")
