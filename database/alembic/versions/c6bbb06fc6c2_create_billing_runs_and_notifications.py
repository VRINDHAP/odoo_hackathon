"""create billing runs and notifications"""

from alembic import op

revision = "c6bbb06fc6c2"
down_revision = "e2acf131e62f"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE billing_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_date DATE NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            finished_at TIMESTAMPTZ,
            created_count INTEGER NOT NULL DEFAULT 0,
            skipped_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            error_summary TEXT
        );

        CREATE INDEX idx_billing_runs_run_date
        ON billing_runs(run_date DESC);

        CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(100) NOT NULL,
            payload JSONB NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            sent_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );

        CREATE INDEX idx_notifications_user_id ON notifications(user_id);
        CREATE INDEX idx_notifications_status ON notifications(status);
    """)


def downgrade():
    op.execute("""
        DROP TABLE notifications;
        DROP TABLE billing_runs;
    """)
