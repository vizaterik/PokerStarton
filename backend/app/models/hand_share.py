from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand import Hand
    from app.models.user import User


class HandShare(Base):
    """Public, unguessable link to view a single hand replay."""

    __tablename__ = "hand_shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    hand_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hands.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hand: Mapped[Hand] = relationship()
    creator: Mapped[User] = relationship()
