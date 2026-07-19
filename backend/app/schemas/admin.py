from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PageViewCreate(BaseModel):
    path: str = Field(min_length=1, max_length=512)
    visitor_id: str = Field(min_length=8, max_length=64)
    referrer: str | None = Field(default=None, max_length=512)


class PageViewCreated(BaseModel):
    ok: bool = True
    skipped: bool = False


class TrafficWindow(BaseModel):
    pageviews: int = 0
    unique_visitors: int = 0
    unique_users: int = 0
    registrations: int = 0


class TopPathRow(BaseModel):
    path: str
    count: int


class RecentVisitRow(BaseModel):
    created_at: datetime
    path: str
    visitor_id: str
    user_id: UUID | None = None
    display_name: str | None = None


class AdminTotals(BaseModel):
    users: int = 0
    strategies: int = 0
    hand_uploads: int = 0
    hands: int = 0


class AdminOverview(BaseModel):
    today: TrafficWindow
    days_7: TrafficWindow
    days_30: TrafficWindow
    top_paths: list[TopPathRow]
    recent: list[RecentVisitRow]
    totals: AdminTotals
