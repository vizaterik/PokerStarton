"""unique views for shared hands

Revision ID: 020_hand_share_unique_views
Revises: 019_hand_share_views
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "020_hand_share_unique_views"
down_revision: Union[str, None] = "019_hand_share_views"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_shares" not in tables:
        return
    if "hand_share_views" in tables:
        return

    op.create_table(
        "hand_share_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("viewer_key", sa.String(length=80), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["share_id"], ["hand_shares.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("share_id", "viewer_key", name="uq_share_view_viewer"),
    )
    op.create_index("ix_hand_share_views_share_id", "hand_share_views", ["share_id"])
    op.create_index("ix_hand_share_views_created_at", "hand_share_views", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_share_views" not in tables:
        return
    op.drop_index("ix_hand_share_views_created_at", table_name="hand_share_views")
    op.drop_index("ix_hand_share_views_share_id", table_name="hand_share_views")
    op.drop_table("hand_share_views")
