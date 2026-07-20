from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_current_user_optional
from app.db.session import get_db
from app.models.user import User
from app.schemas.analysis import ReplayHand
from app.schemas.hand_share import (
    HandShareCommentCreate,
    HandShareLikeRead,
    HandShareRead,
    HandShareSocialRead,
    ShareHandFromTextRequest,
)
from app.services import hand_share as hand_share_svc
from app.services import hand_share_social as social_svc

router = APIRouter(tags=["hand-shares"])


@router.post("/hands/share", response_model=HandShareRead)
def create_hand_share_from_text(
    payload: ShareHandFromTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandShareRead:
    """Share any hand from a replay snapshot (local IndexedDB or server)."""
    try:
        return hand_share_svc.create_share_from_replay(db, current_user, payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/hands/{hand_id}/share", response_model=HandShareRead)
def create_hand_share(
    hand_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandShareRead:
    try:
        return hand_share_svc.create_or_get_hand_share(db, current_user.id, hand_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/public/hands/{token}/replay", response_model=ReplayHand)
def get_public_hand_replay(token: str, db: Session = Depends(get_db)) -> ReplayHand:
    try:
        return hand_share_svc.get_public_hand_replay(db, token)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/public/hands/{token}/social", response_model=HandShareSocialRead)
def get_public_hand_social(
    token: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
) -> HandShareSocialRead:
    try:
        return social_svc.get_social(db, token, viewer)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/public/hands/{token}/comments", response_model=HandShareSocialRead)
def upsert_public_hand_comment(
    token: str,
    payload: HandShareCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandShareSocialRead:
    try:
        return social_svc.upsert_comment(db, token, current_user, payload)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/public/hands/{token}/like", response_model=HandShareLikeRead)
def toggle_public_hand_like(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandShareLikeRead:
    try:
        return social_svc.toggle_like(db, token, current_user)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
