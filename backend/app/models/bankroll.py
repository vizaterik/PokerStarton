from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class BankrollSettings(Base):
    __tablename__ = "bankroll_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    risk_profile: Mapped[str] = mapped_column(String(32), nullable=False, default="standard")
    buyins_target: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    # Режим игры для расчёта БРМ: cash | mtt | spins
    game_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="cash")
    # Цель по лимиту (метка лестницы, напр. NL100 / MTT $55). Null = авто (следующий).
    goal_stake: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="bankroll_settings")


class BankrollEntry(Base):
    __tablename__ = "bankroll_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # set|deposit|withdraw|adjust|session
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Links a session profit line; unique so the same PlaySession is never applied twice.
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("play_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="bankroll_entries")
