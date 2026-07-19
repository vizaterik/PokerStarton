"""Incremental HUD aggregation: UPSERT cases/opportunities after each parsed session."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, PlaySession
from app.models.player_stats import HudAggregationCredit, PlayerStatsAggregated
from app.schemas.hud import (
    AggregatedHudReport,
    AggregatedHudStat,
    AggregatedPositionHud,
)
from app.services.hud_stats import _analyze_hand, _pct


@dataclass
class _Delta:
    hands_count: int = 0
    vpip_cases: int = 0
    vpip_opportunities: int = 0
    pfr_cases: int = 0
    pfr_opportunities: int = 0
    three_bet_cases: int = 0
    three_bet_opportunities: int = 0

    def add_flags(self, *, vpip: bool, vpip_opp: bool, pfr: bool, pfr_opp: bool,
                  three_bet: bool, three_bet_opp: bool) -> None:
        self.hands_count += 1
        if vpip_opp:
            self.vpip_opportunities += 1
            if vpip:
                self.vpip_cases += 1
        if pfr_opp:
            self.pfr_opportunities += 1
            if pfr:
                self.pfr_cases += 1
        if three_bet_opp:
            self.three_bet_opportunities += 1
            if three_bet:
                self.three_bet_cases += 1


def infer_game_type(session: PlaySession, sample_raw: str = "") -> str:
    """Cash vs MTT from session label / filename / HH snippet."""
    blob = " ".join(
        [
            session.label or "",
            session.source_filename or "",
            session.room or "",
            sample_raw[:2000],
        ]
    ).lower()
    mtt_markers = (
        "tournament",
        "mtt",
        "turbo",
        "satellite",
        "freezeout",
        "progressive knockout",
        "bounty",
        " spin",
        "spo ",
        "ticket",
    )
    if any(m in blob for m in mtt_markers):
        return "mtt"
    return "cash"


def _upsert_delta(
    db: Session,
    *,
    user_id: UUID,
    database_id: UUID | None,
    game_type: str,
    position: str,
    delta: _Delta,
) -> None:
    if delta.hands_count <= 0 and delta.vpip_opportunities <= 0:
        return
    row = db.scalar(
        select(PlayerStatsAggregated).where(
            PlayerStatsAggregated.user_id == user_id,
            PlayerStatsAggregated.database_id == database_id,
            PlayerStatsAggregated.game_type == game_type,
            PlayerStatsAggregated.position == position,
        )
    )
    if row is None:
        db.add(
            PlayerStatsAggregated(
                user_id=user_id,
                database_id=database_id,
                game_type=game_type,
                position=position,
                hands_count=delta.hands_count,
                vpip_cases=delta.vpip_cases,
                vpip_opportunities=delta.vpip_opportunities,
                pfr_cases=delta.pfr_cases,
                pfr_opportunities=delta.pfr_opportunities,
                three_bet_cases=delta.three_bet_cases,
                three_bet_opportunities=delta.three_bet_opportunities,
            )
        )
        return
    # Increment — never overwrite existing totals.
    row.hands_count += delta.hands_count
    row.vpip_cases += delta.vpip_cases
    row.vpip_opportunities += delta.vpip_opportunities
    row.pfr_cases += delta.pfr_cases
    row.pfr_opportunities += delta.pfr_opportunities
    row.three_bet_cases += delta.three_bet_cases
    row.three_bet_opportunities += delta.three_bet_opportunities


def apply_session_to_aggregates(db: Session, session: PlaySession) -> bool:
    """After parsing a session: add VPIP/PFR/3BET cases & opps into aggregates.

    Idempotent via hud_aggregation_credits — safe to call on re-process.
    Returns True if this session contributed new deltas.
    """
    existing = db.get(HudAggregationCredit, session.id)
    if existing is not None:
        return False

    hands = list(
        db.scalars(
            select(Hand)
            .where(Hand.session_id == session.id)
            .options(selectinload(Hand.actions))
        )
    )
    if not hands:
        db.add(HudAggregationCredit(session_id=session.id, user_id=session.user_id))
        db.flush()
        return False

    game_type = infer_game_type(session, hands[0].raw_text or "")
    by_pos: dict[str, _Delta] = defaultdict(_Delta)
    overall = _Delta()

    for hand in hands:
        flags = _analyze_hand(hand)
        pos = (hand.hero_position or "UNK").upper() or "UNK"
        for bucket in (by_pos[pos], overall):
            bucket.add_flags(
                vpip=flags.vpip,
                vpip_opp=flags.vpip_opp,
                pfr=flags.pfr,
                pfr_opp=flags.pfr_opp,
                three_bet=flags.three_bet,
                three_bet_opp=flags.three_bet_opp,
            )

    for position, delta in by_pos.items():
        _upsert_delta(
            db,
            user_id=session.user_id,
            database_id=session.database_id,
            game_type=game_type,
            position=position,
            delta=delta,
        )
    _upsert_delta(
        db,
        user_id=session.user_id,
        database_id=session.database_id,
        game_type=game_type,
        position="ALL",
        delta=overall,
    )

    db.add(HudAggregationCredit(session_id=session.id, user_id=session.user_id))
    db.flush()
    return True


def backfill_database_aggregates(db: Session, user_id: UUID, database_id: UUID) -> int:
    """Apply any sessions in the DB that were never credited (one-time warm)."""
    sessions = list(
        db.scalars(
            select(PlaySession).where(
                PlaySession.user_id == user_id,
                PlaySession.database_id == database_id,
            )
        )
    )
    n = 0
    for session in sessions:
        if apply_session_to_aggregates(db, session):
            n += 1
    return n


def _stat(key: str, label: str, cases: int, opportunities: int) -> AggregatedHudStat:
    return AggregatedHudStat(
        key=key,
        label=label,
        value=_pct(cases, opportunities),
        cases=cases,
        opportunities=opportunities,
        unit="pct",
    )


def build_aggregated_hud_report(
    db: Session,
    user_id: UUID,
    *,
    database_id: UUID | None,
    game_type: str | None = None,
) -> AggregatedHudReport:
    """Instant HUD: read rolled-up cases/opportunities, compute %."""
    if database_id is not None:
        backfill_database_aggregates(db, user_id, database_id)

    q = select(PlayerStatsAggregated).where(PlayerStatsAggregated.user_id == user_id)
    if database_id is not None:
        q = q.where(PlayerStatsAggregated.database_id == database_id)
    if game_type and game_type != "all":
        q = q.where(PlayerStatsAggregated.game_type == game_type)

    rows = list(db.scalars(q))
    # Merge cash+mtt when game_type filter is all / omitted
    merged: dict[str, _Delta] = defaultdict(_Delta)
    for row in rows:
        d = merged[row.position]
        d.hands_count += row.hands_count
        d.vpip_cases += row.vpip_cases
        d.vpip_opportunities += row.vpip_opportunities
        d.pfr_cases += row.pfr_cases
        d.pfr_opportunities += row.pfr_opportunities
        d.three_bet_cases += row.three_bet_cases
        d.three_bet_opportunities += row.three_bet_opportunities

    overall = merged.get("ALL") or _Delta()
    stats = [
        _stat("vpip", "VPIP", overall.vpip_cases, overall.vpip_opportunities),
        _stat("pfr", "PFR", overall.pfr_cases, overall.pfr_opportunities),
        _stat("three_bet", "3-Bet", overall.three_bet_cases, overall.three_bet_opportunities),
    ]

    by_position: list[AggregatedPositionHud] = []
    for position, d in sorted(merged.items(), key=lambda x: x[0]):
        if position == "ALL":
            continue
        by_position.append(
            AggregatedPositionHud(
                position=position,
                hands=d.hands_count,
                vpip=_pct(d.vpip_cases, d.vpip_opportunities),
                vpip_cases=d.vpip_cases,
                vpip_opportunities=d.vpip_opportunities,
                pfr=_pct(d.pfr_cases, d.pfr_opportunities),
                pfr_cases=d.pfr_cases,
                pfr_opportunities=d.pfr_opportunities,
                three_bet=_pct(d.three_bet_cases, d.three_bet_opportunities),
                three_bet_cases=d.three_bet_cases,
                three_bet_opportunities=d.three_bet_opportunities,
            )
        )

    return AggregatedHudReport(
        database_id=str(database_id) if database_id else None,
        game_type=game_type or "all",
        hands=overall.hands_count,
        stats=stats,
        by_position=by_position,
        source="player_stats_aggregated",
    )
