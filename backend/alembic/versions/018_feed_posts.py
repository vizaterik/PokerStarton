"""AI feed posts and settings

Revision ID: 018_feed_posts
Revises: 017_hand_share_comment_likes
Create Date: 2026-07-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "018_feed_posts"
down_revision: Union[str, None] = "017_hand_share_comment_likes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    json_type = (
        postgresql.JSONB(astext_type=sa.Text())
        if bind.dialect.name == "postgresql"
        else sa.JSON()
    )

    if "feed_settings" not in tables:
        op.create_table(
            "feed_settings",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("auto_enabled", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("auto_publish", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("search_queries", json_type, nullable=False),
            sa.Column("max_posts_per_day", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("min_views", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("model_name", sa.String(length=64), nullable=False, server_default="gpt-4o-mini"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    if "feed_posts" not in tables:
        op.create_table(
            "feed_posts",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("source_type", sa.String(length=16), nullable=False),
            sa.Column("source_url", sa.String(length=512), nullable=True),
            sa.Column("source_title", sa.String(length=400), nullable=True),
            sa.Column("source_channel", sa.String(length=200), nullable=True),
            sa.Column("title", sa.String(length=400), nullable=False),
            sa.Column("raw_excerpt", sa.Text(), nullable=True),
            sa.Column("hand_raw_text", sa.Text(), nullable=True),
            sa.Column("replay_snapshot", json_type, nullable=True),
            sa.Column("analysis_md", sa.Text(), nullable=False),
            sa.Column("hero_hand", sa.String(length=8), nullable=True),
            sa.Column("stakes_label", sa.String(length=64), nullable=True),
            sa.Column("tags", json_type, nullable=False),
            sa.Column("has_replay", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_by", sa.Uuid(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_feed_posts_status", "feed_posts", ["status"])
        op.create_index("ix_feed_posts_source_url", "feed_posts", ["source_url"])
        op.create_index("ix_feed_posts_created_by", "feed_posts", ["created_by"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "feed_posts" in tables:
        op.drop_index("ix_feed_posts_created_by", table_name="feed_posts")
        op.drop_index("ix_feed_posts_source_url", table_name="feed_posts")
        op.drop_index("ix_feed_posts_status", table_name="feed_posts")
        op.drop_table("feed_posts")
    if "feed_settings" in tables:
        op.drop_table("feed_settings")
