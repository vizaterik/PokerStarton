from __future__ import annotations

from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.hand_share import HandShare
from app.models.hand_share_social import HandShareComment, HandShareLike
from app.models.user import User
from app.parsers.pokerstars import extract_hu_postflop_branch
from app.schemas.feed import PublicProfileRead, TopHandItem, TopHandsResponse


def _rating(likes_received: int) -> int:
    return 1000 + max(0, likes_received) * 10


def _hero_cards(hero_hand: str | None) -> list[str]:
    h = hero_hand or ""
    if len(h) >= 4:
        return [h[0:2], h[2:4]]
    return []


def _pot_and_matchup(
    *,
    raw_text: str | None,
    detected_spot: str | None,
    hero_position: str | None,
    villain_position: str | None,
) -> tuple[str | None, str | None]:
    branch = extract_hu_postflop_branch(raw_text)
    if branch:
        return branch.get("pot_tag"), branch.get("matchup")

    spot = (detected_spot or "").lower()
    pot_tag: str | None
    if "4bet" in spot or spot == "vs_4bet":
        pot_tag = "4-bet"
    elif "3bet" in spot or spot == "vs_3bet":
        pot_tag = "3-bet"
    elif spot == "limp":
        pot_tag = "Limp"
    elif spot:
        pot_tag = "Raise"
    else:
        pot_tag = None

    if hero_position and villain_position:
        matchup = f"{hero_position}vs{villain_position}"
    elif hero_position:
        matchup = hero_position
    else:
        matchup = None
    return pot_tag, matchup


def list_top_hands(db: Session, *, limit: int = 5) -> TopHandsResponse:
    """Best public hands by likes."""
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
            HandShare.token,
            HandShare.views_count,
            Hand.hero_hand,
            Hand.raw_text,
            Hand.detected_spot,
            Hand.hero_position,
            Hand.villain_position,
            User.display_name,
            func.coalesce(likes_by_share.c.likes_count, 0).label("likes_count"),
            func.coalesce(comments_by_share.c.comments_count, 0).label("comments_count"),
        )
        .join(Hand, Hand.id == HandShare.hand_id)
        .join(User, User.id == HandShare.created_by)
        .outerjoin(likes_by_share, likes_by_share.c.share_id == HandShare.id)
        .outerjoin(comments_by_share, comments_by_share.c.share_id == HandShare.id)
        .where(User.display_name.is_not(None))
        .where(func.length(func.trim(User.display_name)) > 0)
        .where(func.coalesce(likes_by_share.c.likes_count, 0) > 0)
        .order_by(
            func.coalesce(likes_by_share.c.likes_count, 0).desc(),
            func.coalesce(comments_by_share.c.comments_count, 0).desc(),
            HandShare.views_count.desc(),
            HandShare.created_at.desc(),
        )
        .limit(lim)
    ).all()

    items: list[TopHandItem] = []
    for (
        token,
        views_count,
        hero_hand,
        raw_text,
        detected_spot,
        hero_position,
        villain_position,
        display_name,
        likes_count,
        comments_count,
    ) in rows:
        name = (display_name or "").strip()
        if not name:
            continue
        pot_tag, matchup = _pot_and_matchup(
            raw_text=raw_text,
            detected_spot=detected_spot,
            hero_position=hero_position,
            villain_position=villain_position,
        )
        items.append(
            TopHandItem(
                token=token,
                path=f"/h/{token}",
                likes_count=int(likes_count or 0),
                comments_count=int(comments_count or 0),
                views_count=int(views_count or 0),
                author_display_name=name,
                author_path=f"/u/{quote(name)}",
                hero_cards=_hero_cards(hero_hand),
                pot_tag=pot_tag,
                matchup=matchup,
            )
        )

    return TopHandsResponse(items=items, total=len(items))


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

    return PublicProfileRead(
        display_name=user.display_name or nick,
        registered_at=user.created_at,
        rating=_rating(likes_received),
        likes_received=likes_received,
    )
