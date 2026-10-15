"""Use immutable message ordinals for constant-size checkpoint prefix boundaries.

Existing version-1 snapshots remain valid and are not rewritten or guessed.
"""

import sqlalchemy as sa
from alembic import op

revision = "93acde81f204"
down_revision = "7bc54c1d8a20"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "messages",
        sa.Column("ordinal", sa.BigInteger(), sa.Identity(), nullable=False),
    )
    op.create_index("ix_messages_ordinal", "messages", ["ordinal"], unique=True)


def downgrade():
    op.drop_index("ix_messages_ordinal", table_name="messages")
    op.drop_column("messages", "ordinal")
