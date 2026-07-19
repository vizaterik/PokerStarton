from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.hand import Deviation, HandUpload, PlaySession
    from app.models.user import User


class Strategy(Base):
    __tablename__ = "strategies"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_strategies_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Format module: cash | mtt | spins
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="cash")
    table_size: Mapped[str] = mapped_column(String(16), nullable=False, default="6-max")
    stack_depth: Mapped[str] = mapped_column(String(16), nullable=False, default="100bb")
    mtt_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # standard | push_fold
    action_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="standard")
    # Full GTO constructor tree (branches + painted ranges). Not included in list responses.
    game_tree: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="strategies")
    spots: Mapped[list[StrategySpot]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan", order_by="StrategySpot.sort_order"
    )
    hand_uploads: Mapped[list[HandUpload]] = relationship(back_populates="strategy")
    play_sessions: Mapped[list[PlaySession]] = relationship(back_populates="strategy")
    deviations: Mapped[list[Deviation]] = relationship(
        back_populates="strategy", cascade="all, delete-orphan"
    )


class StrategySpot(Base):
    __tablename__ = "strategy_spots"
    __table_args__ = (
        UniqueConstraint(
            "strategy_id",
            "spot_key",
            "hero_position",
            "villain_position",
            name="uq_strategy_spots_key",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    strategy_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    spot_key: Mapped[str] = mapped_column(String(64), nullable=False)
    hero_position: Mapped[str] = mapped_column(String(16), nullable=False)
    villain_position: Mapped[str | None] = mapped_column(String(16), nullable=True)
    stack_bb_min: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    stack_bb_max: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    strategy: Mapped[Strategy] = relationship(back_populates="spots")
    cells: Mapped[list[StrategyCell]] = relationship(back_populates="spot", cascade="all, delete-orphan")
    deviations: Mapped[list[Deviation]] = relationship(
        back_populates="spot", passive_deletes=True
    )


class StrategyCell(Base):
    __tablename__ = "strategy_cells"
    __table_args__ = (UniqueConstraint("spot_id", "hand_code", name="uq_strategy_cells_spot_hand"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    spot_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("strategy_spots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hand_code: Mapped[str] = mapped_column(String(3), nullable=False)
    raise_freq: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))
    call_freq: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))
    fold_freq: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("1"))

    spot: Mapped[StrategySpot] = relationship(back_populates="cells")
