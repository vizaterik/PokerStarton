from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.feed import PublicProfileRead, TopAuthorsResponse
from app.services import feed_top as feed_top_svc

router = APIRouter(tags=["feed"])


@router.get("/feed/top", response_model=TopAuthorsResponse)
def list_top_authors(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
) -> TopAuthorsResponse:
    """Public hits: top authors by likes on shared hands."""
    return feed_top_svc.list_top_authors(db, limit=limit)


@router.get("/public/users/{display_name}", response_model=PublicProfileRead)
def get_public_user_profile(
    display_name: str,
    db: Session = Depends(get_db),
) -> PublicProfileRead:
    try:
        return feed_top_svc.get_public_profile(db, display_name)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
