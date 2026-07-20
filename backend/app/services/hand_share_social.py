from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand_share import HandShare
from app.models.hand_share_social import (
    HandShareComment,
    HandShareCommentLike,
    HandShareLike,
)
from app.models.user import User
from app.schemas.hand_share import (
    HandShareCommentCreate,
    HandShareCommentLikeRead,
    HandShareCommentRead,
    HandShareLikeRead,
    HandShareSocialRead,
)

VALID_STREETS = frozenset({"preflop", "flop", "turn", "river"})


def _share_by_token(db: Session, token: str) -> HandShare:
    clean = (token or "").strip()
    if not clean or len(clean) > 64:
        raise LookupError("Ссылка недействительна")
    share = db.scalar(select(HandShare).where(HandShare.token == clean))
    if share is None:
        raise LookupError("Ссылка недействительна")
    return share


def _author_name(user: User | None) -> str:
    if user is None:
        return "Игрок"
    name = (user.display_name or "").strip()
    if name:
        return name[:40]
    email = (user.email or "").strip()
    if email and "@" in email:
        return email.split("@", 1)[0][:40]
    return "Игрок"


def _comment_like_stats(
    db: Session,
    comment_ids: list[UUID],
    viewer: User | None,
) -> tuple[dict[UUID, int], set[UUID]]:
    if not comment_ids:
        return {}, set()
    counts: dict[UUID, int] = {cid: 0 for cid in comment_ids}
    for comment_id, n in db.execute(
        select(HandShareCommentLike.comment_id, func.count())
        .where(HandShareCommentLike.comment_id.in_(comment_ids))
        .group_by(HandShareCommentLike.comment_id)
    ):
        counts[comment_id] = int(n)
    liked: set[UUID] = set()
    if viewer is not None:
        liked = set(
            db.scalars(
                select(HandShareCommentLike.comment_id).where(
                    HandShareCommentLike.comment_id.in_(comment_ids),
                    HandShareCommentLike.user_id == viewer.id,
                )
            )
        )
    return counts, liked


def get_social(
    db: Session,
    token: str,
    viewer: User | None,
) -> HandShareSocialRead:
    share = _share_by_token(db, token)
    likes_count = int(
        db.scalar(
            select(func.count()).select_from(HandShareLike).where(HandShareLike.share_id == share.id)
        )
        or 0
    )
    liked_by_me = False
    if viewer is not None:
        liked_by_me = (
            db.scalar(
                select(HandShareLike.id).where(
                    HandShareLike.share_id == share.id,
                    HandShareLike.user_id == viewer.id,
                )
            )
            is not None
        )

    rows = list(
        db.scalars(
            select(HandShareComment)
            .where(HandShareComment.share_id == share.id)
            .order_by(HandShareComment.created_at.asc())
        )
    )
    user_ids = {r.user_id for r in rows}
    users: dict[UUID, User] = {}
    if user_ids:
        for u in db.scalars(select(User).where(User.id.in_(user_ids))):
            users[u.id] = u

    like_counts, liked_ids = _comment_like_stats(db, [r.id for r in rows], viewer)

    comments: list[HandShareCommentRead] = []
    my_by_street: dict[str, str] = {}
    for row in rows:
        street = row.street if row.street in VALID_STREETS else "preflop"
        is_mine = bool(viewer and row.user_id == viewer.id)
        if is_mine:
            my_by_street[street] = row.body
        comments.append(
            HandShareCommentRead(
                id=row.id,
                street=street,  # type: ignore[arg-type]
                body=row.body,
                author_name=_author_name(users.get(row.user_id)),
                is_mine=is_mine,
                likes_count=like_counts.get(row.id, 0),
                liked_by_me=row.id in liked_ids,
                created_at=row.created_at,
            )
        )

    return HandShareSocialRead(
        likes_count=likes_count,
        liked_by_me=liked_by_me,
        comments=comments,
        my_comments_by_street=my_by_street,
    )


def upsert_comment(
    db: Session,
    token: str,
    user: User,
    payload: HandShareCommentCreate,
) -> HandShareSocialRead:
    share = _share_by_token(db, token)
    street = payload.street
    if street not in VALID_STREETS:
        raise ValueError("Некорректная улица")
    body = (payload.body or "").strip()
    if not body:
        raise ValueError("Комментарий пустой")
    if len(body) > 1000:
        raise ValueError("Комментарий слишком длинный")

    existing = db.scalar(
        select(HandShareComment).where(
            HandShareComment.share_id == share.id,
            HandShareComment.user_id == user.id,
            HandShareComment.street == street,
        )
    )
    if existing is not None:
        existing.body = body
    else:
        db.add(
            HandShareComment(
                share_id=share.id,
                user_id=user.id,
                street=street,
                body=body,
            )
        )
    db.commit()
    return get_social(db, token, user)


def toggle_like(db: Session, token: str, user: User) -> HandShareLikeRead:
    share = _share_by_token(db, token)
    existing = db.scalar(
        select(HandShareLike).where(
            HandShareLike.share_id == share.id,
            HandShareLike.user_id == user.id,
        )
    )
    if existing is not None:
        db.delete(existing)
        liked = False
    else:
        db.add(HandShareLike(share_id=share.id, user_id=user.id))
        liked = True
    db.commit()
    likes_count = int(
        db.scalar(
            select(func.count()).select_from(HandShareLike).where(HandShareLike.share_id == share.id)
        )
        or 0
    )
    return HandShareLikeRead(likes_count=likes_count, liked_by_me=liked)


def toggle_comment_like(
    db: Session,
    token: str,
    comment_id: UUID,
    user: User,
) -> HandShareCommentLikeRead:
    share = _share_by_token(db, token)
    comment = db.scalar(
        select(HandShareComment).where(
            HandShareComment.id == comment_id,
            HandShareComment.share_id == share.id,
        )
    )
    if comment is None:
        raise LookupError("Комментарий не найден")

    existing = db.scalar(
        select(HandShareCommentLike).where(
            HandShareCommentLike.comment_id == comment.id,
            HandShareCommentLike.user_id == user.id,
        )
    )
    if existing is not None:
        db.delete(existing)
        liked = False
    else:
        db.add(HandShareCommentLike(comment_id=comment.id, user_id=user.id))
        liked = True
    db.commit()
    likes_count = int(
        db.scalar(
            select(func.count())
            .select_from(HandShareCommentLike)
            .where(HandShareCommentLike.comment_id == comment.id)
        )
        or 0
    )
    return HandShareCommentLikeRead(
        comment_id=comment.id,
        likes_count=likes_count,
        liked_by_me=liked,
    )
