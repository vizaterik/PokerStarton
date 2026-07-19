"""Delete a user account while retaining hand histories in a system archive."""

from __future__ import annotations

import secrets
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.bankroll import BankrollEntry, BankrollSettings
from app.models.hand import Deviation, Hand, HandUpload, PlaySession
from app.models.hand_share import HandShare
from app.models.strategy import Strategy
from app.models.user import User

# Durable system owner for retained HH after account deletion.
ARCHIVE_USER_ID = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
ARCHIVE_EMAIL = "archive@pokerstraton.internal"


def is_archive_user(user: User | None) -> bool:
    if user is None:
        return False
    return user.id == ARCHIVE_USER_ID or user.email.lower() == ARCHIVE_EMAIL


def get_or_create_archive_user(db: Session) -> User:
    user = db.get(User, ARCHIVE_USER_ID)
    if user is not None:
        return user
    by_email = db.scalar(select(User).where(User.email == ARCHIVE_EMAIL))
    if by_email is not None:
        return by_email

    user = User(
        id=ARCHIVE_USER_ID,
        email=ARCHIVE_EMAIL,
        password_hash=hash_password(secrets.token_urlsafe(48)),
        display_name="Archive",
        email_verified=True,
        google_sub=None,
    )
    db.add(user)
    db.flush()
    return user


def delete_user_account(db: Session, user: User) -> dict[str, int]:
    """Wipe player data; reassign uploads/sessions/hands to the system archive user."""
    if is_archive_user(user):
        raise ValueError("Системный архив нельзя удалить")

    archive = get_or_create_archive_user(db)
    uid = user.id

    upload_ids = list(db.scalars(select(HandUpload.id).where(HandUpload.user_id == uid)))
    session_ids = list(db.scalars(select(PlaySession.id).where(PlaySession.user_id == uid)))

    shares_deleted = db.execute(
        delete(HandShare).where(HandShare.created_by == uid)
    ).rowcount or 0
    deviations_deleted = db.execute(
        delete(Deviation).where(Deviation.user_id == uid)
    ).rowcount or 0
    db.execute(delete(BankrollEntry).where(BankrollEntry.user_id == uid))
    db.execute(delete(BankrollSettings).where(BankrollSettings.user_id == uid))

    # Detach strategies, then drop charts
    db.execute(update(HandUpload).where(HandUpload.user_id == uid).values(strategy_id=None))
    db.execute(update(PlaySession).where(PlaySession.user_id == uid).values(strategy_id=None))
    strategies_deleted = db.execute(
        delete(Strategy).where(Strategy.user_id == uid)
    ).rowcount or 0

    # Keep hands: move ownership to archive + mark sessions archived
    uploads_archived = 0
    if upload_ids:
        uploads_archived = db.execute(
            update(HandUpload)
            .where(HandUpload.id.in_(upload_ids))
            .values(user_id=archive.id, strategy_id=None)
        ).rowcount or 0

    sessions_archived = 0
    if session_ids:
        sessions_archived = db.execute(
            update(PlaySession)
            .where(PlaySession.id.in_(session_ids))
            .values(user_id=archive.id, strategy_id=None, status="archived")
        ).rowcount or 0

    # Scrub hero nicknames on retained hands (HH body stays for product archive)
    if upload_ids:
        db.execute(
            update(Hand).where(Hand.upload_id.in_(upload_ids)).values(hero_name=None)
        )

    # SQL delete avoids ORM cascade wiping reassigned uploads still in identity map
    db.execute(delete(User).where(User.id == uid))
    db.commit()

    return {
        "uploads_archived": int(uploads_archived),
        "sessions_archived": int(sessions_archived),
        "strategies_deleted": int(strategies_deleted),
        "deviations_deleted": int(deviations_deleted),
        "shares_deleted": int(shares_deleted),
    }
