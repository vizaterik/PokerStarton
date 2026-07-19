from datetime import datetime

from pydantic import BaseModel, Field


class PlanRead(BaseModel):
    id: str
    name: str
    tagline: str
    price_usd: int
    price_rub: int
    max_strategies: int | None = None
    max_hands_per_month: int | None = None
    features: list[str] = []
    highlights: list[str] = []
    is_hit: bool = False
    unlimited_strategies: bool = False
    unlimited_hands: bool = False


class UsageRead(BaseModel):
    strategies: int
    strategies_limit: int | None = None
    hands_month: int
    hands_month_limit: int | None = None
    quota_month: str


class SubscriptionRead(BaseModel):
    plan: PlanRead
    plan_started_at: datetime | None = None
    usage: UsageRead
    plans: list[PlanRead]
    features: list[str] = []


class SelectPlanRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=32)
