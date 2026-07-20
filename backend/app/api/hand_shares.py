from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.analysis import ReplayHand
from app.schemas.hand_share import HandShareRead, ShareHandFromTextRequest
from app.services import hand_share as hand_share_svc

router = APIRouter(tags=["hand-shares"])


@router.post("/hands/share", response_model=HandShareRead)
def create_hand_share_from_text(
    payload: ShareHandFromTextRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandShareRead:
    """Share any hand by raw HH text (works for local IndexedDB replays)."""
    try:
        return hand_share_svc.create_share_from_raw_text(
            db,
            current_user,
            raw_text=payload.raw_text,
            external_hand_id=payload.external_hand_id,
        )
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
