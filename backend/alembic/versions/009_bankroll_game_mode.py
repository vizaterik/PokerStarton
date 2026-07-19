"""bankroll game_mode for BRM by cash/mtt/spins

Revision ID: 009_bankroll_game_mode
Revises: 008_strategy_format_modules
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "009_bankroll_game_mode"
down_revision: Union[str, None] = "008_strategy_format_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    tables = _tables()

    if "bankroll_settings" not in tables:
        op.create_table(
            "bankroll_settings",
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("balance", sa.Numeric(14, 2), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(length=8), nullable=False, server_default="USD"),
            sa.Column(
                "risk_profile", sa.String(length=32), nullable=False, server_default="standard"
            ),
            sa.Column("buyins_target", sa.Integer(), nullable=False, server_default="50"),
            sa.Column("game_mode", sa.String(length=16), nullable=False, server_default="cash"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
        )
    elif "game_mode" not in _columns("bankroll_settings"):
        with op.batch_alter_table("bankroll_settings") as batch:
            batch.add_column(
                sa.Column(
                    "game_mode", sa.String(length=16), nullable=False, server_default="cash"
                )
            )

    if "bankroll_entries" not in tables:
        # session_id without FK — play_sessions may not exist yet in this migration chain.
        op.create_table(
            "bankroll_entries",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("amount", sa.Numeric(14, 2), nullable=False),
            sa.Column("balance_after", sa.Numeric(14, 2), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_bankroll_entries_user_id", "bankroll_entries", ["user_id"])
        op.create_index("ix_bankroll_entries_session_id", "bankroll_entries", ["session_id"])


def downgrade() -> None:
    cols = _columns("bankroll_settings")
    if "game_mode" in cols:
        with op.batch_alter_table("bankroll_settings") as batch:
            batch.drop_column("game_mode")
