"""Export hands from the active profile hand database for client Analysis."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.hand_limits import count_database_hands
from app.services.hud_stats import load_strategy_hands


class ExportedHandAction(BaseModel):
    street: str
    action_order: int
    player_name: str
    is_hero: bool = False
    action: str
    amount: float | None = None


class ExportedHand(BaseModel):
    external_hand_id: str
    played_at: datetime | None = None
    table_name: str | None = None
    small_blind: float | None = None
    big_blind: float | None = None
    hero_name: str | None = None
    hero_position: str | None = None
    hero_hand: str | None = None
    hero_hand_code: str | None = None
    detected_spot: str | None = None
    villain_position: str | None = None
    stack_bb: float | None = None
    hero_preflop_action: str | None = None
    hero_net: float | None = None
    hero_net_bb: float | None = None
    went_to_showdown: bool = False
    hero_net_wsd: float | None = None
    hero_net_wsd_bb: float | None = None
    hero_net_wwsd: float | None = None
    hero_net_wwsd_bb: float | None = None
    raw_text: str = ""
    actions: list[ExportedHandAction] = Field(default_factory=list)


class ActiveDatabaseHandsPage(BaseModel):
    database_id: UUID
    total: int
    offset: int
    limit: int
    hands: list[ExportedHand]


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def export_active_database_hands(
    db: Session,
    user: User,
    *,
    offset: int = 0,
    limit: int = 500,
    strategy_id: UUID | None = None,
) -> ActiveDatabaseHandsPage:
    from app.services import databases as db_svc

    active = db_svc.get_active_database(db, user)
    total = count_database_hands(db, active.id)
    # strategy_id unused for filtering — same hands for every strategy.
    sid = strategy_id or active.id
    hands = load_strategy_hands(db, user.id, sid)
    start = max(0, offset)
    end = start + max(1, min(limit, 1000))
    page = hands[start:end]

    out: list[ExportedHand] = []
    for h in page:
        actions = [
            ExportedHandAction(
                street=a.street,
                action_order=int(a.action_order or 0),
                player_name=a.player_name,
                is_hero=bool(a.is_hero),
                action=a.action,
                amount=_f(a.amount),
            )
            for a in (h.actions or [])
        ]
        out.append(
            ExportedHand(
                external_hand_id=h.external_hand_id,
                played_at=h.played_at,
                table_name=h.table_name,
                small_blind=_f(h.small_blind),
                big_blind=_f(h.big_blind),
                hero_name=h.hero_name,
                hero_position=h.hero_position,
                hero_hand=h.hero_hand,
                hero_hand_code=h.hero_hand_code,
                detected_spot=h.detected_spot,
                villain_position=h.villain_position,
                stack_bb=_f(h.stack_bb),
                hero_preflop_action=None,
                hero_net=_f(h.hero_net),
                hero_net_bb=_f(h.hero_net_bb),
                went_to_showdown=bool(h.went_to_showdown),
                hero_net_wsd=_f(h.hero_net_wsd),
                hero_net_wsd_bb=_f(h.hero_net_wsd_bb),
                hero_net_wwsd=_f(h.hero_net_wwsd),
                hero_net_wwsd_bb=_f(h.hero_net_wwsd_bb),
                raw_text=h.raw_text or "",
                actions=actions,
            )
        )

    return ActiveDatabaseHandsPage(
        database_id=active.id,
        total=total,
        offset=start,
        limit=end - start,
        hands=out,
    )
