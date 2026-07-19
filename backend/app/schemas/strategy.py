from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrategyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_default: bool = False
    format: str = "cash"
    table_size: str = "6-max"
    stack_depth: str = "100bb"
    mtt_stage: str | None = None
    action_mode: str | None = None


class StrategyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    is_default: bool | None = None
    format: str | None = None
    table_size: str | None = None
    stack_depth: str | None = None
    mtt_stage: str | None = None
    action_mode: str | None = None


class GameTreePayload(BaseModel):
    """Serialized GTO constructor document (versioned client JSON)."""

    tree: dict


class GameTreeRead(BaseModel):
    tree: dict | None = None


class StrategyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    description: str | None
    is_default: bool
    format: str = "cash"
    table_size: str = "6-max"
    stack_depth: str = "100bb"
    mtt_stage: str | None = None
    action_mode: str = "standard"
    created_at: datetime
    updated_at: datetime


class SpotCreate(BaseModel):
    spot_key: str = Field(min_length=1, max_length=64)
    hero_position: str = Field(min_length=1, max_length=16)
    villain_position: str | None = Field(default=None, max_length=16)
    stack_bb_min: Decimal | None = None
    stack_bb_max: Decimal | None = None
    label: str | None = Field(default=None, max_length=200)
    sort_order: int = 0


class SpotUpdate(BaseModel):
    spot_key: str | None = Field(default=None, min_length=1, max_length=64)
    hero_position: str | None = Field(default=None, min_length=1, max_length=16)
    villain_position: str | None = Field(default=None, max_length=16)
    stack_bb_min: Decimal | None = None
    stack_bb_max: Decimal | None = None
    label: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None


class SpotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    strategy_id: UUID
    spot_key: str
    hero_position: str
    villain_position: str | None
    stack_bb_min: Decimal | None
    stack_bb_max: Decimal | None
    label: str | None
    sort_order: int


class CellUpsert(BaseModel):
    hand_code: str = Field(min_length=2, max_length=3)
    raise_freq: Decimal = Field(ge=0, le=1)
    call_freq: Decimal = Field(ge=0, le=1)
    fold_freq: Decimal = Field(ge=0, le=1)

    @model_validator(mode="after")
    def freqs_sum_to_one(self) -> CellUpsert:
        total = self.raise_freq + self.call_freq + self.fold_freq
        if abs(total - Decimal("1")) > Decimal("0.0001"):
            raise ValueError("raise_freq + call_freq + fold_freq must equal 1.0")
        return self


class CellBatchUpsert(BaseModel):
    cells: list[CellUpsert]


class CellRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    spot_id: UUID
    hand_code: str
    raise_freq: Decimal
    call_freq: Decimal
    fold_freq: Decimal
