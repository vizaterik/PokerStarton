"""user referral codes

Revision ID: 005_referral_code
Revises: 004_hand_shares
Create Date: 2026-07-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_referral_code"
down_revision: Union[str, None] = "004_hand_shares"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("referral_code", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("referred_by_id", sa.Uuid(), nullable=True))
        batch.create_index("ix_users_referral_code", ["referral_code"], unique=True)
        batch.create_foreign_key(
            "fk_users_referred_by_id",
            "users",
            ["referred_by_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_referred_by_id", type_="foreignkey")
        batch.drop_index("ix_users_referral_code")
        batch.drop_column("referred_by_id")
        batch.drop_column("referral_code")
