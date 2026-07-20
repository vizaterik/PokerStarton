from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.feed import TopLikedFeedResponse
from app.services import feed_top as feed_top_svc

router = APIRouter(tags=["feed"])


@router.get("/feed/top", response_model=TopLikedFeedResponse)
def list_top_liked_hands(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
) -> TopLikedFeedResponse:
    """Public feed: top shared hands by likes."""
    return feed_top_svc.list_top_liked_shares(db, limit=limit)
