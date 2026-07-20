from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand_share import HandShare
    from app.models.user import User


class HandShareComment(Base):
    """One comment per registered user per street on a shared hand."""

    __tablename__ = "hand_share_comments"
    __table_args__ = (
        UniqueConstraint("share_id", "user_id", "street", name="uq_share_comment_user_street"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hand_shares.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    street: Mapped[str] = mapped_column(String(16), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    share: Mapped[HandShare] = relationship()
    user: Mapped[User] = relationship()


class HandShareLike(Base):
    """One like per registered user on a shared hand."""

    __tablename__ = "hand_share_likes"
    __table_args__ = (UniqueConstraint("share_id", "user_id", name="uq_share_like_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("hand_shares.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    share: Mapped[HandShare] = relationship()
    user: Mapped[User] = relationship()


class HandShareCommentLike(Base):
    """One like per registered user on a share comment."""

    __tablename__ = "hand_share_comment_likes"
    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", name="uq_share_comment_like_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("hand_share_comments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    comment: Mapped[HandShareComment] = relationship()
    user: Mapped[User] = relationship()
