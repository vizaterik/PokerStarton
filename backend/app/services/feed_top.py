from __future__ import annotations

from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareComment, HandShareLike
from app.models.user import User
from app.schemas.feed import (
    PublicProfileHand,
    PublicProfileRead,
    TopAuthorItem,
    TopAuthorsResponse,
)


def _rating(likes_received: int) -> int:
    return 1000 + max(0, likes_received) * 10


def _stakes_label(sb: object, bb: object) -> str | None:
    if sb is None or bb is None:
        return None
    try:
        return f"${float(sb):g}/${float(bb):g}"
    except (TypeError, ValueError):
        return None


def list_top_authors(db: Session, *, limit: int = 5) -> TopAuthorsResponse:
    lim = max(1, min(int(limit), 20))

    likes_by_share = (
        select(
            HandShareLike.share_id.label("share_id"),
            func.count().label("likes_count"),
        )
        .group_by(HandShareLike.share_id)
        .subquery()
    )
    comments_by_share = (
        select(
            HandShareComment.share_id.label("share_id"),
            func.count().label("comments_count"),
        )
        .group_by(HandShareComment.share_id)
        .subquery()
    )

    rows = db.execute(
        select(
            User.id,
            User.display_name,
            func.coalesce(func.sum(likes_by_share.c.likes_count), 0).label("likes_count"),
            func.coalesce(func.sum(HandShare.views_count), 0).label("views_count"),
            func.coalesce(func.sum(comments_by_share.c.comments_count), 0).label(
                "comments_count"
            ),
            func.count(HandShare.id).label("shares_count"),
        )
        .join(HandShare, HandShare.created_by == User.id)
        .outerjoin(likes_by_share, likes_by_share.c.share_id == HandShare.id)
        .outerjoin(comments_by_share, comments_by_share.c.share_id == HandShare.id)
        .where(User.display_name.is_not(None))
        .where(func.length(func.trim(User.display_name)) > 0)
        .group_by(User.id, User.display_name)
        .having(func.coalesce(func.sum(likes_by_share.c.likes_count), 0) > 0)
        .order_by(
            func.coalesce(func.sum(likes_by_share.c.likes_count), 0).desc(),
            func.coalesce(func.sum(HandShare.views_count), 0).desc(),
        )
        .limit(lim)
    ).all()

    items: list[TopAuthorItem] = []
    for _uid, display_name, likes_count, views_count, comments_count, shares_count in rows:
        name = (display_name or "").strip()
        if not name:
            continue
        likes_i = int(likes_count or 0)
        items.append(
            TopAuthorItem(
                display_name=name,
                path=f"/u/{quote(name)}",
                likes_count=likes_i,
                views_count=int(views_count or 0),
                comments_count=int(comments_count or 0),
                shares_count=int(shares_count or 0),
                rating=_rating(likes_i),
            )
        )

    return TopAuthorsResponse(items=items, total=len(items))


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
    views_count = int(
        db.scalar(
            select(func.coalesce(func.sum(HandShare.views_count), 0)).where(
                HandShare.created_by == user.id
            )
        )
        or 0
    )
    comments_count = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareComment)
            .join(HandShare, HandShare.id == HandShareComment.share_id)
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
            HandShare.views_count,
            Hand.hero_hand,
            Hand.hero_position,
            Hand.played_at,
            Hand.small_blind,
            Hand.big_blind,
            func.coalesce(likes_subq.c.likes_count, 0).label("likes_count"),
            func.coalesce(comments_subq.c.comments_count, 0).label("comments_count"),
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .outerjoin(likes_subq, likes_subq.c.share_id == HandShare.id)
        .outerjoin(comments_subq, comments_subq.c.share_id == HandShare.id)
        .where(HandShare.created_by == user.id)
        .order_by(
            func.coalesce(likes_subq.c.likes_count, 0).desc(),
            HandShare.views_count.desc(),
            HandShare.created_at.desc(),
        )
        .limit(10)
    ).all()

    top_hands: list[PublicProfileHand] = []
    for (
        token,
        hand_views,
        hero_hand,
        hero_pos,
        played_at,
        sb,
        bb,
        likes_count,
        hand_comments,
    ) in rows:
        top_hands.append(
            PublicProfileHand(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                views_count=int(hand_views or 0),
                comments_count=int(hand_comments or 0),
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
        views_count=views_count,
        comments_count=comments_count,
        shares_count=shares_count,
        top_hands=top_hands,
    )
