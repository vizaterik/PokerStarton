from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareLike
from app.models.user import User
from app.schemas.feed import (
    PublicProfileHand,
    PublicProfileRead,
    TopLikedFeedItem,
    TopLikedFeedResponse,
)


def _author_name(user: User | None) -> str | None:
    if user is None:
        return None
    name = (user.display_name or "").strip()
    if name:
        return name[:40]
    return None


def _author_path(user: User | None) -> str | None:
    name = _author_name(user)
    if not name:
        return None
    from urllib.parse import quote

    return f"/u/{quote(name)}"


def _stakes_label(sb: object, bb: object) -> str | None:
    if sb is None or bb is None:
        return None
    try:
        return f"${float(sb):g}/${float(bb):g}"
    except (TypeError, ValueError):
        return None


def _rating(likes_received: int) -> int:
    return 1000 + max(0, likes_received) * 10


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
            HandShare.views_count,
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
            HandShare.views_count.desc(),
            HandShare.created_at.desc(),
        )
        .limit(lim)
    ).all()

    items: list[TopLikedFeedItem] = []
    for (
        token,
        _created,
        views_count,
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
                views_count=int(views_count or 0),
                hero_hand=hero_hand,
                hero_position=hero_pos,
                author_name=_author_name(user),
                author_path=_author_path(user),
                played_at=played_at,
                stakes_label=_stakes_label(sb, bb),
                hero_net=float(hero_net) if hero_net is not None else None,
            )
        )

    return TopLikedFeedResponse(items=items, total=len(items))


def get_public_profile(db: Session, display_name: str) -> PublicProfileRead:
    nick = (display_name or "").strip()
    if not nick or len(nick) > 40:
        raise LookupError("Профиль не найден")

    user = db.scalar(select(User).where(func.lower(User.display_name) == nick.lower()))
    if user is None or not (user.display_name or "").strip():
        raise LookupError("Профиль не найден")

    likes_received = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareLike)
            .join(HandShare, HandShare.id == HandShareLike.share_id)
            .where(HandShare.created_by == user.id)
        )
        or 0
    )
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
            HandShare.views_count,
            Hand.hero_hand,
            Hand.hero_position,
            Hand.played_at,
            Hand.small_blind,
            Hand.big_blind,
            func.coalesce(likes_subq.c.likes_count, 0).label("likes_count"),
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .outerjoin(likes_subq, likes_subq.c.share_id == HandShare.id)
        .where(HandShare.created_by == user.id)
        .order_by(
            func.coalesce(likes_subq.c.likes_count, 0).desc(),
            HandShare.views_count.desc(),
            HandShare.created_at.desc(),
        )
        .limit(10)
    ).all()

    top_hands: list[PublicProfileHand] = []
    for token, views_count, hero_hand, hero_pos, played_at, sb, bb, likes_count in rows:
        top_hands.append(
            PublicProfileHand(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                views_count=int(views_count or 0),
                hero_hand=hero_hand,
                hero_position=hero_pos,
                played_at=played_at,
                stakes_label=_stakes_label(sb, bb),
            )
        )

    return PublicProfileRead(
        display_name=user.display_name or nick,
        registered_at=user.created_at,
        rating=_rating(likes_received),
        likes_received=likes_received,
        shares_count=shares_count,
        top_hands=top_hands,
    )
