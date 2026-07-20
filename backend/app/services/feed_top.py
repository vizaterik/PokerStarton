from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareLike
from app.models.user import User
from app.schemas.feed import TopLikedFeedItem, TopLikedFeedResponse


def _author_name(user: User | None) -> str | None:
    if user is None:
        return None
    name = (user.display_name or "").strip()
    if name:
        return name[:40]
    email = (user.email or "").strip()
    if email and "@" in email:
        return email.split("@", 1)[0][:40]
    return None


def _stakes_label(sb: object, bb: object) -> str | None:
    if sb is None or bb is None:
        return None
    try:
        return f"${float(sb):g}/${float(bb):g}"
    except (TypeError, ValueError):
        return None


def list_top_liked_shares(db: Session, *, limit: int = 5) -> TopLikedFeedResponse:
    lim = max(1, min(int(limit), 20))
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
            Hand.small_blind,
            Hand.big_blind,
            Hand.hero_net,
            User,
            func.coalesce(likes_subq.c.likes_count, 0).label("likes_count"),
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .outerjoin(User, User.id == HandShare.created_by)
        .join(likes_subq, likes_subq.c.share_id == HandShare.id)
        .where(func.coalesce(likes_subq.c.likes_count, 0) > 0)
        .order_by(
            func.coalesce(likes_subq.c.likes_count, 0).desc(),
            HandShare.created_at.desc(),
        )
        .limit(lim)
    ).all()

    items: list[TopLikedFeedItem] = []
    for (
        token,
        _created,
        hero_hand,
        hero_pos,
        played_at,
        sb,
        bb,
        hero_net,
        user,
        likes_count,
    ) in rows:
        items.append(
            TopLikedFeedItem(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                hero_hand=hero_hand,
                hero_position=hero_pos,
                author_name=_author_name(user),
                played_at=played_at,
                stakes_label=_stakes_label(sb, bb),
                hero_net=float(hero_net) if hero_net is not None else None,
            )
        )

    return TopLikedFeedResponse(items=items, total=len(items))
