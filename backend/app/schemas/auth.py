from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)
    referral_code: str | None = Field(default=None, max_length=32)
    accepted_terms: bool = False


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    display_name: str | None
    avatar_url: str | None = None
    email_verified: bool = False
    plan_id: str = "starter"
    plan_started_at: datetime | None = None
    created_at: datetime
    is_admin: bool = False


class RegisterResponse(BaseModel):
    email: EmailStr
    message: str
    needs_verification: bool = True
    # Only returned when SMTP is not configured (local/dev).
    dev_code: str | None = None


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class ResendCodeRequest(BaseModel):
    email: EmailStr


class NicknameRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=32)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    needs_nickname: bool = False


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20)


class RefreshRequest(BaseModel):
    refresh_token: str


class DeleteAccountRequest(BaseModel):
    """Require typing DELETE to confirm irreversible account removal."""

    confirmation: str = Field(min_length=1, max_length=32)


class DeleteAccountResponse(BaseModel):
    message: str
    uploads_archived: int = 0
    sessions_archived: int = 0
