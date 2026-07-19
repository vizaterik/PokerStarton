from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class HandDatabaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_at: datetime | None = None
    is_active: bool = False
    sessions_count: int = 0
    hands_count: int = 0
    hands_limit: int = 100_000
    uploads_count: int = 0


class HandDatabaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    switch: bool = True


class HandDatabaseRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class HandDatabaseClearResult(BaseModel):
    database_id: UUID
    uploads_deleted: int
    sessions_deleted: int
    files_removed: int
    deleted: bool = False
    reset: bool = False
    active_database_id: UUID | None = None
