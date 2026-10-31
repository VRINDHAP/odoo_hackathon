"""create support tables

Revision ID: 60b78cd158c6
Revises: ac9134df17b6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "60b78cd158c6"
down_revision: Union[str, Sequence[str], None] = "ac9134df17b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Store user actions and changes for auditing.
    op.create_table(
        "audit_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("entity", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.String(100), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("before_json", postgresql.JSONB(), nullable=True),
        sa.Column("after_json", postgresql.JSONB(), nullable=True),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
    )

    op.create_index(
        "idx_audit_logs_entity", "audit_logs", ["entity", "entity_id"]
    )
    op.create_index("idx_audit_logs_actor", "audit_logs", ["actor_id"])
    op.execute(
    "CREATE INDEX idx_audit_logs_at ON audit_logs (at DESC)"
    )

    # Store application settings as JSON values.
    op.create_table(
        "settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_table("audit_logs")
