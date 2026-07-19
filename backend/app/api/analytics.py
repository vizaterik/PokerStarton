from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import get_admin_user, get_current_user_optional
from app.db.session import get_db
from app.models.user import User
from app.schemas.admin import AdminOverview, PageViewCreate, PageViewCreated
from app.services import analytics as analytics_svc

router = APIRouter(tags=["analytics"])


@router.post("/analytics/pageview", response_model=PageViewCreated)
def track_pageview(
    payload: PageViewCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> PageViewCreated:
    ua = request.headers.get("user-agent")
    stored = analytics_svc.record_pageview(
        db,
        path=payload.path,
        visitor_id=payload.visitor_id,
        user_id=user.id if user else None,
        referrer=payload.referrer,
        user_agent=ua,
    )
    return PageViewCreated(ok=True, skipped=not stored)


@router.get("/admin/overview", response_model=AdminOverview)
def admin_overview(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> AdminOverview:
    return AdminOverview(**analytics_svc.build_admin_overview(db))
