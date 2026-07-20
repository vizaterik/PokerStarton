"""hand share comments and likes

Revision ID: 016_hand_share_social
Revises: 015_hands_session_and_metrics
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_hand_share_social"
down_revision: Union[str, None] = "015_hands_session_and_metrics"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_shares" not in tables:
        return

    if "hand_share_comments" not in tables:
        op.create_table(
            "hand_share_comments",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("share_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("street", sa.String(length=16), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["share_id"], ["hand_shares.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("share_id", "user_id", "street", name="uq_share_comment_user_street"),
        )
        op.create_index("ix_hand_share_comments_share_id", "hand_share_comments", ["share_id"])
        op.create_index("ix_hand_share_comments_user_id", "hand_share_comments", ["user_id"])

    if "hand_share_likes" not in tables:
        op.create_table(
            "hand_share_likes",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("share_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["share_id"], ["hand_shares.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("share_id", "user_id", name="uq_share_like_user"),
        )
        op.create_index("ix_hand_share_likes_share_id", "hand_share_likes", ["share_id"])
        op.create_index("ix_hand_share_likes_user_id", "hand_share_likes", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "hand_share_likes" in tables:
        op.drop_index("ix_hand_share_likes_user_id", table_name="hand_share_likes")
        op.drop_index("ix_hand_share_likes_share_id", table_name="hand_share_likes")
        op.drop_table("hand_share_likes")
    if "hand_share_comments" in tables:
        op.drop_index("ix_hand_share_comments_user_id", table_name="hand_share_comments")
        op.drop_index("ix_hand_share_comments_share_id", table_name="hand_share_comments")
        op.drop_table("hand_share_comments")
