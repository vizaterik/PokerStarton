"""Incremental HUD aggregates (cases / opportunities) for instant reports."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlayerStatsAggregated(Base):
    """Running HUD totals per user / hand-DB / game type / position.

    value% = cases / opportunities * 100 (computed at read time).
    """

    __tablename__ = "player_stats_aggregated"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "database_id",
            "game_type",
            "position",
            name="uq_player_stats_agg_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("hand_databases.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # cash | mtt
    game_type: Mapped[str] = mapped_column(String(16), nullable=False, default="cash")
    # BTN, SB, BB, … or ALL for overall
    position: Mapped[str] = mapped_column(String(16), nullable=False, default="ALL")

    hands_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    vpip_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    vpip_opportunities: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pfr_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pfr_opportunities: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    three_bet_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    three_bet_opportunities: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class HudAggregationCredit(Base):
    """Sessions already merged into player_stats_aggregated (idempotent apply)."""

    __tablename__ = "hud_aggregation_credits"

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("play_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
