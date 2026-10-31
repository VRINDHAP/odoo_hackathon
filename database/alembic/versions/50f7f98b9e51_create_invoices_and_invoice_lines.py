"""create invoices and invoice lines"""

from alembic import op

revision = "50f7f98b9e51"
down_revision = "fcc75ff00e94"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TYPE invoice_status AS ENUM (
            'draft', 'confirmed', 'paid', 'cancelled'
        );

        CREATE SEQUENCE invoice_number_seq
        START WITH 1 INCREMENT BY 1;

        CREATE TABLE invoices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number VARCHAR(50) NOT NULL UNIQUE,
            subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
            customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
            status invoice_status NOT NULL DEFAULT 'draft',
            invoice_date DATE NOT NULL,
            due_date DATE NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'INR',
            subtotal NUMERIC(14,2) NOT NULL,
            discount_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            tax_total NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            total NUMERIC(14,2) NOT NULL,
            amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            balance NUMERIC(14,2) NOT NULL,
            sent_at TIMESTAMPTZ,
            pdf_url VARCHAR(500),
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT uq_subscription_period
                UNIQUE (subscription_id, period_start, period_end)
        );

        CREATE INDEX idx_invoices_subscription_id ON invoices(subscription_id);
        CREATE INDEX idx_invoices_customer_id ON invoices(customer_id);

        CREATE TABLE invoice_lines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            description VARCHAR(255) NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price NUMERIC(14,2) NOT NULL,
            discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            tax_id UUID REFERENCES taxes(id) ON DELETE RESTRICT,
            tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
            line_total NUMERIC(14,2) NOT NULL
        );

        CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
        CREATE INDEX idx_invoice_lines_product_id ON invoice_lines(product_id);
        CREATE INDEX idx_invoice_lines_tax_id ON invoice_lines(tax_id);
    """)


def downgrade():
    op.execute("""
        DROP TABLE invoice_lines;
        DROP TABLE invoices;
        DROP SEQUENCE invoice_number_seq;
        DROP TYPE invoice_status;
    """)
