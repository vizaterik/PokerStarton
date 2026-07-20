from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareLike
from app.models.user import User
from app.schemas.auth import ProfileStatsRead, ProfileTopHandRead
from app.services.social_rating import author_engagement_totals, author_rating


def get_profile_stats(db: Session, user: User, *, limit: int = 10) -> ProfileStatsRead:
    _views, likes_received, _comments = author_engagement_totals(db, user.id)
    shares_count = int(
        db.scalar(
            select(func.count()).select_from(HandShare).where(HandShare.created_by == user.id)
        )
        or 0
    )

    likes_subq = (
        select(
            HandShareLike.share_id.label("share_id"),
            func.count().label("likes_count"),
        )
        .group_by(HandShareLike.share_id)
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
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .outerjoin(likes_subq, likes_subq.c.share_id == HandShare.id)
        .where(HandShare.created_by == user.id)
        .where(func.coalesce(likes_subq.c.likes_count, 0) > 0)
        .order_by(
            func.coalesce(likes_subq.c.likes_count, 0).desc(),
            HandShare.created_at.desc(),
        )
        .limit(max(1, min(limit, 20)))
    ).all()

    top_hands: list[ProfileTopHandRead] = []
    for token, _created, hero_hand, hero_pos, played_at, hero_net, likes_count in rows:
        top_hands.append(
            ProfileTopHandRead(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                hero_hand=hero_hand,
                hero_position=hero_pos,
                played_at=played_at,
                hero_net=float(hero_net) if hero_net is not None else None,
            )
        )

    return ProfileStatsRead(
        registered_at=user.created_at,
        rating=author_rating(db, user.id),
        likes_received=likes_received,
        shares_count=shares_count,
        top_hands=top_hands,
    )
