from datetime import datetime

from pydantic import BaseModel, Field


class TopHandItem(BaseModel):
    token: str
    path: str
    likes_count: int = 0
    comments_count: int = 0
    views_count: int = 0
    author_display_name: str
    author_path: str
    hero_cards: list[str] = Field(default_factory=list)
    pot_tag: str | None = None
    matchup: str | None = None


class TopHandsResponse(BaseModel):
    items: list[TopHandItem] = Field(default_factory=list)
    total: int = 0


class PublicProfileRead(BaseModel):
    display_name: str
    registered_at: datetime | None = None
    rating: int = 1000
    likes_received: int = 0
