"""H2N-style hand databases (workspaces) for sessions / hands / uploads."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.models.analysis_snapshot import AnalysisSnapshot
from app.models.bankroll import BankrollEntry
from app.models.hand import Deviation, Hand, HandAction, HandUpload, PlaySession
from app.models.hand_database import HandDatabase
from app.models.hand_share import HandShare
from app.models.player_stats import HudAggregationCredit, PlayerStatsAggregated
from app.models.user import User
from app.services.hand_limits import MAX_HANDS_PER_DATABASE, count_database_hands

DEFAULT_DB_NAME = "Основная"


def attach_orphan_hand_rows(db: Session, user: User, database_id: UUID) -> int:
    """Attach sessions/uploads with null database_id to the given hand database.

    Career report and schedule filter by active database_id — orphans would
    otherwise disappear from all-time graphs even though hands are still stored.
    """
    n = 0
    for session in db.scalars(
        select(PlaySession).where(
            PlaySession.user_id == user.id,
            PlaySession.database_id.is_(None),
        )
    ):
        session.database_id = database_id
        n += 1
    for upload in db.scalars(
        select(HandUpload).where(
            HandUpload.user_id == user.id,
            HandUpload.database_id.is_(None),
        )
    ):
        upload.database_id = database_id
        n += 1
    if n:
        db.flush()
    return n


def ensure_default_database(db: Session, user: User) -> HandDatabase:
    """Ensure the user has at least one database and an active selection."""
    existing = list(
        db.scalars(
            select(HandDatabase)
            .where(HandDatabase.user_id == user.id)
            .order_by(HandDatabase.created_at.asc())
        )
    )
    if not existing:
        db_row = HandDatabase(user_id=user.id, name=DEFAULT_DB_NAME)
        db.add(db_row)
        db.flush()
        attach_orphan_hand_rows(db, user, db_row.id)
        user.active_database_id = db_row.id
        db.flush()
        return db_row

    active_id = user.active_database_id
    active = next((d for d in existing if d.id == active_id), None)
    if active is None:
        active = existing[0]
        user.active_database_id = active.id
        db.flush()
    # NOTE: do NOT attach orphans / purge on every call — that scans tables and
    # locks SQLite while analysis runs, so login and /api/me freeze.
    # Orphans are attached on DB create and after upload.
    return active


def get_active_database(db: Session, user: User) -> HandDatabase:
    return ensure_default_database(db, user)


def get_active_database_id(db: Session, user: User) -> UUID:
    return get_active_database(db, user).id


def list_databases(db: Session, user: User) -> list[dict]:
    ensure_default_database(db, user)
    rows = list(
        db.scalars(
            select(HandDatabase)
            .where(HandDatabase.user_id == user.id)
            .order_by(HandDatabase.created_at.asc())
        )
    )
    out: list[dict] = []
    for row in rows:
        sessions = db.scalar(
            select(func.count())
            .select_from(PlaySession)
            .where(PlaySession.database_id == row.id)
        ) or 0
        hands = count_database_hands(db, row.id)
        uploads = db.scalar(
            select(func.count())
            .select_from(HandUpload)
            .where(HandUpload.database_id == row.id)
        ) or 0
        out.append(
            {
                "id": row.id,
                "name": row.name,
                "created_at": row.created_at,
                "is_active": user.active_database_id == row.id,
                "sessions_count": int(sessions),
                "hands_count": int(hands),
                "hands_limit": MAX_HANDS_PER_DATABASE,
                "uploads_count": int(uploads),
            }
        )
    return out


def create_database(db: Session, user: User, name: str, *, switch: bool = True) -> HandDatabase:
    ensure_default_database(db, user)
    clean = name.strip()
    if not clean:
        raise ValueError("Название базы не может быть пустым")
    if len(clean) > 120:
        raise ValueError("Название слишком длинное")
    exists = db.scalar(
        select(HandDatabase).where(
            HandDatabase.user_id == user.id,
            HandDatabase.name == clean,
        )
    )
    if exists is not None:
        raise ValueError("База с таким именем уже есть")
    row = HandDatabase(user_id=user.id, name=clean)
    db.add(row)
    db.flush()
    if switch:
        user.active_database_id = row.id
    db.flush()
    return row


def switch_database(db: Session, user: User, database_id: UUID) -> HandDatabase:
    row = db.get(HandDatabase, database_id)
    if row is None or row.user_id != user.id:
        raise ValueError("База не найдена")
    user.active_database_id = row.id
    db.flush()
    return row


def clear_database(db: Session, user: User, database_id: UUID) -> dict:
    """Delete all hands / sessions / uploads inside the database (keep the DB itself).

    Uses bulk SQL — ORM cascade on large sessions OOMs / hangs the API.
    """
    row = db.get(HandDatabase, database_id)
    if row is None or row.user_id != user.id:
        raise ValueError("База не найдена")

    uploads_count = int(
        db.scalar(
            select(func.count()).select_from(HandUpload).where(HandUpload.database_id == row.id)
        )
        or 0
    )
    sessions_count = int(
        db.scalar(
            select(func.count())
            .select_from(PlaySession)
            .where(PlaySession.database_id == row.id)
        )
        or 0
    )

    storage_paths = list(
        db.scalars(
            select(HandUpload.storage_path).where(
                HandUpload.database_id == row.id,
                HandUpload.storage_path.is_not(None),
            )
        )
    )

    upload_subq = select(HandUpload.id).where(HandUpload.database_id == row.id)
    session_subq = select(PlaySession.id).where(PlaySession.database_id == row.id)
    hand_subq = select(Hand.id).where(
        or_(Hand.upload_id.in_(upload_subq), Hand.session_id.in_(session_subq))
    )

    # Subqueries — avoid loading tens of thousands of UUIDs into Python.
    db.execute(delete(HandShare).where(HandShare.hand_id.in_(hand_subq)))
    db.execute(delete(Deviation).where(Deviation.hand_id.in_(hand_subq)))
    db.execute(delete(HandAction).where(HandAction.hand_id.in_(hand_subq)))
    db.execute(delete(Hand).where(Hand.id.in_(hand_subq)))

    db.execute(delete(AnalysisSnapshot).where(AnalysisSnapshot.session_id.in_(session_subq)))
    db.execute(
        delete(HudAggregationCredit).where(
            HudAggregationCredit.session_id.in_(session_subq)
        )
    )
    db.execute(
        update(BankrollEntry)
        .where(BankrollEntry.session_id.in_(session_subq))
        .values(session_id=None)
    )
    db.execute(delete(AnalysisSnapshot).where(AnalysisSnapshot.database_id == row.id))

    db.execute(delete(HandUpload).where(HandUpload.database_id == row.id))
    db.execute(delete(PlaySession).where(PlaySession.database_id == row.id))
    db.execute(
        delete(PlayerStatsAggregated).where(PlayerStatsAggregated.database_id == row.id)
    )

    uploads_deleted = uploads_count
    sessions_deleted = sessions_count

    removed_files = 0
    for path_str in storage_paths:
        if not path_str:
            continue
        try:
            path = Path(path_str)
            if path.is_file():
                path.unlink()
                removed_files += 1
        except OSError:
            pass

    row.career_report = None
    row.career_report_at = None
    db.flush()
    return {
        "database_id": row.id,
        "uploads_deleted": uploads_deleted,
        "sessions_deleted": sessions_deleted,
        "files_removed": removed_files,
    }


def delete_database(db: Session, user: User, database_id: UUID) -> dict:
    row = db.get(HandDatabase, database_id)
    if row is None or row.user_id != user.id:
        raise ValueError("База не найдена")

    others = list(
        db.scalars(
            select(HandDatabase).where(
                HandDatabase.user_id == user.id,
                HandDatabase.id != row.id,
            )
        )
    )

    # Sole database: wipe contents and keep an empty shell (cannot drop the last row).
    if not others:
        stats = clear_database(db, user, database_id)
        if row.name != DEFAULT_DB_NAME:
            # Free the name slot if user recreates later under old title.
            clash = db.scalar(
                select(HandDatabase).where(
                    HandDatabase.user_id == user.id,
                    HandDatabase.name == DEFAULT_DB_NAME,
                    HandDatabase.id != row.id,
                )
            )
            if clash is None:
                row.name = DEFAULT_DB_NAME
        user.active_database_id = row.id
        db.flush()
        return {
            **stats,
            "deleted": False,
            "reset": True,
            "active_database_id": user.active_database_id,
        }

    # Point active away before dropping the row.
    was_active = user.active_database_id == row.id
    if was_active:
        user.active_database_id = others[0].id
        db.flush()

    stats = clear_database(db, user, database_id)
    db.delete(row)
    db.flush()
    return {
        **stats,
        "deleted": True,
        "reset": False,
        "active_database_id": user.active_database_id,
    }


def rename_database(db: Session, user: User, database_id: UUID, name: str) -> HandDatabase:
    row = db.get(HandDatabase, database_id)
    if row is None or row.user_id != user.id:
        raise ValueError("База не найдена")
    clean = name.strip()
    if not clean:
        raise ValueError("Название базы не может быть пустым")
    clash = db.scalar(
        select(HandDatabase).where(
            HandDatabase.user_id == user.id,
            HandDatabase.name == clean,
            HandDatabase.id != row.id,
        )
    )
    if clash is not None:
        raise ValueError("База с таким именем уже есть")
    row.name = clean
    db.flush()
    return row
