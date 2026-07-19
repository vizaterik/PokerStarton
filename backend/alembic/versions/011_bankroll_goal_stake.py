"""bankroll goal_stake for career limit goals

Revision ID: 011_bankroll_goal_stake
Revises: 010_strategy_game_tree
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_bankroll_goal_stake"
down_revision: Union[str, None] = "010_strategy_game_tree"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("bankroll_settings") as batch:
        batch.add_column(sa.Column("goal_stake", sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bankroll_settings") as batch:
        batch.drop_column("goal_stake")
