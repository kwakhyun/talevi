"""Preserve unrelated history when an editable memory changes."""

import sqlalchemy as sa
from alembic import op

revision = "fac702a6c118"
down_revision = "584ae52a1c92"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("context_content", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("messages", "context_content")
