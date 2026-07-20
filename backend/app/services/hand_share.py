from __future__ import annotations

import secrets
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, HandUpload, PlaySession
from app.models.hand_share import HandShare
from app.models.user import User
from app.parsers.pokerstars import parse_pokerstars
from app.schemas.analysis import ReplayHand
from app.schemas.hand_share import HandShareRead
from app.services import databases as db_svc
from app.services.hand_limits import assert_database_capacity
from app.services.hand_pipeline import _persist_hand
from app.services.hand_replay import build_replay_hand


def _dec(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _owned_hand(db: Session, user_id: UUID, hand_id: UUID) -> Hand | None:
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    return db.scalar(
        select(Hand).where(
            Hand.id == hand_id,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
    )


def _find_owned_by_external(db: Session, user_id: UUID, external_hand_id: str) -> Hand | None:
    eid = (external_hand_id or "").strip()[:64]
    if not eid:
        return None
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    return db.scalar(
        select(Hand)
        .where(
            Hand.external_hand_id == eid,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
        .order_by(Hand.played_at.desc().nulls_last())
        .limit(1)
    )


def _ensure_share_row(db: Session, user_id: UUID, hand_id: UUID) -> HandShareRead:
    existing = db.scalar(select(HandShare).where(HandShare.hand_id == hand_id))
    if existing is not None:
        return HandShareRead(token=existing.token, path=f"/h/{existing.token}")

    share = HandShare(
        token=secrets.token_urlsafe(16),
        hand_id=hand_id,
        created_by=user_id,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return HandShareRead(token=share.token, path=f"/h/{share.token}")


def create_or_get_hand_share(db: Session, user_id: UUID, hand_id: UUID) -> HandShareRead:
    hand = _owned_hand(db, user_id, hand_id)
    if hand is None:
        raise LookupError("Раздача не найдена")
    return _ensure_share_row(db, user_id, hand.id)


def create_share_from_raw_text(
    db: Session,
    user: User,
    *,
    raw_text: str,
    external_hand_id: str | None = None,
) -> HandShareRead:
    """Upsert a single hand (if needed) and return a public /h/{token} link.

    Does not archive the active session, apply HUD/bankroll, or consume analysis quota.
    """
    text = (raw_text or "").strip()
    if len(text) < 40:
        raise ValueError("Текст раздачи слишком короткий")

    parsed_list = parse_pokerstars(text)
    if not parsed_list:
        raise ValueError("Не удалось разобрать историю рук")
    parsed = parsed_list[0]
    if external_hand_id and external_hand_id.strip():
        parsed.external_hand_id = external_hand_id.strip()[:64]

    existing = _find_owned_by_external(db, user.id, parsed.external_hand_id)
    if existing is not None:
        # Prefer richer raw_text if the stored copy is empty (shouldn't happen).
        if not (existing.raw_text or "").strip() and parsed.raw_text:
            existing.raw_text = parsed.raw_text
            db.commit()
        return _ensure_share_row(db, user.id, existing.id)

    active_db = db_svc.get_active_database(db, user)
    assert_database_capacity(db, database_id=active_db.id, additional_hands=1)

    session = PlaySession(
        user_id=user.id,
        database_id=active_db.id,
        strategy_id=None,
        room="pokerstars",
        label="Shared hand",
        source_filename="share.txt",
        table_name=parsed.table_name,
        small_blind=_dec(parsed.small_blind),
        big_blind=_dec(parsed.big_blind),
        max_seats=None,
        started_at=parsed.played_at,
        ended_at=parsed.played_at,
        hands_count=1,
        status="archived",
    )
    db.add(session)
    db.flush()

    upload = HandUpload(
        user_id=user.id,
        database_id=active_db.id,
        strategy_id=None,
        session_id=session.id,
        room="pokerstars",
        original_filename="share.txt",
        storage_path=None,
        status="analyzed",
        hands_count=1,
        processed_at=datetime.now(timezone.utc),
    )
    db.add(upload)
    db.flush()

    hand = _persist_hand(db, upload, parsed, session.id)
    db.commit()
    return _ensure_share_row(db, user.id, hand.id)


def get_public_hand_replay(db: Session, token: str) -> ReplayHand:
    clean = (token or "").strip()
    if not clean or len(clean) > 64:
        raise LookupError("Ссылка недействительна")

    share = db.scalar(select(HandShare).where(HandShare.token == clean))
    if share is None:
        raise LookupError("Ссылка недействительна")

    hand = db.scalar(
        select(Hand)
        .options(selectinload(Hand.actions))
        .where(Hand.id == share.hand_id)
    )
    if hand is None:
        raise LookupError("Раздача не найдена")
    return build_replay_hand(hand)
