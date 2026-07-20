from datetime import datetime

from pydantic import BaseModel, Field


class TopAuthorItem(BaseModel):
    display_name: str
    path: str
    likes_count: int = 0
    views_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    rating: int = 1000


class TopAuthorsResponse(BaseModel):
    items: list[TopAuthorItem] = Field(default_factory=list)
    total: int = 0


class PublicProfileHand(BaseModel):
    token: str
    path: str
    likes_count: int
    views_count: int = 0
    comments_count: int = 0
    hero_hand: str | None = None
    hero_position: str | None = None
    played_at: datetime | None = None
    stakes_label: str | None = None


class PublicProfileRead(BaseModel):
    display_name: str
    registered_at: datetime | None = None
    rating: int = 1000
    likes_received: int = 0
    views_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    top_hands: list[PublicProfileHand] = Field(default_factory=list)
