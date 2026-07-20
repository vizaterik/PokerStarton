"""hand share comment likes

Revision ID: 017_hand_share_comment_likes
Revises: 016_hand_share_social
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017_hand_share_comment_likes"
down_revision: Union[str, None] = "016_hand_share_social"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_share_comments" not in tables:
        return
    if "hand_share_comment_likes" in tables:
        return

    op.create_table(
        "hand_share_comment_likes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["comment_id"], ["hand_share_comments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "user_id", name="uq_share_comment_like_user"),
    )
    op.create_index(
        "ix_hand_share_comment_likes_comment_id",
        "hand_share_comment_likes",
        ["comment_id"],
    )
    op.create_index(
        "ix_hand_share_comment_likes_user_id",
        "hand_share_comment_likes",
        ["user_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_share_comment_likes" not in tables:
        return
    op.drop_index(
        "ix_hand_share_comment_likes_user_id", table_name="hand_share_comment_likes"
    )
    op.drop_index(
        "ix_hand_share_comment_likes_comment_id", table_name="hand_share_comment_likes"
    )
    op.drop_table("hand_share_comment_likes")
