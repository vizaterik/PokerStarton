"""First-party analytics: pageview ingest + admin overview."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Hand, HandUpload
from app.models.page_view import PageView
from app.models.strategy import Strategy
from app.models.user import User

RATE_LIMIT_SECONDS = 5


def record_pageview(
    db: Session,
    *,
    path: str,
    visitor_id: str,
    user_id: UUID | None,
    referrer: str | None,
    user_agent: str | None,
) -> bool:
    """Insert a pageview unless rate-limited. Returns True if stored."""
    clean_path = (path or "/").strip()[:512] or "/"
    vid = (visitor_id or "").strip()[:64]
    if len(vid) < 8:
        return False

    since = datetime.now(timezone.utc) - timedelta(seconds=RATE_LIMIT_SECONDS)
    recent = db.scalar(
        select(PageView.id)
        .where(
            PageView.visitor_id == vid,
            PageView.path == clean_path,
            PageView.created_at >= since,
        )
        .limit(1)
    )
    if recent is not None:
        return False

    db.add(
        PageView(
            path=clean_path,
            visitor_id=vid,
            user_id=user_id,
            referrer=((referrer or "").strip()[:512] or None),
            user_agent=((user_agent or "").strip()[:500] or None),
        )
    )
    db.commit()
    return True


def _window_stats(db: Session, since: datetime) -> dict:
    pageviews = int(
        db.scalar(
            select(func.count()).select_from(PageView).where(PageView.created_at >= since)
        )
        or 0
    )
    unique_visitors = int(
        db.scalar(
            select(func.count(func.distinct(PageView.visitor_id))).where(
                PageView.created_at >= since
            )
        )
        or 0
    )
    unique_users = int(
        db.scalar(
            select(func.count(func.distinct(PageView.user_id))).where(
                PageView.created_at >= since,
                PageView.user_id.is_not(None),
            )
        )
        or 0
    )
    registrations = int(
        db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= since)
        )
        or 0
    )
    return {
        "pageviews": pageviews,
        "unique_visitors": unique_visitors,
        "unique_users": unique_users,
        "registrations": registrations,
    }


def build_admin_overview(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since_7 = now - timedelta(days=7)
    since_30 = now - timedelta(days=30)

    top_rows = db.execute(
        select(PageView.path, func.count().label("cnt"))
        .where(PageView.created_at >= since_30)
        .group_by(PageView.path)
        .order_by(func.count().desc())
        .limit(15)
    ).all()

    recent_rows = list(
        db.scalars(
            select(PageView).order_by(PageView.created_at.desc()).limit(40)
        )
    )
    user_ids = {r.user_id for r in recent_rows if r.user_id}
    names: dict[UUID, str] = {}
    if user_ids:
        for u in db.scalars(select(User).where(User.id.in_(user_ids))):
            if u.display_name:
                names[u.id] = u.display_name

    return {
        "today": _window_stats(db, start_today),
        "days_7": _window_stats(db, since_7),
        "days_30": _window_stats(db, since_30),
        "top_paths": [{"path": p, "count": int(c)} for p, c in top_rows],
        "recent": [
            {
                "created_at": r.created_at,
                "path": r.path,
                "visitor_id": r.visitor_id,
                "user_id": r.user_id,
                "display_name": names.get(r.user_id) if r.user_id else None,
            }
            for r in recent_rows
        ],
        "totals": {
            "users": int(db.scalar(select(func.count()).select_from(User)) or 0),
            "strategies": int(db.scalar(select(func.count()).select_from(Strategy)) or 0),
            "hand_uploads": int(
                db.scalar(select(func.count()).select_from(HandUpload)) or 0
            ),
            "hands": int(db.scalar(select(func.count()).select_from(Hand)) or 0),
        },
    }
