"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2026-07-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "strategies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_strategies_user_name"),
    )
    op.create_index("ix_strategies_user_id", "strategies", ["user_id"], unique=False)

    op.create_table(
        "strategy_spots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("strategy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spot_key", sa.String(length=64), nullable=False),
        sa.Column("hero_position", sa.String(length=16), nullable=False),
        sa.Column("villain_position", sa.String(length=16), nullable=True),
        sa.Column("stack_bb_min", sa.Numeric(8, 2), nullable=True),
        sa.Column("stack_bb_max", sa.Numeric(8, 2), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["strategy_id"], ["strategies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "strategy_id",
            "spot_key",
            "hero_position",
            "villain_position",
            name="uq_strategy_spots_key",
        ),
    )
    op.create_index("ix_strategy_spots_strategy_id", "strategy_spots", ["strategy_id"], unique=False)

    op.create_table(
        "strategy_cells",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hand_code", sa.String(length=3), nullable=False),
        sa.Column("raise_freq", sa.Numeric(5, 4), nullable=False, server_default="0"),
        sa.Column("call_freq", sa.Numeric(5, 4), nullable=False, server_default="0"),
        sa.Column("fold_freq", sa.Numeric(5, 4), nullable=False, server_default="1"),
        sa.CheckConstraint("raise_freq BETWEEN 0 AND 1", name="ck_strategy_cells_raise"),
        sa.CheckConstraint("call_freq BETWEEN 0 AND 1", name="ck_strategy_cells_call"),
        sa.CheckConstraint("fold_freq BETWEEN 0 AND 1", name="ck_strategy_cells_fold"),
        sa.CheckConstraint(
            "ABS(raise_freq + call_freq + fold_freq - 1.0) < 0.0001",
            name="strategy_cells_freq_sum_chk",
        ),
        sa.ForeignKeyConstraint(["spot_id"], ["strategy_spots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("spot_id", "hand_code", name="uq_strategy_cells_spot_hand"),
    )
    op.create_index("ix_strategy_cells_spot_id", "strategy_cells", ["spot_id"], unique=False)

    op.create_table(
        "hand_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("strategy_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("room", sa.String(length=64), nullable=False, server_default="pokerstars"),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("hands_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','parsing','parsed','analyzed','failed')",
            name="ck_hand_uploads_status",
        ),
        sa.ForeignKeyConstraint(["strategy_id"], ["strategies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_hand_uploads_user_id", "hand_uploads", ["user_id"], unique=False)

    op.create_table(
        "hands",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("upload_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_hand_id", sa.String(length=64), nullable=False),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("table_name", sa.String(length=200), nullable=True),
        sa.Column("small_blind", sa.Numeric(12, 2), nullable=True),
        sa.Column("big_blind", sa.Numeric(12, 2), nullable=True),
        sa.Column("hero_name", sa.String(length=100), nullable=True),
        sa.Column("hero_position", sa.String(length=16), nullable=True),
        sa.Column("hero_hand", sa.String(length=4), nullable=True),
        sa.Column("hero_hand_code", sa.String(length=3), nullable=True),
        sa.Column("detected_spot", sa.String(length=64), nullable=True),
        sa.Column("villain_position", sa.String(length=16), nullable=True),
        sa.Column("stack_bb", sa.Numeric(8, 2), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["upload_id"], ["hand_uploads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_id", "external_hand_id", name="uq_hands_upload_external"),
    )
    op.create_index("ix_hands_upload_id", "hands", ["upload_id"], unique=False)
    op.create_index("ix_hands_spot_code", "hands", ["detected_spot", "hero_hand_code"], unique=False)

    op.create_table(
        "hand_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hand_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("street", sa.String(length=16), nullable=False),
        sa.Column("action_order", sa.Integer(), nullable=False),
        sa.Column("player_name", sa.String(length=100), nullable=False),
        sa.Column("is_hero", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.CheckConstraint(
            "street IN ('preflop','flop','turn','river')",
            name="ck_hand_actions_street",
        ),
        sa.ForeignKeyConstraint(["hand_id"], ["hands.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hand_id", "street", "action_order", name="uq_hand_actions_order"),
    )

    op.create_table(
        "deviations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hand_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("strategy_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("spot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("hand_code", sa.String(length=3), nullable=False),
        sa.Column("actual_action", sa.String(length=16), nullable=False),
        sa.Column("expected_action", sa.String(length=16), nullable=False),
        sa.Column("actual_freq", sa.Numeric(5, 4), nullable=True),
        sa.Column("expected_freq", sa.Numeric(5, 4), nullable=True),
        sa.Column("severity", sa.Numeric(5, 4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["hand_id"], ["hands.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["spot_id"], ["strategy_spots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["strategy_id"], ["strategies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hand_id", "strategy_id", name="uq_deviations_hand_strategy"),
    )
    op.create_index("ix_deviations_user_id", "deviations", ["user_id"], unique=False)
    op.create_index("ix_deviations_strategy_id", "deviations", ["strategy_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_deviations_strategy_id", table_name="deviations")
    op.drop_index("ix_deviations_user_id", table_name="deviations")
    op.drop_table("deviations")
    op.drop_table("hand_actions")
    op.drop_index("ix_hands_spot_code", table_name="hands")
    op.drop_index("ix_hands_upload_id", table_name="hands")
    op.drop_table("hands")
    op.drop_index("ix_hand_uploads_user_id", table_name="hand_uploads")
    op.drop_table("hand_uploads")
    op.drop_index("ix_strategy_cells_spot_id", table_name="strategy_cells")
    op.drop_table("strategy_cells")
    op.drop_index("ix_strategy_spots_strategy_id", table_name="strategy_spots")
    op.drop_table("strategy_spots")
    op.drop_index("ix_strategies_user_id", table_name="strategies")
    op.drop_table("strategies")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
