"""strategy format modules metadata

Revision ID: 008_strategy_format_modules
Revises: 007_accepted_terms
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_strategy_format_modules"
down_revision: Union[str, None] = "007_accepted_terms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("strategies") as batch:
        batch.add_column(
            sa.Column("format", sa.String(length=16), nullable=False, server_default="cash")
        )
        batch.add_column(
            sa.Column("table_size", sa.String(length=16), nullable=False, server_default="6-max")
        )
        batch.add_column(
            sa.Column("stack_depth", sa.String(length=16), nullable=False, server_default="100bb")
        )
        batch.add_column(sa.Column("mtt_stage", sa.String(length=16), nullable=True))
        batch.add_column(
            sa.Column(
                "action_mode", sa.String(length=16), nullable=False, server_default="standard"
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("strategies") as batch:
        batch.drop_column("action_mode")
        batch.drop_column("mtt_stage")
        batch.drop_column("stack_depth")
        batch.drop_column("table_size")
        batch.drop_column("format")
