from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareComment, HandShareLike
from app.models.user import User
from app.schemas.auth import ProfileStatsRead, ProfileTopHandRead
from app.services.social_rating import (
    author_engagement_totals,
    author_rating,
    author_shares_count,
)


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
