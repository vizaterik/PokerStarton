"""Persist precomputed career report on hand databases

Revision ID: 012_hand_db_career_report
Revises: 011_bankroll_goal_stake
Create Date: 2026-07-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_hand_db_career_report"
down_revision: Union[str, None] = "011_bankroll_goal_stake"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("hand_databases") as batch:
        batch.add_column(sa.Column("career_report", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("career_report_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("hand_databases") as batch:
        batch.drop_column("career_report_at")
        batch.drop_column("career_report")
