from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_admin_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.feed import (
    FeedIngestRequest,
    FeedPostDetail,
    FeedPostListResponse,
    FeedRunAutoResponse,
    FeedSettingsRead,
    FeedSettingsUpdate,
)
from app.services import feed_pipeline as feed_svc

router = APIRouter(tags=["feed"])


@router.get("/feed/posts", response_model=FeedPostListResponse)
def list_public_feed_posts(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> FeedPostListResponse:
    return feed_svc.list_posts(db, status="published", limit=limit, offset=offset)


@router.get("/feed/posts/{post_id}", response_model=FeedPostDetail)
def get_public_feed_post(post_id: UUID, db: Session = Depends(get_db)) -> FeedPostDetail:
    try:
        return feed_svc.get_post(db, post_id, public_only=True)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/admin/feed/settings", response_model=FeedSettingsRead)
def get_feed_settings(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedSettingsRead:
    return feed_svc.settings_to_read(feed_svc.get_or_create_settings(db))


@router.put("/admin/feed/settings", response_model=FeedSettingsRead)
def put_feed_settings(
    payload: FeedSettingsUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedSettingsRead:
    return feed_svc.update_settings(db, payload)


@router.get("/admin/feed/posts", response_model=FeedPostListResponse)
def list_admin_feed_posts(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedPostListResponse:
    st = status_filter if status_filter in {None, "draft", "published", "rejected", ""} else None
    if st == "":
        st = None
    return feed_svc.list_posts(db, status=st, limit=limit, offset=offset)


@router.post("/admin/feed/ingest", response_model=FeedPostDetail)
def ingest_feed_post(
    payload: FeedIngestRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
) -> FeedPostDetail:
    try:
        return feed_svc.ingest(db, payload, admin)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/admin/feed/posts/{post_id}/publish", response_model=FeedPostDetail)
def publish_feed_post(
    post_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedPostDetail:
    try:
        return feed_svc.set_status(db, post_id, "published")
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/admin/feed/posts/{post_id}/reject", response_model=FeedPostDetail)
def reject_feed_post(
    post_id: UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedPostDetail:
    try:
        return feed_svc.set_status(db, post_id, "rejected")
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/admin/feed/run-auto", response_model=FeedRunAutoResponse)
def run_feed_auto(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
) -> FeedRunAutoResponse:
    created, skipped, message = feed_svc.run_auto_cycle(db)
    return FeedRunAutoResponse(created=created, skipped=skipped, message=message)
