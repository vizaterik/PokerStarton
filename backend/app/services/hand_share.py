from __future__ import annotations

import secrets
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, HandUpload, PlaySession
from app.models.hand_share import HandShare
from app.schemas.analysis import ReplayHand
from app.schemas.hand_share import HandShareRead
from app.services.hand_replay import build_replay_hand


def _owned_hand(db: Session, user_id: UUID, hand_id: UUID) -> Hand | None:
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    return db.scalar(
        select(Hand).where(
            Hand.id == hand_id,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
    )


def create_or_get_hand_share(db: Session, user_id: UUID, hand_id: UUID) -> HandShareRead:
    hand = _owned_hand(db, user_id, hand_id)
    if hand is None:
        raise LookupError("Раздача не найдена")

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
