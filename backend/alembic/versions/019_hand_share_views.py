"""hand share view counter

Revision ID: 019_hand_share_views
Revises: 018_feed_posts
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "019_hand_share_views"
down_revision: Union[str, None] = "018_feed_posts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_shares" not in tables:
        return
    cols = {c["name"] for c in insp.get_columns("hand_shares")}
    if "views_count" not in cols:
        op.add_column(
            "hand_shares",
            sa.Column("views_count", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_shares" not in tables:
        return
    cols = {c["name"] for c in insp.get_columns("hand_shares")}
    if "views_count" in cols:
        op.drop_column("hand_shares", "views_count")
