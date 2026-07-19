from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand_database import HandDatabase
    from app.models.strategy import Strategy, StrategySpot
    from app.models.user import User


class PlaySession(Base):
    """One poker session derived from an HH file (table / stakes / date)."""

    __tablename__ = "play_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("hand_databases.id", ondelete="CASCADE"), nullable=True, index=True
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True
    )
    room: Mapped[str] = mapped_column(String(64), nullable=False, default="pokerstars")
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    source_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    table_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    small_blind: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    big_blind: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    max_seats: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hands_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # One active batch per user; previous uploads stay archived in DB.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="play_sessions")
    hand_database: Mapped[HandDatabase | None] = relationship(back_populates="play_sessions")
    strategy: Mapped[Strategy | None] = relationship(back_populates="play_sessions")
    uploads: Mapped[list[HandUpload]] = relationship(back_populates="session")
    hands: Mapped[list[Hand]] = relationship(back_populates="session")


class HandUpload(Base):
    __tablename__ = "hand_uploads"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("hand_databases.id", ondelete="CASCADE"), nullable=True, index=True
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("play_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    room: Mapped[str] = mapped_column(String(64), nullable=False, default="pokerstars")
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    hands_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="hand_uploads")
    hand_database: Mapped[HandDatabase | None] = relationship(back_populates="hand_uploads")
    strategy: Mapped[Strategy | None] = relationship(back_populates="hand_uploads")
    session: Mapped[PlaySession | None] = relationship(back_populates="uploads")
    hands: Mapped[list[Hand]] = relationship(back_populates="upload", cascade="all, delete-orphan")


class Hand(Base):
    __tablename__ = "hands"
    __table_args__ = (UniqueConstraint("upload_id", "external_hand_id", name="uq_hands_upload_external"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    upload_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hand_uploads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("play_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    external_hand_id: Mapped[str] = mapped_column(String(64), nullable=False)
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    table_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    small_blind: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    big_blind: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    hero_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hero_position: Mapped[str | None] = mapped_column(String(16), nullable=True)
    hero_hand: Mapped[str | None] = mapped_column(String(4), nullable=True)
    hero_hand_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    detected_spot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    villain_position: Mapped[str | None] = mapped_column(String(16), nullable=True)
    stack_bb: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    hero_net: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    hero_net_bb: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    went_to_showdown: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hero_net_wsd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    hero_net_wsd_bb: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    hero_net_wwsd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    hero_net_wwsd_bb: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)

    upload: Mapped[HandUpload] = relationship(back_populates="hands")
    session: Mapped[PlaySession | None] = relationship(back_populates="hands")
    actions: Mapped[list[HandAction]] = relationship(
        back_populates="hand", cascade="all, delete-orphan", order_by="HandAction.action_order"
    )
    deviations: Mapped[list[Deviation]] = relationship(back_populates="hand", cascade="all, delete-orphan")


class HandAction(Base):
    __tablename__ = "hand_actions"
    __table_args__ = (
        UniqueConstraint("hand_id", "street", "action_order", name="uq_hand_actions_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hand_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hands.id", ondelete="CASCADE"), nullable=False
    )
    street: Mapped[str] = mapped_column(String(16), nullable=False)
    action_order: Mapped[int] = mapped_column(Integer, nullable=False)
    player_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_hero: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    hand: Mapped[Hand] = relationship(back_populates="actions")


class Deviation(Base):
    __tablename__ = "deviations"
    __table_args__ = (UniqueConstraint("hand_id", "strategy_id", name="uq_deviations_hand_strategy"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hand_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hands.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    spot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("strategy_spots.id", ondelete="SET NULL"), nullable=True
    )
    hand_code: Mapped[str] = mapped_column(String(3), nullable=False)
    actual_action: Mapped[str] = mapped_column(String(16), nullable=False)
    expected_action: Mapped[str] = mapped_column(String(16), nullable=False)
    actual_freq: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    expected_freq: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    severity: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hand: Mapped[Hand] = relationship(back_populates="deviations")
    user: Mapped[User] = relationship(back_populates="deviations")
    strategy: Mapped[Strategy] = relationship(back_populates="deviations")
    spot: Mapped[StrategySpot | None] = relationship(back_populates="deviations")
