from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StakeRecommendation(BaseModel):
    label: str
    big_blind: float
    buyin_100bb: float
    role: str  # soft | primary | stretch
    note: str
    shortfall: bool | None = None


class LimitVerdict(BaseModel):
    status: str
    headline: str
    detail: str
    affordable_buyin: float = 0
    required_buyins: int = 0
    stop_loss_buyins: int | None = None
    recommended_label: str | None = None
    previous_label: str | None = None
    next_label: str | None = None


class RiskProfileRead(BaseModel):
    id: str
    name: str
    description: str
    buyins_range: str
    buyins_target: int
    session_tip: str
    stop_loss_buyins: int | None = None


class BankrollSettingsRead(BaseModel):
    balance: float
    currency: str
    game_mode: str = "cash"
    risk_profile: str
    risk_profile_name: str
    risk_description: str = ""
    buyins_range: str = ""
    buyins_target: int
    recommended_buyin: float
    recommended_stakes: list[StakeRecommendation] = []
    primary_stake: str | None = None
    session_tip: str = ""
    stop_loss_buyins: int | None = None
    limit_verdict: LimitVerdict | None = None
    goal_stake: str | None = None
    updated_at: datetime | None = None


class BankrollEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    amount: float
    balance_after: float
    note: str | None
    session_id: UUID | None = None
    created_at: datetime


class BankrollOverview(BaseModel):
    settings: BankrollSettingsRead
    profiles: list[RiskProfileRead]
    entries: list[BankrollEntryRead]


class BankrollProfileUpdate(BaseModel):
    risk_profile: str | None = None
    game_mode: str | None = None
    buyins_target: int | None = None
    currency: str | None = Field(default=None, max_length=8)
    # None = не трогать; "" = сбросить цель
    goal_stake: str | None = Field(default=None, max_length=32)


class BankrollTxn(BaseModel):
    kind: str = "set"
    amount: float
    note: str | None = None
