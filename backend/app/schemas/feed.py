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


class PublicProfileHand(BaseModel):
    token: str
    path: str
    likes_count: int = 0
    comments_count: int = 0
    hero_hand: str | None = None
    hero_position: str | None = None
    played_at: datetime | None = None


class PublicProfileRead(BaseModel):
    display_name: str
    registered_at: datetime | None = None
    rating: int = 1000
    likes_received: int = 0
    comments_count: int = 0
    unique_views: int = 0
    shares_count: int = 0
    top_hands: list[PublicProfileHand] = Field(default_factory=list)


class ProfileCommentItem(BaseModel):
    id: str
    body: str
    street: str
    author_name: str
    created_at: datetime | None = None
    hand_token: str
    hand_path: str
    hero_hand: str | None = None


class ProfileCommentsResponse(BaseModel):
    items: list[ProfileCommentItem] = Field(default_factory=list)
    total: int = 0
