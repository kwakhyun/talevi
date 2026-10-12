"""Enforce nonnegative refund debt in deployed schemas."""

from alembic import op

revision = "584ae52a1c92"
down_revision = "44b1ab2bd6c4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_check_constraint(
        "ck_users_credit_debt_nonnegative", "users", "credit_debt >= 0"
    )


def downgrade():
    op.drop_constraint("ck_users_credit_debt_nonnegative", "users", type_="check")
