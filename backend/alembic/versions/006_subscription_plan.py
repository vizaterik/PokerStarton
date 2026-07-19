"""user subscription plan fields

Revision ID: 006_subscription_plan
Revises: 005_referral_code
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_subscription_plan"
down_revision: Union[str, None] = "005_referral_code"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("plan_id", sa.String(length=32), nullable=False, server_default="starter"))
        batch.add_column(sa.Column("plan_started_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(
            sa.Column("hands_analyzed_month", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("hands_quota_month", sa.String(length=7), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("hands_quota_month")
        batch.drop_column("hands_analyzed_month")
        batch.drop_column("plan_started_at")
        batch.drop_column("plan_id")
