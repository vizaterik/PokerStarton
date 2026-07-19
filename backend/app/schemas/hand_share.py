from pydantic import BaseModel, Field


class HandShareRead(BaseModel):
    token: str = Field(..., min_length=8, max_length=64)
    path: str
