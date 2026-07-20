"""Add columns that exist on ORM models but may be missing after partial Alembic runs."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base


def _cols(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _add(statements: list[str], sql: str) -> None:
    statements.append(sql)


def ensure_postgres_schema(engine: Engine) -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "users" not in tables:
        return

    statements: list[str] = []
    user_cols = _cols(inspector, "users")
    for col, ddl in [
        ("active_database_id", "UUID"),
        ("accepted_terms", "BOOLEAN NOT NULL DEFAULT false"),
        ("accepted_terms_at", "TIMESTAMPTZ"),
        ("referral_code", "VARCHAR(32)"),
        ("referred_by_id", "UUID"),
        ("plan_id", "VARCHAR(32) NOT NULL DEFAULT 'starter'"),
        ("plan_started_at", "TIMESTAMPTZ"),
        ("hands_analyzed_month", "INTEGER NOT NULL DEFAULT 0"),
        ("hands_quota_month", "VARCHAR(7)"),
    ]:
        if col not in user_cols:
            # plan_id / accepted_terms / hands_analyzed have defaults above
            _add(statements, f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}")

    if "hand_uploads" in tables:
        upload_cols = _cols(inspector, "hand_uploads")
        if "database_id" not in upload_cols:
            _add(statements, "ALTER TABLE hand_uploads ADD COLUMN IF NOT EXISTS database_id UUID")
        if "session_id" not in upload_cols:
            _add(statements, "ALTER TABLE hand_uploads ADD COLUMN IF NOT EXISTS session_id UUID")

    if "play_sessions" in tables:
        session_cols = _cols(inspector, "play_sessions")
        if "database_id" not in session_cols:
            _add(statements, "ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS database_id UUID")
        if "status" not in session_cols:
            _add(
                statements,
                "ALTER TABLE play_sessions ADD COLUMN IF NOT EXISTS "
                "status VARCHAR(16) NOT NULL DEFAULT 'active'",
            )

    if "hands" in tables:
        hand_cols = _cols(inspector, "hands")
        if "session_id" not in hand_cols:
            _add(statements, "ALTER TABLE hands ADD COLUMN IF NOT EXISTS session_id UUID")
        for col in (
            "hero_net",
            "hero_net_bb",
            "hero_net_wsd",
            "hero_net_wsd_bb",
            "hero_net_wwsd",
            "hero_net_wwsd_bb",
        ):
            if col not in hand_cols:
                _add(
                    statements,
                    f"ALTER TABLE hands ADD COLUMN IF NOT EXISTS {col} NUMERIC(12, 4)",
                )
        if "went_to_showdown" not in hand_cols:
            _add(statements, "ALTER TABLE hands ADD COLUMN IF NOT EXISTS went_to_showdown BOOLEAN")

    if "analysis_snapshots" in tables:
        snap_cols = _cols(inspector, "analysis_snapshots")
        if "database_id" not in snap_cols:
            _add(statements, "ALTER TABLE analysis_snapshots ADD COLUMN IF NOT EXISTS database_id UUID")

    if "player_stats_aggregated" in tables:
        agg_cols = _cols(inspector, "player_stats_aggregated")
        if "database_id" not in agg_cols:
            _add(
                statements,
                "ALTER TABLE player_stats_aggregated ADD COLUMN IF NOT EXISTS database_id UUID",
            )

    if "hand_databases" in tables:
        hdb_cols = _cols(inspector, "hand_databases")
        if "career_report" not in hdb_cols:
            _add(statements, "ALTER TABLE hand_databases ADD COLUMN IF NOT EXISTS career_report JSON")
        if "career_report_at" not in hdb_cols:
            _add(
                statements,
                "ALTER TABLE hand_databases ADD COLUMN IF NOT EXISTS career_report_at TIMESTAMPTZ",
            )

    if "bankroll_entries" in tables:
        entry_cols = _cols(inspector, "bankroll_entries")
        if "session_id" not in entry_cols:
            _add(statements, "ALTER TABLE bankroll_entries ADD COLUMN IF NOT EXISTS session_id UUID")

    if "bankroll_settings" in tables:
        br_cols = _cols(inspector, "bankroll_settings")
        if "game_mode" not in br_cols:
            _add(
                statements,
                "ALTER TABLE bankroll_settings ADD COLUMN IF NOT EXISTS "
                "game_mode VARCHAR(16) NOT NULL DEFAULT 'cash'",
            )
        if "goal_stake" not in br_cols:
            _add(
                statements,
                "ALTER TABLE bankroll_settings ADD COLUMN IF NOT EXISTS goal_stake VARCHAR(32)",
            )

    if "strategies" in tables:
        strategy_cols = _cols(inspector, "strategies")
        if "game_tree" not in strategy_cols:
            _add(statements, "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS game_tree JSON")

    index_statements = [
        "CREATE INDEX IF NOT EXISTS ix_hand_uploads_database_id ON hand_uploads (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_hand_uploads_session_id ON hand_uploads (session_id)",
        "CREATE INDEX IF NOT EXISTS ix_play_sessions_database_id ON play_sessions (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_hands_session_id ON hands (session_id)",
        "CREATE INDEX IF NOT EXISTS ix_analysis_snapshots_database_id ON analysis_snapshots (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_player_stats_aggregated_database_id ON player_stats_aggregated (database_id)",
        "CREATE INDEX IF NOT EXISTS ix_users_active_database_id ON users (active_database_id)",
        "CREATE INDEX IF NOT EXISTS ix_bankroll_entries_session_id ON bankroll_entries (session_id)",
    ]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
        existing = set(inspect(engine).get_table_names())
        for statement in index_statements:
            try:
                on_part = statement.split(" ON ", 1)[1].split(" ", 1)[0]
            except IndexError:
                continue
            if on_part in existing:
                conn.execute(text(statement))
