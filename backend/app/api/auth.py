import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    safe_decode_token,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    DeleteAccountRequest,
    DeleteAccountResponse,
    GoogleLoginRequest,
    LoginRequest,
    NicknameRequest,
    RefreshRequest,
    RegisterResponse,
    ResendCodeRequest,
    TokenResponse,
    UserCreate,
    UserRead,
    VerifyEmailRequest,
)
from app.services.account_delete import (
    ARCHIVE_EMAIL,
    delete_user_account,
    is_archive_user,
)
from app.services.admin_access import is_admin_user
from app.services.email import send_verification_email, smtp_configured
from app.services.google_auth import GoogleTokenError, verify_google_id_token
from app.services.subscription_plans import DEFAULT_PLAN_ID

router = APIRouter(prefix="/auth", tags=["auth"])

CODE_TTL_MINUTES = 15


def _user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        email_verified=user.email_verified,
        plan_id=user.plan_id,
        plan_started_at=user.plan_started_at,
        created_at=user.created_at,
        is_admin=is_admin_user(user),
    )

def _tokens_for(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        needs_nickname=not bool(user.display_name and user.display_name.strip()),
    )


def _issue_verification_code(user: User) -> str:
    code = f"{secrets.randbelow(1_000_000):06d}"
    user.verification_code_hash = hash_password(code)
    user.verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES)
    return code


def _unique_referral_code(db: Session) -> str:
    for _ in range(12):
        code = secrets.token_hex(3).upper()  # 6 chars
        if db.scalar(select(User.id).where(User.referral_code == code)) is None:
            return code
    return secrets.token_hex(4).upper()


def _resolve_referrer(db: Session, raw: str | None) -> User | None:
    if not raw:
        return None
    code = raw.strip().upper()
    if not code:
        return None
    referrer = db.scalar(select(User).where(User.referral_code == code))
    if referrer is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный реферальный код")
    return referrer


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> RegisterResponse:
    if payload.password != payload.password_confirm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароли не совпадают")
    if not payload.accepted_terms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Необходимо принять Пользовательское соглашение",
        )

    email = payload.email.lower()
    if email == ARCHIVE_EMAIL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Этот email недоступен")
    existing = db.scalar(select(User).where(User.email == email))
    if existing and existing.email_verified:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот email уже зарегистрирован")

    referrer = _resolve_referrer(db, payload.referral_code)
    now = datetime.now(timezone.utc)

    if existing:
        existing.password_hash = hash_password(payload.password)
        user = existing
        if referrer is not None and user.referred_by_id is None and referrer.id != user.id:
            user.referred_by_id = referrer.id
        if not user.referral_code:
            user.referral_code = _unique_referral_code(db)
        user.accepted_terms = True
        user.accepted_terms_at = now
    else:
        user = User(
            email=email,
            password_hash=hash_password(payload.password),
            email_verified=False,
            referral_code=_unique_referral_code(db),
            referred_by_id=referrer.id if referrer is not None else None,
            plan_id=DEFAULT_PLAN_ID,
            plan_started_at=now,
            hands_analyzed_month=0,
            hands_quota_month=now.strftime("%Y-%m"),
            accepted_terms=True,
            accepted_terms_at=now,
        )
        db.add(user)

    code = _issue_verification_code(user)
    db.commit()

    try:
        send_verification_email(email, code)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось отправить письмо. Попробуйте позже.",
        ) from exc

    return RegisterResponse(
        email=email,
        message="Мы отправили код подтверждения на почту",
        needs_verification=True,
        dev_code=None if smtp_configured() else code,
    )


