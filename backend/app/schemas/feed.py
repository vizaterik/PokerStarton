from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

FeedStatus = Literal["draft", "published", "rejected"]
FeedSourceType = Literal["youtube", "hh", "manual"]


class FeedSettingsRead(BaseModel):
    auto_enabled: bool
    auto_publish: bool
    search_queries: list[str] = Field(default_factory=list)
    max_posts_per_day: int = 5
    min_views: int = 0
    model_name: str = "gpt-4o-mini"


class FeedSettingsUpdate(BaseModel):
    auto_enabled: bool | None = None
    auto_publish: bool | None = None
    search_queries: list[str] | None = None
    max_posts_per_day: int | None = Field(default=None, ge=1, le=50)
    min_views: int | None = Field(default=None, ge=0)
    model_name: str | None = Field(default=None, max_length=64)


class FeedIngestRequest(BaseModel):
    youtube_url: str | None = Field(default=None, max_length=512)
    raw_hh: str | None = Field(default=None, max_length=50000)
    publish: bool = False


class FeedPostListItem(BaseModel):
    id: UUID
    status: FeedStatus
    source_type: FeedSourceType
    source_url: str | None = None
    source_title: str | None = None
    source_channel: str | None = None
    title: str
    analysis_preview: str
    hero_hand: str | None = None
    stakes_label: str | None = None
    tags: list[str] = Field(default_factory=list)
    has_replay: bool = False
    created_at: datetime | None = None
    published_at: datetime | None = None


class FeedPostDetail(FeedPostListItem):
    analysis_md: str
    hand_raw_text: str | None = None
    replay_snapshot: dict[str, Any] | None = None
    raw_excerpt: str | None = None


class FeedPostListResponse(BaseModel):
    items: list[FeedPostListItem]
    total: int


class FeedRunAutoResponse(BaseModel):
    created: int
    skipped: int
    message: str
