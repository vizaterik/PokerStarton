from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareComment, HandShareLike
from app.models.user import User
from app.schemas.auth import ProfileStatsRead, ProfileTopHandRead
from app.schemas.feed import ProfileCommentItem, ProfileCommentsResponse
from app.services.social_rating import (
    author_engagement_totals,
    author_rating,
    author_shares_count,
)


def _comment_author_name(display_name: str | None, email: str | None) -> str:
    name = (display_name or "").strip()
    if name:
        return name[:40]
    mail = (email or "").strip()
    if mail and "@" in mail:
        return mail.split("@", 1)[0][:40]
    return "Игрок"


def list_author_received_comments(
    db: Session, user_id: UUID, *, limit: int = 100
) -> ProfileCommentsResponse:
    """All comments left on the author's published hands."""
    lim = max(1, min(int(limit), 200))
    rows = db.execute(
        select(
            HandShareComment.id,
            HandShareComment.body,
            HandShareComment.street,
            HandShareComment.created_at,
            HandShare.token,
            Hand.hero_hand,
            User.display_name,
            User.email,
        )
        .join(HandShare, HandShare.id == HandShareComment.share_id)
        .join(Hand, Hand.id == HandShare.hand_id)
        .join(User, User.id == HandShareComment.user_id)
        .where(HandShare.created_by == user_id)
        .order_by(HandShareComment.created_at.desc())
        .limit(lim)
    ).all()

    items: list[ProfileCommentItem] = []
    for (
        cid,
        body,
        street,
        created_at,
        token,
        hero_hand,
        display_name,
        email,
    ) in rows:
        items.append(
            ProfileCommentItem(
                id=str(cid),
                body=body,
                street=street,
                author_name=_comment_author_name(display_name, email),
                created_at=created_at,
                hand_token=token,
                hand_path=f"/h/{token}",
                hero_hand=hero_hand,
            )
        )
    return ProfileCommentsResponse(items=items, total=len(items))


def list_author_shared_hands(
    db: Session, user_id: UUID, *, limit: int = 20
) -> list[ProfileTopHandRead]:
    lim = max(1, min(int(limit), 50))
    likes_subq = (
        select(
            HandShareLike.share_id.label("share_id"),
            func.count().label("likes_count"),
        )
        .group_by(HandShareLike.share_id)
        .subquery()
    )
    comments_subq = (
        select(
            HandShareComment.share_id.label("share_id"),
            func.count().label("comments_count"),
        )
        .group_by(HandShareComment.share_id)
        .subquery()
    )

    rows = db.execute(
        select(
            HandShare.token,
            HandShare.created_at,
            Hand.hero_hand,
            Hand.hero_position,
            Hand.played_at,
            Hand.hero_net,
            func.coalesce(likes_subq.c.likes_count, 0).label("likes_count"),
            func.coalesce(comments_subq.c.comments_count, 0).label("comments_count"),
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .outerjoin(likes_subq, likes_subq.c.share_id == HandShare.id)
        .outerjoin(comments_subq, comments_subq.c.share_id == HandShare.id)
        .where(HandShare.created_by == user_id)
        .order_by(
            func.coalesce(likes_subq.c.likes_count, 0).desc(),
            func.coalesce(comments_subq.c.comments_count, 0).desc(),
            HandShare.created_at.desc(),
        )
        .limit(lim)
    ).all()

    hands: list[ProfileTopHandRead] = []
    for (
        token,
        _created,
        hero_hand,
        hero_pos,
        played_at,
        hero_net,
        likes_count,
        comments_count,
    ) in rows:
        hands.append(
            ProfileTopHandRead(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                comments_count=int(comments_count or 0),
                hero_hand=hero_hand,
                hero_position=hero_pos,
                played_at=played_at,
                hero_net=float(hero_net) if hero_net is not None else None,
            )
        )
    return hands


def get_profile_stats(db: Session, user: User, *, limit: int = 20) -> ProfileStatsRead:
    views, likes_received, comments_count = author_engagement_totals(db, user.id)
    return ProfileStatsRead(
        registered_at=user.created_at,
        rating=author_rating(db, user.id),
        likes_received=likes_received,
        comments_count=comments_count,
        unique_views=views,
        shares_count=author_shares_count(db, user.id),
        top_hands=list_author_shared_hands(db, user.id, limit=limit),
    )


def get_public_author_comments(
    db: Session, display_name: str, *, limit: int = 100
) -> ProfileCommentsResponse:
    nick = (display_name or "").strip()
    if not nick or len(nick) > 40:
        raise LookupError("Профиль не найден")
    user = db.scalar(select(User).where(func.lower(User.display_name) == nick.lower()))
    if user is None or not (user.display_name or "").strip():
        raise LookupError("Профиль не найден")
    return list_author_received_comments(db, user.id, limit=limit)