@router.post("/verify-email", response_model=TokenResponse)
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not user.verification_code_hash or not user.verification_expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Сначала зарегистрируйтесь")

    expires = user.verification_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Код истёк — запросите новый")

    if not verify_password(payload.code.strip(), user.verification_code_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неверный код подтверждения")

    user.email_verified = True
    user.verification_code_hash = None
    user.verification_expires_at = None
    db.commit()
    db.refresh(user)
    return _tokens_for(user)


@router.post("/resend-code", response_model=RegisterResponse)
def resend_code(payload: ResendCodeRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Аккаунт не найден")
    if user.email_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email уже подтверждён")

    code = _issue_verification_code(user)
    db.commit()
    try:
        send_verification_email(user.email, code)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не удалось отправить письмо. Попробуйте позже.",
        ) from exc

    return RegisterResponse(
        email=user.email,
        message="Код отправлен повторно",
        needs_verification=True,
        dev_code=None if smtp_configured() else code,
    )


@router.post("/login", response_model=TokenResponse)
def login_json(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or is_archive_user(user) or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email или пароль")
    if not user.email_verified and user.google_sub is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Подтвердите email кодом из письма",
        )
    return _tokens_for(user)


@router.post("/google", response_model=TokenResponse)
def login_google(payload: GoogleLoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        info = verify_google_id_token(payload.id_token)
    except GoogleTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = db.scalar(select(User).where(User.google_sub == info["sub"]))
    if user is None:
        user = db.scalar(select(User).where(User.email == info["email"]))
        if user is None:
            user = User(
                email=info["email"],
                password_hash=hash_password(secrets.token_urlsafe(32)),
                google_sub=info["sub"],
                display_name=None,
                avatar_url=info["picture"] or None,
                email_verified=True,
                plan_id=DEFAULT_PLAN_ID,
                plan_started_at=datetime.now(timezone.utc),
                hands_analyzed_month=0,
                hands_quota_month=datetime.now(timezone.utc).strftime("%Y-%m"),
            )
            db.add(user)
        else:
            user.google_sub = info["sub"]
            user.email_verified = True
            if info["picture"]:
                user.avatar_url = info["picture"]
    else:
        if info["picture"]:
            user.avatar_url = info["picture"]

    db.commit()
    db.refresh(user)
    return _tokens_for(user)


@router.get("/google/config")
def google_config() -> dict[str, str | bool]:
    return {
        "enabled": bool(settings.google_client_id),
        "client_id": settings.google_client_id,
    }


@router.patch("/nickname", response_model=UserRead)
def set_nickname(
    payload: NicknameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    if current_user.display_name and current_user.display_name.strip():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ник нельзя изменить после установки",
        )

    nickname = payload.display_name.strip()
    if len(nickname) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ник слишком короткий")

    taken = db.scalar(
        select(User).where(User.display_name == nickname, User.id != current_user.id)
    )
    if taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот ник уже занят")

    current_user.display_name = nickname
    db.commit()
    db.refresh(current_user)
    return _user_read(current_user)


@router.post("/token", response_model=TokenResponse, include_in_schema=False)
def login_form(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenResponse:
    """OAuth2 password form for Swagger Authorize."""
    user = db.scalar(select(User).where(User.email == form_data.username.lower()))
    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный email или пароль")
    if not user.email_verified and user.google_sub is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Подтвердите email")
    return _tokens_for(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    from uuid import UUID

    data = safe_decode_token(payload.refresh_token)
    if data is None or data.get("type") != "refresh" or not data.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    try:
        user_id = UUID(str(data["sub"]))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc
    user = db.get(User, user_id)
    if user is None or is_archive_user(user):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    return _tokens_for(user)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return _user_read(current_user)

@router.delete("/account", response_model=DeleteAccountResponse)
def delete_account(
    payload: DeleteAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeleteAccountResponse:
    """Delete the account. Strategies/bankroll wiped; hand histories kept in system archive."""
    if payload.confirmation.strip().upper() != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Введите DELETE для подтверждения",
        )
    if is_archive_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недоступно")

    try:
        stats = delete_user_account(db, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return DeleteAccountResponse(
        message="Аккаунт удалён.",
        uploads_archived=stats["uploads_archived"],
        sessions_archived=stats["sessions_archived"],
    )
