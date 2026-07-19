"""hand share public tokens

Revision ID: 004_hand_shares
Revises: 003_email_verification
Create Date: 2026-07-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004_hand_shares"
down_revision: Union[str, None] = "003_email_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "hand_shares",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("hand_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hand_id"], ["hands.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hand_id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_hand_shares_token", "hand_shares", ["token"], unique=True)
    op.create_index("ix_hand_shares_hand_id", "hand_shares", ["hand_id"], unique=True)
    op.create_index("ix_hand_shares_created_by", "hand_shares", ["created_by"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_hand_shares_created_by", table_name="hand_shares")
    op.drop_index("ix_hand_shares_hand_id", table_name="hand_shares")
    op.drop_index("ix_hand_shares_token", table_name="hand_shares")
    op.drop_table("hand_shares")
