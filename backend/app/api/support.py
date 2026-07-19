from fastapi import APIRouter, HTTPException, status

from app.schemas.support import SUPPORT_TOPICS, SupportTicketCreate, SupportTicketResponse
from app.services.support_inbox import save_ticket

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_support_ticket(payload: SupportTicketCreate) -> SupportTicketResponse:
    if payload.topic not in SUPPORT_TOPICS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректная тема обращения")
    save_ticket(
        poker_nick=payload.site_nick,
        email=str(payload.email),
        topic=payload.topic,
        message=payload.message,
    )
    return SupportTicketResponse(
        ok=True,
        message="Спасибо! Ваш запрос зарегистрирован. Наш специалист свяжется с вами по Email в течение 15 минут",
    )
