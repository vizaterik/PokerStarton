"""Shared social rating: unique views + likes + comments."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uuid import UUID

from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareComment, HandShareLike, HandShareView

# Europe/Moscow calendar day for «раздачи дня»
DAY_TZ = ZoneInfo("Europe/Moscow")

VIEW_POINTS = 1
LIKE_POINTS = 10
COMMENT_POINTS = 5
RATING_BASE = 1000


def rating_from_counts(*, unique_views: int, likes: int, comments: int) -> int:
    return (
        RATING_BASE
        + max(0, unique_views) * VIEW_POINTS
        + max(0, likes) * LIKE_POINTS
        + max(0, comments) * COMMENT_POINTS
    )


def engagement_score(*, unique_views: int, likes: int, comments: int) -> int:
    return (
        max(0, unique_views) * VIEW_POINTS
        + max(0, likes) * LIKE_POINTS
        + max(0, comments) * COMMENT_POINTS
    )


def moscow_day_start(now: datetime | None = None) -> datetime:
    local = (now or datetime.now(timezone.utc)).astimezone(DAY_TZ)
    start = datetime(local.year, local.month, local.day, tzinfo=DAY_TZ)
    return start.astimezone(timezone.utc)


def moscow_day_end(day_start_utc: datetime) -> datetime:
    return day_start_utc + timedelta(days=1)


def author_engagement_totals(db: Session, user_id: UUID) -> tuple[int, int, int]:
    """Return (unique_views, likes, comments) received on author's shares."""
    unique_views = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareView)
            .join(HandShare, HandShare.id == HandShareView.share_id)
            .where(HandShare.created_by == user_id)
        )
        or 0
    )
    likes = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareLike)
            .join(HandShare, HandShare.id == HandShareLike.share_id)
            .where(HandShare.created_by == user_id)
        )
        or 0
    )
    comments = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareComment)
            .join(HandShare, HandShare.id == HandShareComment.share_id)
            .where(HandShare.created_by == user_id)
        )
        or 0
    )
    return unique_views, likes, comments


def author_rating(db: Session, user_id: UUID) -> int:
    views, likes, comments = author_engagement_totals(db, user_id)
    return rating_from_counts(unique_views=views, likes=likes, comments=comments)
