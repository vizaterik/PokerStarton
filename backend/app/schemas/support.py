from pydantic import BaseModel, EmailStr, Field


SUPPORT_TOPICS = (
    "Баг в парсере раздач",
    "Вопрос по чартам/стратегиям",
    "Проблема с лимитами",
    "Другое",
)


class SupportTicketCreate(BaseModel):
    site_nick: str = Field(min_length=1, max_length=64)
    email: EmailStr
    topic: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=3, max_length=8000)


class SupportTicketResponse(BaseModel):
    ok: bool = True
    message: str = "Запрос принят"
