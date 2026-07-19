from __future__ import annotations

from pydantic import BaseModel, Field


class AggregatedHudStat(BaseModel):
    key: str
    label: str
    value: float | None = None
    cases: int = 0
    opportunities: int = 0
    unit: str = "pct"


class AggregatedPositionHud(BaseModel):
    position: str
    hands: int = 0
    vpip: float | None = None
    vpip_cases: int = 0
    vpip_opportunities: int = 0
    pfr: float | None = None
    pfr_cases: int = 0
    pfr_opportunities: int = 0
    three_bet: float | None = None
    three_bet_cases: int = 0
    three_bet_opportunities: int = 0


class AggregatedHudReport(BaseModel):
    """Instant HUD from player_stats_aggregated (no per-hand scan)."""

    database_id: str | None = None
    game_type: str = "all"
    hands: int = 0
    stats: list[AggregatedHudStat] = Field(default_factory=list)
    by_position: list[AggregatedPositionHud] = Field(default_factory=list)
    source: str = "player_stats_aggregated"
