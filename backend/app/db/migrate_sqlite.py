from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base


def _column_names(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def ensure_sqlite_schema(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    statements: list[str] = []

    user_cols = _column_names(inspector, "users")
    if "google_sub" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)")
    if "avatar_url" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN avatar_url TEXT")
    if "email_verified" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 1")
    if "verification_code_hash" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN verification_code_hash TEXT")
    if "verification_expires_at" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN verification_expires_at DATETIME")
    if "referral_code" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN referral_code VARCHAR(32)")
    if "referred_by_id" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN referred_by_id CHAR(36)")
    if "plan_id" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN plan_id VARCHAR(32) NOT NULL DEFAULT 'starter'")
    if "plan_started_at" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN plan_started_at DATETIME")
    if "hands_analyzed_month" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN hands_analyzed_month INTEGER NOT NULL DEFAULT 0")
    if "hands_quota_month" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN hands_quota_month VARCHAR(7)")
    if "accepted_terms" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN accepted_terms BOOLEAN NOT NULL DEFAULT 0")
    if "accepted_terms_at" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN accepted_terms_at DATETIME")
    if "active_database_id" not in user_cols:
        statements.append("ALTER TABLE users ADD COLUMN active_database_id CHAR(36)")

    upload_cols = _column_names(inspector, "hand_uploads")
    if upload_cols and "session_id" not in upload_cols:
        statements.append("ALTER TABLE hand_uploads ADD COLUMN session_id CHAR(36)")
    if upload_cols and "database_id" not in upload_cols:
        statements.append("ALTER TABLE hand_uploads ADD COLUMN database_id CHAR(36)")

    hand_cols = _column_names(inspector, "hands")
    if hand_cols and "session_id" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN session_id CHAR(36)")
    if hand_cols and "hero_net" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net NUMERIC(12, 4)")
    if hand_cols and "hero_net_bb" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net_bb NUMERIC(12, 4)")
    if hand_cols and "went_to_showdown" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN went_to_showdown BOOLEAN")
    if hand_cols and "hero_net_wsd" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net_wsd NUMERIC(12, 4)")
    if hand_cols and "hero_net_wsd_bb" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net_wsd_bb NUMERIC(12, 4)")
    if hand_cols and "hero_net_wwsd" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net_wwsd NUMERIC(12, 4)")
    if hand_cols and "hero_net_wwsd_bb" not in hand_cols:
        statements.append("ALTER TABLE hands ADD COLUMN hero_net_wwsd_bb NUMERIC(12, 4)")

    session_cols = _column_names(inspector, "play_sessions")
    if session_cols and "status" not in session_cols:
        statements.append(
            "ALTER TABLE play_sessions ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'"
        )
    if session_cols and "database_id" not in session_cols:
        statements.append("ALTER TABLE play_sessions ADD COLUMN database_id CHAR(36)")

    entry_cols = _column_names(inspector, "bankroll_entries")
    if entry_cols and "session_id" not in entry_cols:
        statements.append("ALTER TABLE bankroll_entries ADD COLUMN session_id CHAR(36)")

    br_cols = _column_names(inspector, "bankroll_settings")
    if br_cols and "game_mode" not in br_cols:
        statements.append(
            "ALTER TABLE bankroll_settings ADD COLUMN game_mode VARCHAR(16) NOT NULL DEFAULT 'cash'"
        )
    if br_cols and "goal_stake" not in br_cols:
        statements.append("ALTER TABLE bankroll_settings ADD COLUMN goal_stake VARCHAR(32)")

    strategy_cols = _column_names(inspector, "strategies")
    if strategy_cols and "game_tree" not in strategy_cols:
        statements.append("ALTER TABLE strategies ADD COLUMN game_tree JSON")

    share_cols = _column_names(inspector, "hand_shares")
    if share_cols and "views_count" not in share_cols:
        statements.append(
            "ALTER TABLE hand_shares ADD COLUMN views_count INTEGER NOT NULL DEFAULT 0"
        )

    hand_db_cols = _column_names(inspector, "hand_databases")
    if hand_db_cols and "career_report" not in hand_db_cols:
        statements.append("ALTER TABLE hand_databases ADD COLUMN career_report JSON")
    if hand_db_cols and "career_report_at" not in hand_db_cols:
        statements.append("ALTER TABLE hand_databases ADD COLUMN career_report_at DATETIME")

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
        if "google_sub" not in user_cols:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
        conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_display_name ON users (display_name)")
        )
        if upload_cols and "session_id" not in upload_cols:
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_hand_uploads_session_id ON hand_uploads (session_id)")
            )
        if upload_cols and "database_id" not in upload_cols:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_hand_uploads_database_id ON hand_uploads (database_id)"
                )
            )
        if hand_cols and "session_id" not in hand_cols:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_hands_session_id ON hands (session_id)"))
        if session_cols and "database_id" not in session_cols:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_play_sessions_database_id ON play_sessions (database_id)"
                )
            )
        if "active_database_id" not in user_cols:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_users_active_database_id ON users (active_database_id)"
                )
            )
        if entry_cols and "session_id" not in entry_cols:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bankroll_entries_session "
                    "ON bankroll_entries (session_id) WHERE session_id IS NOT NULL"
                )
            )
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_bankroll_entries_session_id ON bankroll_entries (session_id)")
            )
