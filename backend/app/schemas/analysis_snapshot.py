"""Schemas for uploading a PC-built analysis report + compact hands."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class CompactAction(BaseModel):
    street: str
    action_order: int
    player_name: str
    is_hero: bool = False
    action: str
    amount: float | None = None


class CompactHand(BaseModel):
    external_hand_id: str = Field(min_length=1, max_length=64)
    played_at: datetime | None = None
    table_name: str | None = None
    small_blind: float | None = None
    big_blind: float | None = None
    hero_name: str | None = None
    hero_position: str | None = None
    hero_hand: str | None = None
    hero_hand_code: str | None = None
    detected_spot: str | None = None
    villain_position: str | None = None
    stack_bb: float | None = None
    hero_preflop_action: str | None = None
    hero_net: float | None = None
    hero_net_bb: float | None = None
    went_to_showdown: bool = False
    hero_net_wsd: float | None = None
    hero_net_wsd_bb: float | None = None
    hero_net_wwsd: float | None = None
    hero_net_wwsd_bb: float | None = None
    # Preflop actions through hero decision — needed for Trainer replay/grade.
    actions: list[CompactAction] = Field(default_factory=list)
    # Optional HH for richer replay (kept short on the client when possible).
    raw_text: str = ""


class AnalysisSnapshotUpload(BaseModel):
    # Optional — hands go into the active profile DB regardless of strategy charts.
    strategy_id: UUID | None = None
    label: str | None = None
    source_filename: str = "local-import.txt"
    room: str = "pokerstars"
    started_at: datetime | None = None
    ended_at: datetime | None = None
    report: dict[str, Any] = Field(
        default_factory=dict,
        description="PC analysis report: analysis, deviations, math?, fingerprint, handTotal",
    )
    hands: list[CompactHand] = Field(default_factory=list)
    # Chunked upload: omit on first packet; pass back on subsequent packets.
    session_id: UUID | None = None
    # Last packet builds career report / marks upload analyzed.
    finalize: bool = True


class AnalysisSnapshotResponse(BaseModel):
    session_id: UUID
    snapshot_id: UUID | None = None
    database_id: UUID
    hands_saved: int
    hands_total: int = 0
    finalize: bool = True
    label: str
    # Ready career ResultsReport — Report tab reads this, no rebuild.
    career_report: dict[str, Any] | None = None


class AnalysisSnapshotRead(BaseModel):
    snapshot_id: UUID
    session_id: UUID
    strategy_id: UUID | None
    database_id: UUID | None
    hands_count: int
    label: str
    source_filename: str
    created_at: datetime | None
    report: dict[str, Any]
