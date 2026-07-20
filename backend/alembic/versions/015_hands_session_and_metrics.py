"""Add hands.session_id and hero metric columns

Revision ID: 015_hands_session_and_metrics
Revises: 014_hand_db_scope_columns
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "015_hands_session_and_metrics"
down_revision: Union[str, None] = "014_hand_db_scope_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "hands" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("hands")}
    with op.batch_alter_table("hands") as batch:
        if "session_id" not in cols:
            batch.add_column(
                sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True)
            )
        for name in (
            "hero_net",
            "hero_net_bb",
            "hero_net_wsd",
            "hero_net_wsd_bb",
            "hero_net_wwsd",
            "hero_net_wwsd_bb",
        ):
            if name not in cols:
                batch.add_column(sa.Column(name, sa.Numeric(12, 4), nullable=True))
        if "went_to_showdown" not in cols:
            batch.add_column(sa.Column("went_to_showdown", sa.Boolean(), nullable=True))
    if "session_id" not in cols:
        op.create_index("ix_hands_session_id", "hands", ["session_id"], unique=False)


def downgrade() -> None:
    pass
