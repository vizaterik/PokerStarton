from pydantic import BaseModel, Field


class HandShareRead(BaseModel):
    token: str = Field(..., min_length=8, max_length=64)
    path: str


class ShareHandFromTextRequest(BaseModel):
    """Create a public share from raw HH text (local / unsynced hands)."""

    raw_text: str = Field(..., min_length=40)
    external_hand_id: str | None = Field(default=None, max_length=64)
