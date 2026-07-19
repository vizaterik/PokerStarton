from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand import HandUpload, PlaySession
    from app.models.user import User


class HandDatabase(Base):
    """H2N-style hand database: stores sessions / uploads / hands for one workspace."""

    __tablename__ = "hand_databases"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_hand_databases_user_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Precomputed career ResultsReport (curve + KPIs). Rebuilt on analysis upload.
    career_report: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    career_report_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="hand_databases")
    play_sessions: Mapped[list[PlaySession]] = relationship(back_populates="hand_database")
    hand_uploads: Mapped[list[HandUpload]] = relationship(back_populates="hand_database")
