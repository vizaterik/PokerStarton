from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User

JsonType = JSON().with_variant(JSONB(), "postgresql")


class FeedSettings(Base):
    """Singleton-ish feed configuration (one row, id=1)."""

    __tablename__ = "feed_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    auto_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_publish: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    search_queries: Mapped[list[Any]] = mapped_column(JsonType, nullable=False, default=list)
    max_posts_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    min_views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_name: Mapped[str] = mapped_column(String(64), nullable=False, default="gpt-4o-mini")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FeedPost(Base):
    __tablename__ = "feed_posts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    source_url: Mapped[str | None] = mapped_column(String(512), nullable=True, index=True)
    source_title: Mapped[str | None] = mapped_column(String(400), nullable=True)
    source_channel: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(400), nullable=False, default="Разбор раздачи")
    raw_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    hand_raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    replay_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    analysis_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    hero_hand: Mapped[str | None] = mapped_column(String(8), nullable=True)
    stakes_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tags: Mapped[list[Any]] = mapped_column(JsonType, nullable=False, default=list)
    has_replay: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    creator: Mapped[User | None] = relationship()
