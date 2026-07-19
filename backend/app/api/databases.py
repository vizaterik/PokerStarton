from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.databases import (
    HandDatabaseClearResult,
    HandDatabaseCreate,
    HandDatabaseRead,
    HandDatabaseRename,
)
from app.services import compute_cache
from app.services import databases as db_svc

router = APIRouter(prefix="/databases", tags=["databases"])


@router.get("", response_model=list[HandDatabaseRead])
def list_databases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[HandDatabaseRead]:
    rows = db_svc.list_databases(db, current_user)
    db.commit()
    return [HandDatabaseRead(**row) for row in rows]


@router.post("", response_model=HandDatabaseRead, status_code=status.HTTP_201_CREATED)
def create_database(
    payload: HandDatabaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandDatabaseRead:
    try:
        row = db_svc.create_database(
            db, current_user, payload.name, switch=payload.switch
        )
        db.commit()
        if payload.switch:
            compute_cache.invalidate_user(current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    items = {d["id"]: d for d in db_svc.list_databases(db, current_user)}
    return HandDatabaseRead(**items[row.id])


@router.post("/{database_id}/switch", response_model=HandDatabaseRead)
def switch_database(
    database_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandDatabaseRead:
    try:
        row = db_svc.switch_database(db, current_user, database_id)
        db.commit()
        compute_cache.invalidate_user(current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    items = {d["id"]: d for d in db_svc.list_databases(db, current_user)}
    return HandDatabaseRead(**items[row.id])


@router.patch("/{database_id}", response_model=HandDatabaseRead)
def rename_database(
    database_id: UUID,
    payload: HandDatabaseRename,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandDatabaseRead:
    try:
        row = db_svc.rename_database(db, current_user, database_id, payload.name)
        db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    items = {d["id"]: d for d in db_svc.list_databases(db, current_user)}
    return HandDatabaseRead(**items[row.id])


@router.post("/{database_id}/clear", response_model=HandDatabaseClearResult)
def clear_database(
    database_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandDatabaseClearResult:
    try:
        result = db_svc.clear_database(db, current_user, database_id)
        db.commit()
        compute_cache.invalidate_user(current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return HandDatabaseClearResult(**result)


@router.delete("/{database_id}", response_model=HandDatabaseClearResult)
def delete_database(
    database_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandDatabaseClearResult:
    try:
        result = db_svc.delete_database(db, current_user, database_id)
        db.commit()
        compute_cache.invalidate_user(current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Не удалось удалить базу: {exc}",
        ) from exc
    return HandDatabaseClearResult(**result)
