from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.bankroll import BankrollEntry, BankrollSettings
    from app.models.hand import Deviation, HandUpload, PlaySession
    from app.models.hand_database import HandDatabase
    from app.models.strategy import Strategy


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    referral_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    referred_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_code_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False, default="starter")
    plan_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hands_analyzed_month: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hands_quota_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    accepted_terms: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    accepted_terms_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active_database_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    strategies: Mapped[list[Strategy]] = relationship(back_populates="user", cascade="all, delete-orphan")
    hand_uploads: Mapped[list[HandUpload]] = relationship(back_populates="user", cascade="all, delete-orphan")
    play_sessions: Mapped[list[PlaySession]] = relationship(back_populates="user", cascade="all, delete-orphan")
    deviations: Mapped[list[Deviation]] = relationship(back_populates="user", cascade="all, delete-orphan")
    hand_databases: Mapped[list[HandDatabase]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="HandDatabase.user_id",
    )
    bankroll_settings: Mapped[BankrollSettings | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    bankroll_entries: Mapped[list[BankrollEntry]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="BankrollEntry.created_at.desc()"
    )
