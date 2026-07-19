"""email verification and nickname uniqueness

Revision ID: 003_email_verification
Revises: 002_google_auth
Create Date: 2026-07-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_email_verification"
down_revision: Union[str, None] = "002_google_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column("users", sa.Column("verification_code_hash", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("verification_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_display_name", "users", ["display_name"], unique=True)
    op.alter_column("users", "email_verified", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_users_display_name", table_name="users")
    op.drop_column("users", "verification_expires_at")
    op.drop_column("users", "verification_code_hash")
    op.drop_column("users", "email_verified")
