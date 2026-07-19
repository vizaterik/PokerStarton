"""Fast HUD reports from pre-aggregated cases/opportunities."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.hud import AggregatedHudReport
from app.services import databases as db_svc
from app.services import hud_aggregate as hud_agg

router = APIRouter(prefix="/hud", tags=["hud"])


@router.get("/aggregated", response_model=AggregatedHudReport)
def get_aggregated_hud(
    game_type: str | None = Query(
        default=None,
        description="cash | mtt | omit for all",
    ),
    database_id: UUID | None = Query(
        default=None,
        description="Hand database; default = active profile DB",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AggregatedHudReport:
    """Instant HUD: VPIP / PFR / 3-Bet from player_stats_aggregated.

    No per-hand scan — percentages are cases/opportunities*100 from rolled-up rows.
    """
    active_id = database_id or db_svc.get_active_database_id(db, current_user)
    gt = (game_type or "").strip().lower() or None
    if gt in {"", "all", "*"}:
        gt = None
    report = hud_agg.build_aggregated_hud_report(
        db,
        current_user.id,
        database_id=active_id,
        game_type=gt,
    )
    db.commit()
    return report
