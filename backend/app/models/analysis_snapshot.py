"""Stored PC analysis report (HUD / deviations / math) for a play session."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, JSON, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand import PlaySession
    from app.models.hand_database import HandDatabase
    from app.models.strategy import Strategy
    from app.models.user import User


class AnalysisSnapshot(Base):
    __tablename__ = "analysis_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("hand_databases.id", ondelete="CASCADE"), nullable=True, index=True
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("play_sessions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # Full analysis report from the PC (analysis, deviations, optional math).
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship()
    hand_database: Mapped[HandDatabase | None] = relationship()
    strategy: Mapped[Strategy | None] = relationship()
    session: Mapped[PlaySession] = relationship()
