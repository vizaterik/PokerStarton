"""bankroll game_mode for BRM by cash/mtt/spins

Revision ID: 009_bankroll_game_mode
Revises: 008_strategy_format_modules
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_bankroll_game_mode"
down_revision: Union[str, None] = "008_strategy_format_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("bankroll_settings") as batch:
        batch.add_column(
            sa.Column("game_mode", sa.String(length=16), nullable=False, server_default="cash")
        )


def downgrade() -> None:
    with op.batch_alter_table("bankroll_settings") as batch:
        batch.drop_column("game_mode")
