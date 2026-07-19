from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HandUploadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    strategy_id: UUID | None
    session_id: UUID | None = None
    room: str
    original_filename: str
    status: str
    hands_count: int
    error_message: str | None
    uploaded_at: datetime
    processed_at: datetime | None


class HandActionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    street: str
    action_order: int
    player_name: str
    is_hero: bool
    action: str
    amount: Decimal | None


class HandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    upload_id: UUID
    session_id: UUID | None = None
    external_hand_id: str
    played_at: datetime | None
    table_name: str | None
    small_blind: Decimal | None
    big_blind: Decimal | None
    hero_name: str | None
    hero_position: str | None
    hero_hand: str | None
    hero_hand_code: str | None
    detected_spot: str | None
    villain_position: str | None
    stack_bb: Decimal | None
    hero_net: Decimal | None = None
    hero_net_bb: Decimal | None = None


class DeviationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    hand_id: UUID
    strategy_id: UUID
    spot_id: UUID | None
    hand_code: str
    actual_action: str
    expected_action: str
    actual_freq: Decimal | None
    expected_freq: Decimal | None
    severity: Decimal | None
    created_at: datetime


class UploadReport(BaseModel):
    upload_id: UUID
    session_id: UUID | None = None
    session_label: str | None = None
    status: str
    hands_count: int
    duplicates_skipped: int = 0
    hands_with_decision: int
    deviations_count: int
    correct_count: int
    error_message: str | None = None
    strategy_id: UUID | None = None
    original_filename: str
    room: str | None = None
    restored: bool = False


class PlaySessionRead(BaseModel):
    id: UUID
    user_id: UUID
    strategy_id: UUID | None
    upload_id: UUID | None = None
    room: str
    label: str
    source_filename: str
    table_name: str | None
    small_blind: Decimal | None
    big_blind: Decimal | None
    max_seats: int | None
    started_at: datetime | None
    ended_at: datetime | None
    hands_count: int
    hands_with_decision: int = 0
    deviations_count: int = 0
    correct_count: int = 0
    created_at: datetime
    status: str = "active"
    upload_status: str = "parsed"


class BatchUploadReport(BaseModel):
    uploads: list[UploadReport]
    sessions: list[PlaySessionRead]
    files_count: int
    total_hands: int
    total_duplicates_skipped: int = 0
    total_deviations: int
    total_correct: int


class CurvePoint(BaseModel):
    hand_index: int
    cum_bb: float
    cum_money: float
    cum_wwsd_bb: float = 0.0
    cum_wsd_bb: float = 0.0
    cum_wwsd_money: float = 0.0
    cum_wsd_money: float = 0.0
    hand_bb: float
    hand_money: float
    played_at: str | None = None
    session_id: str | None = None


class SessionProfitRow(BaseModel):
    id: UUID
    label: str
    room: str
    source_filename: str
    started_at: datetime | None
    hands_count: int
    profit_money: float
    profit_bb: float
    winrate_bb100: float
    """How many table uploads were merged into this play sitting (Rush multi-table)."""
    tables_count: int = 1


class BranchProfitRow(BaseModel):
    """Postflop pot branch: pot tag + matchup (who vs whom)."""

    spot_key: str
    hero_position: str
    villain_position: str | None = None
    pot_kind: str = "srp"
    pot_tag: str = "Raise"
    matchup: str = ""
    label: str
    hands_count: int
    profit_money: float
    profit_bb: float
    winrate_bb100: float


class ResultsReport(BaseModel):
    total_hands: int
    total_profit_money: float
    total_profit_bb: float
    winrate_bb100: float
    wins: int
    losses: int
    scratches: int
    sessions_count: int
    has_any_data: bool = False
    date_from: str | None = None
    date_to: str | None = None
    curve: list[CurvePoint]
    sessions: list[SessionProfitRow]
    top_losing_branches: list[BranchProfitRow] = Field(default_factory=list)
    top_profitable_branches: list[BranchProfitRow] = Field(default_factory=list)
