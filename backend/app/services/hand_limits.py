"""Hard limits for hand databases and single-session analysis uploads."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand, HandUpload, PlaySession

# Максимум рук в одной базе данных
MAX_HANDS_PER_DATABASE = 100_000
# Максимум рук за один анализ сессии (одна загрузка / батч)
MAX_HANDS_PER_ANALYSIS = 100_000


def count_database_hands(db: Session, database_id: UUID) -> int:
    """Count unique hands in a hand database (by room hand id).

    Re-uploads archive prior sittings and insert the same hands again — raw row
    count must not inflate the profile limit or mislead the career report.
    """
    via_session = int(
        db.scalar(
            select(func.count(func.distinct(Hand.external_hand_id)))
            .select_from(Hand)
            .join(PlaySession, Hand.session_id == PlaySession.id)
            .where(PlaySession.database_id == database_id)
        )
        or 0
    )
    via_upload = int(
        db.scalar(
            select(func.count(func.distinct(Hand.external_hand_id)))
            .select_from(Hand)
            .join(HandUpload, Hand.upload_id == HandUpload.id)
            .where(
                HandUpload.database_id == database_id,
                Hand.session_id.is_(None),
            )
        )
        or 0
    )
    # Orphans without session are rare; overlap with session hands is ignored
    # (distinct across both would need a UNION). Prefer session count when both.
    if via_session and via_upload:
        return via_session
    return via_session + via_upload


def assert_analysis_batch_size(estimated_hands: int) -> None:
    if estimated_hands <= MAX_HANDS_PER_ANALYSIS:
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"За один анализ можно загрузить не больше "
            f"{MAX_HANDS_PER_ANALYSIS:,} рук (сейчас ≈ {estimated_hands:,})."
        ).replace(",", " "),
    )


def assert_database_capacity(
    db: Session,
    *,
    database_id: UUID,
    additional_hands: int,
) -> None:
    if additional_hands <= 0:
        return
    current = count_database_hands(db, database_id)
    if current + additional_hands <= MAX_HANDS_PER_DATABASE:
        return
    free = max(MAX_HANDS_PER_DATABASE - current, 0)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Лимит базы — {MAX_HANDS_PER_DATABASE:,} рук "
            f"(сейчас {current:,}, свободно {free:,}). "
            f"Очисти базу, создай новую или загрузи меньше рук."
        ).replace(",", " "),
    )
