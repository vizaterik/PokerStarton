"""Add database_id scope columns for hand uploads / sessions / snapshots

Revision ID: 014_hand_db_scope_columns
Revises: 013_user_active_database
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "014_hand_db_scope_columns"
down_revision: Union[str, None] = "013_user_active_database"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(insp, table: str) -> set[str]:
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _add_uuid(batch, cols: set[str], name: str) -> None:
    if name not in cols:
        batch.add_column(sa.Column(name, postgresql.UUID(as_uuid=True), nullable=True))


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "hand_uploads" in insp.get_table_names():
        cols = _cols(insp, "hand_uploads")
        with op.batch_alter_table("hand_uploads") as batch:
            _add_uuid(batch, cols, "database_id")
            _add_uuid(batch, cols, "session_id")
        if "database_id" not in cols:
            op.create_index(
                "ix_hand_uploads_database_id", "hand_uploads", ["database_id"], unique=False
            )

    if "play_sessions" in insp.get_table_names():
        cols = _cols(insp, "play_sessions")
        with op.batch_alter_table("play_sessions") as batch:
            _add_uuid(batch, cols, "database_id")
            if "status" not in cols:
                batch.add_column(
                    sa.Column("status", sa.String(length=16), nullable=False, server_default="active")
                )
        if "database_id" not in cols:
            op.create_index(
                "ix_play_sessions_database_id", "play_sessions", ["database_id"], unique=False
            )

    if "analysis_snapshots" in insp.get_table_names():
        cols = _cols(insp, "analysis_snapshots")
        with op.batch_alter_table("analysis_snapshots") as batch:
            _add_uuid(batch, cols, "database_id")
        if "database_id" not in cols:
            op.create_index(
                "ix_analysis_snapshots_database_id",
                "analysis_snapshots",
                ["database_id"],
                unique=False,
            )

    if "player_stats_aggregated" in insp.get_table_names():
        cols = _cols(insp, "player_stats_aggregated")
        with op.batch_alter_table("player_stats_aggregated") as batch:
            _add_uuid(batch, cols, "database_id")
        if "database_id" not in cols:
            op.create_index(
                "ix_player_stats_aggregated_database_id",
                "player_stats_aggregated",
                ["database_id"],
                unique=False,
            )


def downgrade() -> None:
    # Non-destructive downgrade omitted — columns are nullable and safe to keep.
    pass
