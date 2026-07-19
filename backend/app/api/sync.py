"""Sync client-parsed hands into the profile hand database (no server HH parse)."""

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.client_sync import ClientHandsSyncRequest, ClientHandsSyncResponse
from app.services.client_sync import sync_client_hands

router = APIRouter(prefix="/sync", tags=["sync"])


def _sync_sync(
    *,
    user_id: UUID,
    payload: ClientHandsSyncRequest,
) -> ClientHandsSyncResponse:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError("User not found")
        return sync_client_hands(db, user, payload)
    finally:
        db.close()


@router.post("/hands", response_model=ClientHandsSyncResponse)
async def sync_hands(
    payload: ClientHandsSyncRequest,
    current_user: User = Depends(get_current_user),
) -> ClientHandsSyncResponse:
    """Accept pre-parsed hands from the PC and store them in the active hand DB."""
    user_id = current_user.id
    try:
        return await asyncio.to_thread(_sync_sync, user_id=user_id, payload=payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка загрузки в базу: {exc}",
        ) from exc
