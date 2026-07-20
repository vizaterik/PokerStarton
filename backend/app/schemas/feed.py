from datetime import datetime

from pydantic import BaseModel, Field


class TopLikedFeedItem(BaseModel):
    token: str
    path: str
    likes_count: int
    hero_hand: str | None = None
    hero_position: str | None = None
    author_name: str | None = None
    played_at: datetime | None = None
    stakes_label: str | None = None
    hero_net: float | None = None


class TopLikedFeedResponse(BaseModel):
    items: list[TopLikedFeedItem] = Field(default_factory=list)
    total: int = 0
