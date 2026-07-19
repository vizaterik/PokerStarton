"""strategy game_tree for GTO constructor persistence

Revision ID: 010_strategy_game_tree
Revises: 009_bankroll_game_mode
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_strategy_game_tree"
down_revision: Union[str, None] = "009_bankroll_game_mode"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("strategies") as batch:
        batch.add_column(sa.Column("game_tree", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("strategies") as batch:
        batch.drop_column("game_tree")
