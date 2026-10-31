"""create payment terms and subscriptions tables"""

from alembic import op

revision = "343156bf118e"
down_revision = "2e23c1d86f26"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE payment_terms (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(100) NOT NULL,
            days INTEGER NOT NULL DEFAULT 0
        );

        CREATE TYPE subscription_status AS ENUM (
            'draft', 'quotation', 'confirmed', 'active',
            'paused', 'closed', 'cancelled'
        );

        CREATE SEQUENCE subscription_number_seq
        START WITH 1 INCREMENT BY 1;

        CREATE TABLE subscriptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number VARCHAR(50) NOT NULL UNIQUE,
            customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
            plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
            template_id UUID REFERENCES quotation_templates(id) ON DELETE SET NULL,
            status subscription_status NOT NULL DEFAULT 'draft',
            start_date DATE NOT NULL,
            expiry_date DATE,
            next_billing_date DATE,
            last_billed_through DATE,
            anchor_day SMALLINT NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
            payment_term_id UUID NOT NULL REFERENCES payment_terms(id) ON DELETE RESTRICT,
            quote_valid_until DATE,
            currency VARCHAR(3) NOT NULL DEFAULT 'INR',
            subtotal NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            tax_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            paused_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            close_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        CREATE INDEX idx_subscriptions_customer_id ON subscriptions(customer_id);
        CREATE INDEX idx_subscriptions_plan_id ON subscriptions(plan_id);
        CREATE INDEX idx_subscriptions_template_id ON subscriptions(template_id);
        CREATE INDEX idx_subscriptions_payment_term_id ON subscriptions(payment_term_id);

        CREATE TABLE subscription_lines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
            description VARCHAR(255) NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price NUMERIC(14,2) NOT NULL,
            tax_id UUID REFERENCES taxes(id) ON DELETE RESTRICT,
            discount_id UUID,
            line_subtotal NUMERIC(14,2) NOT NULL,
            line_tax NUMERIC(14,2) NOT NULL,
            line_total NUMERIC(14,2) NOT NULL
        );

        CREATE INDEX idx_sub_lines_subscription_id ON subscription_lines(subscription_id);
        CREATE INDEX idx_sub_lines_product_id ON subscription_lines(product_id);
        CREATE INDEX idx_sub_lines_variant_id ON subscription_lines(variant_id);
        CREATE INDEX idx_sub_lines_tax_id ON subscription_lines(tax_id);
    """)


def downgrade():
    op.execute("DROP TABLE subscription_lines")
    op.execute("DROP TABLE subscriptions")
    op.execute("DROP SEQUENCE subscription_number_seq")
    op.execute("DROP TYPE subscription_status")
    op.execute("DROP TABLE payment_terms")
