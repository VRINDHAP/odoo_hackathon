"""Create reporting summary tables and functions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "2c4887c9116f"
down_revision = "f99419e9d499"
branch_labels = None
depends_on = None


def upgrade():
    # Daily invoice and payment summary.
    op.create_table(
        "daily_revenue_summary",
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("total_invoiced", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column("total_collected", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
        sa.Column(
            "payment_method_breakdown",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
    )

    # Daily subscription counts grouped by plan.
    op.create_table(
        "subscription_snapshot_daily",
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("plans.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("active_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paused_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("closed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mrr_contribution", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
    )

    op.execute("""
        CREATE INDEX idx_sub_snapshot_date
        ON subscription_snapshot_daily (date DESC)
    """)

    # Calculate daily invoice and payment totals.
    op.execute("""
        CREATE OR REPLACE FUNCTION refresh_daily_revenue_summary(
            target_date DATE
        )
        RETURNS VOID
        LANGUAGE plpgsql
        AS $$
        DECLARE
            invoiced NUMERIC(14,2);
            collected NUMERIC(14,2);
            breakdown JSONB;
        BEGIN
            SELECT COALESCE(SUM(total), 0)
            INTO invoiced
            FROM invoices
            WHERE invoice_date = target_date
              AND status IN ('confirmed', 'paid');

            SELECT COALESCE(SUM(amount), 0)
            INTO collected
            FROM payments
            WHERE payment_date::DATE = target_date
              AND (status IN ('completed', 'success') OR (status = 'reversed' AND amount < 0));

            SELECT COALESCE(
                jsonb_object_agg(method, method_total),
                '{}'::jsonb
            )
            INTO breakdown
            FROM (
                SELECT method::TEXT AS method, SUM(amount) AS method_total
                FROM payments
                WHERE payment_date::DATE = target_date
                  AND (status IN ('completed', 'success') OR (status = 'reversed' AND amount < 0))
                GROUP BY method
            ) AS payment_totals;

            INSERT INTO daily_revenue_summary (
                date,
                total_invoiced,
                total_collected,
                payment_method_breakdown,
                updated_at
            )
            VALUES (
                target_date,
                invoiced,
                collected,
                breakdown,
                clock_timestamp()
            )
            ON CONFLICT (date)
            DO UPDATE SET
                total_invoiced = EXCLUDED.total_invoiced,
                total_collected = EXCLUDED.total_collected,
                payment_method_breakdown = EXCLUDED.payment_method_breakdown,
                updated_at = clock_timestamp();
        END;
        $$;
    """)

    # Calculate subscription counts and monthly recurring revenue.
    op.execute("""
        CREATE OR REPLACE FUNCTION refresh_subscription_snapshot_daily(
            target_date DATE
        )
        RETURNS VOID
        LANGUAGE plpgsql
        AS $$
        BEGIN
            INSERT INTO subscription_snapshot_daily (
                date,
                plan_id,
                active_count,
                paused_count,
                closed_count,
                mrr_contribution
            )
            SELECT
                target_date,
                p.id,
                COUNT(s.id) FILTER (WHERE s.status = 'active'),
                COUNT(s.id) FILTER (WHERE s.status = 'paused'),
                COUNT(s.id) FILTER (WHERE s.status = 'closed'),
                (
                    CASE p.billing_period
                        WHEN 'daily' THEN p.price * 365 / 12
                        WHEN 'weekly' THEN p.price * 52 / 12
                        WHEN 'monthly' THEN p.price
                        WHEN 'yearly' THEN p.price / 12
                    END
                ) * COUNT(s.id) FILTER (WHERE s.status = 'active')
            FROM plans p
            LEFT JOIN subscriptions s ON s.plan_id = p.id
            GROUP BY p.id, p.price, p.billing_period
            ON CONFLICT (date, plan_id)
            DO UPDATE SET
                active_count = EXCLUDED.active_count,
                paused_count = EXCLUDED.paused_count,
                closed_count = EXCLUDED.closed_count,
                mrr_contribution = EXCLUDED.mrr_contribution;
        END;
        $$;
    """)


def downgrade():
    op.execute(
        "DROP FUNCTION IF EXISTS refresh_subscription_snapshot_daily(DATE)"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS refresh_daily_revenue_summary(DATE)"
    )

    op.execute("DROP INDEX IF EXISTS idx_sub_snapshot_date")
    op.drop_table("subscription_snapshot_daily")
    op.drop_table("daily_revenue_summary")
