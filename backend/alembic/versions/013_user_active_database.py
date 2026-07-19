"""user active_database_id

Revision ID: 013_user_active_database
Revises: 012_hand_db_career_report
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "013_user_active_database"
down_revision: Union[str, None] = "012_hand_db_career_report"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "active_database_id" in cols:
        return
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("active_database_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch.create_index("ix_users_active_database_id", ["active_database_id"], unique=False)


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "active_database_id" not in cols:
        return
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_active_database_id")
        batch.drop_column("active_database_id")
