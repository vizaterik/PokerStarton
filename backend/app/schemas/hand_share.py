from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ShareStreet = Literal["preflop", "flop", "turn", "river"]


class HandShareRead(BaseModel):
    token: str = Field(..., min_length=8, max_length=64)
    path: str


class HandShareCommentCreate(BaseModel):
    street: ShareStreet
    body: str = Field(..., min_length=1, max_length=1000)


class HandShareCommentRead(BaseModel):
    id: UUID
    street: ShareStreet
    body: str
    author_name: str
    is_mine: bool = False
    created_at: datetime | None = None


class HandShareSocialRead(BaseModel):
    likes_count: int
    liked_by_me: bool
    comments: list[HandShareCommentRead]
    my_comments_by_street: dict[str, str] = Field(default_factory=dict)


class HandShareLikeRead(BaseModel):
    likes_count: int
    liked_by_me: bool


class ShareReplayAction(BaseModel):
    street: str
    action_order: int
    player_name: str
    is_hero: bool = False
    action: str
    amount: float | None = None


class ShareHandFromTextRequest(BaseModel):
    """Create a public share from a replay snapshot (local or server).

    Prefer sending actions from the client so the server does not need to
    re-parse PokerStars/GG text.
    """

    raw_text: str = Field(..., min_length=1)
    external_hand_id: str | None = Field(default=None, max_length=64)
    played_at: datetime | None = None
    table_name: str | None = None
    small_blind: float | None = None
    big_blind: float | None = None
    hero_name: str | None = None
    hero_position: str | None = None
    hero_hand: str | None = None
    hero_net: float | None = None
    hero_net_bb: float | None = None
    # Board cards like ["Ah","Kd","2c"] — used if raw_text is a stub without FLOP lines.
    board: list[str] = Field(default_factory=list)
    actions: list[ShareReplayAction] = Field(default_factory=list)
