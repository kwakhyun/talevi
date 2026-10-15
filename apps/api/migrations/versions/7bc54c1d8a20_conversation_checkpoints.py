"""Durable historical state and idempotent non-destructive story branches."""

import sqlalchemy as sa
from alembic import op

revision = "7bc54c1d8a20"
down_revision = "fac702a6c118"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("conversations", sa.Column("branch", sa.JSON(), nullable=True))
    op.create_table(
        "conversation_checkpoints",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.String(36),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("phase", sa.String(8), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("replay", sa.JSON(), nullable=True),
        sa.UniqueConstraint("message_id", "phase"),
    )
    op.create_index(
        "ix_conversation_checkpoints_conversation_id",
        "conversation_checkpoints",
        ["conversation_id"],
    )
    op.create_index(
        "ix_conversation_checkpoints_message_id",
        "conversation_checkpoints",
        ["message_id"],
    )
    op.create_table(
        "branch_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column(
            "conversation_id",
            sa.String(36),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "turn_id",
            sa.String(36),
            sa.ForeignKey("turns.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("cost", sa.Integer(), nullable=False),
        sa.UniqueConstraint("user_id", "client_id"),
    )
    op.create_index("ix_branch_requests_user_id", "branch_requests", ["user_id"])


def downgrade():
    op.drop_table("branch_requests")
    op.drop_table("conversation_checkpoints")
    op.drop_column("conversations", "branch")
