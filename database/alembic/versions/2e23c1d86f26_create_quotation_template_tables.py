"""create quotation template tables"""

from alembic import op

revision = "2e23c1d86f26"
down_revision = "af132f0d3d05"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE quotation_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            validity_days INTEGER NOT NULL DEFAULT 30,
            plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        CREATE INDEX idx_templates_plan_id
        ON quotation_templates(plan_id);

        CREATE TABLE quotation_template_lines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            template_id UUID NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price NUMERIC(14,2) NOT NULL
        );

        CREATE INDEX idx_template_lines_template_id
        ON quotation_template_lines(template_id);

        CREATE INDEX idx_template_lines_product_id
        ON quotation_template_lines(product_id);

        CREATE INDEX idx_template_lines_variant_id
        ON quotation_template_lines(variant_id);
    """)


def downgrade():
    op.execute("DROP TABLE quotation_template_lines")
    op.execute("DROP TABLE quotation_templates")
