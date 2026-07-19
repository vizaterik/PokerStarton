"""Persist precomputed career report on hand databases

Revision ID: 012_hand_db_career_report
Revises: 011_bankroll_goal_stake
Create Date: 2026-07-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "012_hand_db_career_report"
down_revision: Union[str, None] = "011_bankroll_goal_stake"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    if "hand_databases" not in tables:
        op.create_table(
            "hand_databases",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("career_report", sa.JSON(), nullable=True),
            sa.Column("career_report_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "name", name="uq_hand_databases_user_name"),
        )
        op.create_index("ix_hand_databases_user_id", "hand_databases", ["user_id"])
        return

    cols = {c["name"] for c in insp.get_columns("hand_databases")}
    with op.batch_alter_table("hand_databases") as batch:
        if "career_report" not in cols:
            batch.add_column(sa.Column("career_report", sa.JSON(), nullable=True))
        if "career_report_at" not in cols:
            batch.add_column(
                sa.Column("career_report_at", sa.DateTime(timezone=True), nullable=True)
            )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "hand_databases" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("hand_databases")}
    with op.batch_alter_table("hand_databases") as batch:
        if "career_report_at" in cols:
            batch.drop_column("career_report_at")
        if "career_report" in cols:
            batch.drop_column("career_report")
