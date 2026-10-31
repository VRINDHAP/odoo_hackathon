"""create discount tables"""

from alembic import op

revision = "fcc75ff00e94"
down_revision = "343156bf118e"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TYPE discount_type AS ENUM ('percent', 'fixed');
        CREATE TYPE discount_scope AS ENUM ('product', 'subscription');

        CREATE TABLE discount_rules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            type discount_type NOT NULL,
            value NUMERIC(14,2) NOT NULL,
            min_purchase_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            min_quantity INTEGER NOT NULL DEFAULT 0,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            usage_limit INTEGER,
            usage_count INTEGER NOT NULL DEFAULT 0,
            scope discount_scope NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        CREATE INDEX idx_discount_rules_eligibility
        ON discount_rules(is_active, start_date, end_date);

        ALTER TABLE subscription_lines
        ADD CONSTRAINT fk_sub_lines_discount
        FOREIGN KEY (discount_id)
        REFERENCES discount_rules(id) ON DELETE SET NULL;

        CREATE INDEX idx_sub_lines_discount_id
        ON subscription_lines(discount_id);

        CREATE TABLE discount_products (
            discount_id UUID NOT NULL REFERENCES discount_rules(id) ON DELETE CASCADE,
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            PRIMARY KEY (discount_id, product_id)
        );

        CREATE INDEX idx_discount_products_product_id
        ON discount_products(product_id);
    """)


def downgrade():
    op.execute("""
        DROP TABLE discount_products;
        ALTER TABLE subscription_lines
        DROP CONSTRAINT fk_sub_lines_discount;
        DROP INDEX idx_sub_lines_discount_id;
        DROP TABLE discount_rules;
        DROP TYPE discount_scope;
        DROP TYPE discount_type;
    """)
