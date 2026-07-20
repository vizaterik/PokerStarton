from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.feed import FeedPost, FeedSettings
from app.models.user import User
from app.schemas.feed import (
    FeedIngestRequest,
    FeedPostDetail,
    FeedPostListItem,
    FeedPostListResponse,
    FeedSettingsRead,
    FeedSettingsUpdate,
)
from app.services import feed_llm, feed_youtube

DEFAULT_QUERIES = [
    "poker hand history review",
    "NL50 hand analysis",
    "poker hand breakdown",
]


def _preview(text: str, n: int = 220) -> str:
    t = re_sub_ws(text or "")
    if len(t) <= n:
        return t
    return t[: n - 1].rstrip() + "…"


def re_sub_ws(text: str) -> str:
    import re

    return re.sub(r"\s+", " ", (text or "").strip())


def get_or_create_settings(db: Session) -> FeedSettings:
    row = db.get(FeedSettings, 1)
    if row is not None:
        return row
    row = FeedSettings(
        id=1,
        auto_enabled=False,
        auto_publish=False,
        search_queries=list(DEFAULT_QUERIES),
        max_posts_per_day=5,
        min_views=0,
        model_name="gpt-4o-mini",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def settings_to_read(row: FeedSettings) -> FeedSettingsRead:
    queries = row.search_queries if isinstance(row.search_queries, list) else []
    return FeedSettingsRead(
        auto_enabled=bool(row.auto_enabled),
        auto_publish=bool(row.auto_publish),
        search_queries=[str(q) for q in queries if str(q).strip()],
        max_posts_per_day=int(row.max_posts_per_day or 5),
        min_views=int(row.min_views or 0),
        model_name=str(row.model_name or "gpt-4o-mini"),
    )


def update_settings(db: Session, payload: FeedSettingsUpdate) -> FeedSettingsRead:
    row = get_or_create_settings(db)
    data = payload.model_dump(exclude_unset=True)
    if "search_queries" in data and data["search_queries"] is not None:
        row.search_queries = [str(q).strip() for q in data["search_queries"] if str(q).strip()][:20]
    if "auto_enabled" in data and data["auto_enabled"] is not None:
        row.auto_enabled = bool(data["auto_enabled"])
    if "auto_publish" in data and data["auto_publish"] is not None:
        row.auto_publish = bool(data["auto_publish"])
    if "max_posts_per_day" in data and data["max_posts_per_day"] is not None:
        row.max_posts_per_day = int(data["max_posts_per_day"])
    if "min_views" in data and data["min_views"] is not None:
        row.min_views = int(data["min_views"])
    if "model_name" in data and data["model_name"] is not None:
        row.model_name = str(data["model_name"]).strip()[:64] or "gpt-4o-mini"
    db.commit()
    db.refresh(row)
    return settings_to_read(row)


def _post_to_list_item(post: FeedPost) -> FeedPostListItem:
    tags = post.tags if isinstance(post.tags, list) else []
    return FeedPostListItem(
        id=post.id,
        status=post.status,  # type: ignore[arg-type]
        source_type=post.source_type,  # type: ignore[arg-type]
        source_url=post.source_url,
        source_title=post.source_title,
        source_channel=post.source_channel,
        title=post.title,
        analysis_preview=_preview(post.analysis_md),
        hero_hand=post.hero_hand,
        stakes_label=post.stakes_label,
        tags=[str(t) for t in tags if str(t).strip()],
        has_replay=bool(post.has_replay),
        created_at=post.created_at,
        published_at=post.published_at,
    )


def _post_to_detail(post: FeedPost) -> FeedPostDetail:
    base = _post_to_list_item(post)
    return FeedPostDetail(
        **base.model_dump(),
        analysis_md=post.analysis_md or "",
        hand_raw_text=post.hand_raw_text,
        replay_snapshot=post.replay_snapshot if isinstance(post.replay_snapshot, dict) else None,
        raw_excerpt=post.raw_excerpt,
    )


def list_posts(
    db: Session,
    *,
    status: str | None = "published",
    limit: int = 30,
    offset: int = 0,
) -> FeedPostListResponse:
    count_q = select(func.count()).select_from(FeedPost)
    q = select(FeedPost)
    if status:
        count_q = count_q.where(FeedPost.status == status)
        q = q.where(FeedPost.status == status)
    total = int(db.scalar(count_q) or 0)
    rows = list(
        db.scalars(
            q.order_by(
                func.coalesce(FeedPost.published_at, FeedPost.created_at).desc()
            )
            .offset(max(0, offset))
            .limit(max(1, min(limit, 100)))
        )
    )
    return FeedPostListResponse(items=[_post_to_list_item(r) for r in rows], total=total)


def get_post(db: Session, post_id: UUID, *, public_only: bool = False) -> FeedPostDetail:
    post = db.get(FeedPost, post_id)
    if post is None:
        raise LookupError("Пост не найден")
    if public_only and post.status != "published":
        raise LookupError("Пост не найден")
    return _post_to_detail(post)


def _posts_today_count(db: Session) -> int:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(
        db.scalar(
            select(func.count())
            .select_from(FeedPost)
            .where(FeedPost.created_at >= start)
        )
        or 0
    )


def _source_exists(db: Session, url: str | None) -> bool:
    if not url:
        return False
    return (
        db.scalar(select(FeedPost.id).where(FeedPost.source_url == url).limit(1)) is not None
    )


def _has_hh_shape(text: str) -> bool:
    t = text or ""
    return ("***" in t and "HOLE CARDS" in t.upper()) or (
        "PokerStars" in t or "GGPoker" in t or "Hand #" in t
    )


def _create_post_from_llm(
    db: Session,
    *,
    settings_row: FeedSettings,
    source_type: str,
    source_url: str | None,
    source_title: str | None,
    source_channel: str | None,
    raw_excerpt: str | None,
    llm: feed_llm.LlmFeedResult,
    created_by: UUID | None,
    publish: bool,
) -> FeedPost:
    has_replay = bool(llm.hand_raw_text and _has_hh_shape(llm.hand_raw_text))
    status = "published" if publish else "draft"
    now = datetime.now(timezone.utc)
    post = FeedPost(
        status=status,
        source_type=source_type,
        source_url=source_url,
        source_title=source_title,
        source_channel=source_channel,
        title=llm.title,
        raw_excerpt=(raw_excerpt or "")[:12000] or None,
        hand_raw_text=llm.hand_raw_text or None,
        replay_snapshot=None,
        analysis_md=llm.analysis_md,
        hero_hand=llm.hero_hand,
        stakes_label=llm.stakes_label,
        tags=llm.tags,
        has_replay=has_replay,
        created_by=created_by,
        published_at=now if status == "published" else None,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


def ingest(
    db: Session,
    payload: FeedIngestRequest,
    user: User,
) -> FeedPostDetail:
    settings_row = get_or_create_settings(db)
    yt = (payload.youtube_url or "").strip()
    hh = (payload.raw_hh or "").strip()
    if not yt and not hh:
        raise ValueError("Укажите youtube_url или raw_hh")

    if yt:
        vid = feed_youtube.extract_video_id(yt)
        if not vid:
            raise ValueError("Некорректная ссылка YouTube")
        video = feed_youtube.fetch_video(vid)
        if _source_exists(db, video.url):
            raise ValueError("Это видео уже есть в ленте")
        if settings_row.min_views and video.view_count < settings_row.min_views:
            raise ValueError(f"Мало просмотров ({video.view_count} < {settings_row.min_views})")
        llm = feed_llm.analyze_source(
            model_name=settings_row.model_name,
            source_title=video.title,
            source_channel=video.channel,
            source_url=video.url,
            description=video.description,
            transcript=video.transcript,
            raw_hh=hh,
        )
        excerpt = (video.transcript or video.description or "")[:12000]
        post = _create_post_from_llm(
            db,
            settings_row=settings_row,
            source_type="youtube",
            source_url=video.url,
            source_title=video.title,
            source_channel=video.channel,
            raw_excerpt=excerpt,
            llm=llm,
            created_by=user.id,
            publish=bool(payload.publish),
        )
        return _post_to_detail(post)

    llm = feed_llm.analyze_source(
        model_name=settings_row.model_name,
        source_title="Hand history",
        raw_hh=hh,
    )
    post = _create_post_from_llm(
        db,
        settings_row=settings_row,
        source_type="hh",
        source_url=None,
        source_title=None,
        source_channel=None,
        raw_excerpt=hh[:12000],
        llm=llm,
        created_by=user.id,
        publish=bool(payload.publish),
    )
    return _post_to_detail(post)


def set_status(db: Session, post_id: UUID, status: str) -> FeedPostDetail:
    if status not in {"draft", "published", "rejected"}:
        raise ValueError("Некорректный статус")
    post = db.get(FeedPost, post_id)
    if post is None:
        raise LookupError("Пост не найден")
    post.status = status
    if status == "published":
        post.published_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(post)
    return _post_to_detail(post)


def run_auto_cycle(db: Session) -> tuple[int, int, str]:
    settings_row = get_or_create_settings(db)
    if not settings_row.auto_enabled:
        return 0, 0, "Автопоиск выключен в настройках"

    remaining = max(0, int(settings_row.max_posts_per_day) - _posts_today_count(db))
    if remaining <= 0:
        return 0, 0, "Дневной лимит постов исчерпан"

    queries = settings_row.search_queries if isinstance(settings_row.search_queries, list) else []
    queries = [str(q).strip() for q in queries if str(q).strip()] or list(DEFAULT_QUERIES)

    created = 0
    skipped = 0
    per_query = max(1, min(3, remaining))

    for q in queries:
        if created >= remaining:
            break
        try:
            ids = feed_youtube.search_videos(q, max_results=per_query)
        except Exception:
            skipped += 1
            continue
        for vid in ids:
            if created >= remaining:
                break
            try:
                video = feed_youtube.fetch_video(vid)
            except Exception:
                skipped += 1
                continue
            if _source_exists(db, video.url):
                skipped += 1
                continue
            if settings_row.min_views and video.view_count < settings_row.min_views:
                skipped += 1
                continue
            try:
                llm = feed_llm.analyze_source(
                    model_name=settings_row.model_name,
                    source_title=video.title,
                    source_channel=video.channel,
                    source_url=video.url,
                    description=video.description,
                    transcript=video.transcript,
                )
            except Exception:
                skipped += 1
                continue
            excerpt = (video.transcript or video.description or "")[:12000]
            _create_post_from_llm(
                db,
                settings_row=settings_row,
                source_type="youtube",
                source_url=video.url,
                source_title=video.title,
                source_channel=video.channel,
                raw_excerpt=excerpt,
                llm=llm,
                created_by=None,
                publish=bool(settings_row.auto_publish),
            )
            created += 1

    msg = f"Создано {created}, пропущено {skipped}"
    return created, skipped, msg
