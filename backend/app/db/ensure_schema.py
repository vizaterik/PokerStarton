"""Add columns that exist on ORM models but may be missing after partial Alembic runs."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base


def _cols(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _add_uuid_col(statements: list[str], table: str, col: str) -> None:
    statements.append(
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} UUID"
    )


def ensure_postgres_schema(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "users" not in tables:
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

    # Hand-database scoping (was only in SQLite migrate path before).
    if "hand_uploads" in tables:
        upload_cols = _cols(inspector, "hand_uploads")
        if "database_id" not in upload_cols:
            _add_uuid_col(statements, "hand_uploads", "database_id")
        if "session_id" not in upload_cols:
            _add_uuid_col(statements, "hand_uploads", "session_id")

    if "play_sessions" in tables:
        session_cols = _cols(inspector, "play_sessions")
        if "database_id" not in session_cols:
            _add_uuid_col(statements, "play_sessions", "database_id")
        if "status" not in session_cols:
            statements.append(
                "ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS "
                "status VARCHAR(16) NOT NULL DEFAULT 'active'"
            )

    if "analysis_snapshots" in tables:
        snap_cols = _cols(inspector, "analysis_snapshots")
        if "database_id" not in snap_cols:
            _add_uuid_col(statements, "analysis_snapshots", "database_id")

    if "player_stats_aggregated" in tables:
        agg_cols = _cols(inspector, "player_stats_aggregated")
        if "database_id" not in agg_cols:
            _add_uuid_col(statements, "player_stats_aggregated", "database_id")

    if "hand_databases" in tables:
        hdb_cols = _cols(inspector, "hand_databases")
        if "career_report" not in hdb_cols:
            statements.append(
                "ALTER TABLE hand_databases ADD COLUMN IF NOT EXISTS career_report JSON"
            )
        if "career_report_at" not in hdb_cols:
            statements.append(
                "ALTER TABLE hand_databases ADD COLUMN IF NOT EXISTS career_report_at TIMESTAMPTZ"
            )

    index_statements = [
        "CREATE INDEX IF NOT EXISTS ix_hand_uploads_database_id ON hand_uploads (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_play_sessions_database_id ON play_sessions (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_analysis_snapshots_database_id ON analysis_snapshots (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_player_stats_aggregated_database_id ON player_stats_aggregated (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_users_active_database_id ON users (active_database_id)",
    ]

    if not statements and not index_statements:
        return

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
        # Indexes only if tables exist (create_all may have just added them).
        insp2 = inspect(engine)
        existing = set(insp2.get_table_names())
        for statement in index_statements:
            # crude table name from "ON table"
            try:
                on_part = statement.split(" ON ", 1)[1].split(" ", 1)[0]
            except IndexError:
                continue
            if on_part in existing:
                conn.execute(text(statement))
