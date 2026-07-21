"""Schemas for syncing client-parsed hands into the profile hand database."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SyncedAction(BaseModel):
    street: str
    action_order: int
    player_name: str
    is_hero: bool = False
    action: str
    amount: float | None = None


class SyncedHand(BaseModel):
    external_hand_id: str = Field(min_length=1, max_length=64)
    raw_text: str = Field(min_length=1)
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
    actions: list[SyncedAction] = Field(default_factory=list)


class ClientHandsSyncRequest(BaseModel):
    strategy_id: UUID | None = None
    label: str | None = None
    source_filename: str = "local-import.txt"
    room: str = "pokerstars"
    hands: list[SyncedHand] = Field(min_length=1)
    """When set, append hands to an existing active session (chunked sync)."""
    session_id: UUID | None = None
    """Apply HUD aggregates + bankroll after this chunk (last chunk = True)."""
    finalize: bool = True


class ClientHandsSyncResponse(BaseModel):
    session_id: UUID
    upload_id: UUID
    database_id: UUID
    hands_saved: int
    duplicates_skipped: int
    label: str
