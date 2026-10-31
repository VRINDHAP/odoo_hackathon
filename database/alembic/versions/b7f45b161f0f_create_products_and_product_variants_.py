"""create products and product variants tables"""

from alembic import op

revision = "b7f45b161f0f"
down_revision = "eae22d768d81"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TYPE product_type AS ENUM
            ('service', 'software', 'addon', 'physical');

        CREATE TABLE products (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            type product_type NOT NULL,
            sales_price NUMERIC(14,2) NOT NULL,
            cost_price NUMERIC(14,2) NOT NULL,
            notes TEXT,
            tax_id UUID,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT fk_products_tax
                FOREIGN KEY (tax_id) REFERENCES taxes(id) ON DELETE SET NULL
        );

        CREATE INDEX idx_products_is_active ON products (is_active);
        CREATE INDEX idx_products_tax_id ON products (tax_id);

        CREATE TABLE product_variants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            attribute VARCHAR(100) NOT NULL,
            value VARCHAR(100) NOT NULL,
            extra_price NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT uq_product_variant
                UNIQUE (product_id, attribute, value)
        );

        CREATE INDEX idx_variants_product_id
            ON product_variants (product_id);
    """)


def downgrade():
    op.execute("DROP TABLE product_variants")
    op.execute("DROP TABLE products")
    op.execute("DROP TYPE product_type")
