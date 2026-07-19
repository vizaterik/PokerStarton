from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.bankroll import (
    BankrollEntryRead,
    BankrollOverview,
    BankrollProfileUpdate,
    BankrollSettingsRead,
    BankrollTxn,
    RiskProfileRead,
)
from app.services import bankroll as bankroll_svc

router = APIRouter(prefix="/career", tags=["career"])


def _entry_read(entry) -> BankrollEntryRead:
    return BankrollEntryRead(
        id=entry.id,
        kind=entry.kind,
        amount=float(entry.amount),
        balance_after=float(entry.balance_after),
        note=entry.note,
        session_id=entry.session_id,
        created_at=entry.created_at,
    )


def _overview(db: Session, user_id) -> BankrollOverview:
    settings = bankroll_svc.get_or_create_settings(db, user_id)
    entries = bankroll_svc.list_entries(db, user_id)
    mode = getattr(settings, "game_mode", None) or "cash"
    return BankrollOverview(
        settings=BankrollSettingsRead(**bankroll_svc.settings_payload(settings)),
        profiles=[RiskProfileRead(**p) for p in bankroll_svc.profiles_payload(mode)],
        entries=[_entry_read(e) for e in entries],
    )


@router.get("/bankroll", response_model=BankrollOverview)
def get_bankroll(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankrollOverview:
    return _overview(db, current_user.id)


@router.patch("/bankroll/profile", response_model=BankrollSettingsRead)
def update_bankroll_profile(
    payload: BankrollProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankrollSettingsRead:
    if (
        payload.risk_profile is None
        and payload.game_mode is None
        and payload.currency is None
        and payload.goal_stake is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите стратегию БРМ, режим или цель",
        )
    try:
        clear_goal = payload.goal_stake == ""
        settings = bankroll_svc.update_career_prefs(
            db,
            current_user.id,
            risk_profile=payload.risk_profile,
            game_mode=payload.game_mode,
            currency=payload.currency,
            goal_stake=None if clear_goal else payload.goal_stake,
            clear_goal=clear_goal,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return BankrollSettingsRead(**bankroll_svc.settings_payload(settings))


@router.post("/bankroll/txn", response_model=BankrollOverview, status_code=status.HTTP_201_CREATED)
def bankroll_transaction(
    payload: BankrollTxn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BankrollOverview:
    if payload.kind != "set":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Доступна только ручная установка банкролла",
        )
    try:
        amount = Decimal(str(payload.amount))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректная сумма") from exc

    try:
        bankroll_svc.set_balance(
            db,
            current_user.id,
            amount=amount,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return _overview(db, current_user.id)
