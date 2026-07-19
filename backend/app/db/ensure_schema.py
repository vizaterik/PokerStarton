"""Add columns that exist on ORM models but may be missing after partial Alembic runs."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base


def _cols(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def ensure_postgres_schema(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    statements: list[str] = []
    user_cols = _cols(inspector, "users")
    if "active_database_id" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_database_id UUID"
        )
    if "accepted_terms" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms BOOLEAN NOT NULL DEFAULT false"
        )
    if "accepted_terms_at" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ"
        )
    if "referral_code" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(32)"
        )
    if "referred_by_id" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_id UUID"
        )
    if "plan_id" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id VARCHAR(32) NOT NULL DEFAULT 'starter'"
        )
    if "plan_started_at" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ"
        )
    if "hands_analyzed_month" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS hands_analyzed_month INTEGER NOT NULL DEFAULT 0"
        )
    if "hands_quota_month" not in user_cols:
        statements.append(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS hands_quota_month VARCHAR(7)"
        )

    if not statements:
        return
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
