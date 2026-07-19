"""Discover / optionally create strategy spots for HH branches missing in DB."""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.strategy import StrategySpot
from app.schemas.analysis import EnsuredSpotInfo, EnsureSpotsResponse, MissingSpotsResponse
from app.services.hud_stats import load_strategy_hands
from app.services.results import resolve_hand_result
from app.services.trainer import invalidate_trainer_cache

from app.services.spot_labels import format_branch_label

_KNOWN_SPOTS = frozenset({"rfi", "vs_open", "vs_3bet", "vs_4bet", "squeeze", "iso"})

# Normalize HH seats → chart seats used by presets / tree sync
_CHART_POS = {
    "UTG": "UTG",
    "UTG+1": "MP",
    "UTG1": "MP",
    "UTG+2": "MP",
    "UTG2": "MP",
    "MP": "MP",
    "MP1": "MP",
    "HJ": "MP",
    "CO": "CO",
    "BTN": "BTN",
    "SB": "SB",
    "BB": "BB",
}


def _norm_pos(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().upper()
    return _CHART_POS.get(key, key)


def _chart_pos(raw: str | None) -> str | None:
    return _norm_pos(raw)


def _spot_label(spot_key: str, hero: str, villain: str | None) -> str:
    return format_branch_label(spot_key, hero, villain)


def _is_covered(
    existing: set[tuple[str, str, str | None]],
    spot_key: str,
    hero: str,
    villain: str | None,
) -> bool:
    """Exact matchup, or generic hero chart for the same action.

    vs_3bet BB (no villain) covers vs_3bet BBvsCO.
    vs_3bet BBvsSB does NOT cover vs_3bet SBvsBB (roles swapped).
    """
    hero_n = _norm_pos(hero) or hero.upper()
    vill_n = _norm_pos(villain) if villain else None
    if (spot_key, hero_n, vill_n) in existing:
        return True
    if vill_n is not None and (spot_key, hero_n, None) in existing:
        return True
    return False


def _needed_key(
    spot_key: str, hero: str, villain: str | None
) -> tuple[str, str, str | None]:
    if spot_key in {"rfi", "iso"}:
        return (spot_key, hero, None)
    if villain and villain != hero:
        return (spot_key, hero, villain)
    return (spot_key, hero, None)


def _collect_needed(
    db: Session, user_id: UUID, strategy_id: UUID
) -> tuple[
    dict[tuple[str, str, str | None], dict[str, float | int]],
    set[tuple[str, str, str | None]],
]:
    """Return (needed_key → stats, existing spot keys)."""
    hands = load_strategy_hands(db, user_id, strategy_id)
    needed: dict[tuple[str, str, str | None], dict[str, float | int]] = defaultdict(
        lambda: {"hands": 0, "profit_money": 0.0, "profit_bb": 0.0}
    )

    for hand in hands:
        spot_key = (hand.detected_spot or "").strip().lower()
        if spot_key not in _KNOWN_SPOTS:
            continue
        hero = _chart_pos(hand.hero_position)
        if not hero:
            continue
        villain = _chart_pos(hand.villain_position)
        key = _needed_key(spot_key, hero, villain)
        net, net_bb = resolve_hand_result(hand)
        row = needed[key]
        row["hands"] = int(row["hands"]) + 1
        row["profit_money"] = float(row["profit_money"]) + float(net)
        row["profit_bb"] = float(row["profit_bb"]) + float(net_bb)

    existing = {
        (
            s.spot_key.strip().lower(),
            (_norm_pos(s.hero_position) or s.hero_position.upper()),
            _norm_pos(s.villain_position) if s.villain_position else None,
        )
        for s in db.scalars(
            select(StrategySpot).where(StrategySpot.strategy_id == strategy_id)
        )
    }
    return needed, existing


def list_missing_spots(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
) -> MissingSpotsResponse:
    """Branches seen in hands but not present as strategy spots (read-only)."""
    needed, existing = _collect_needed(db, user_id, strategy_id)
    missing: list[EnsuredSpotInfo] = []
    for spot_key, hero, villain in sorted(needed, key=lambda t: (t[0], t[1], t[2] or "")):
        if _is_covered(existing, spot_key, hero, villain):
            continue
        stats = needed[(spot_key, hero, villain)]
        missing.append(
            EnsuredSpotInfo(
                spot_key=spot_key,
                hero_position=hero,
                villain_position=villain,
                label=_spot_label(spot_key, hero, villain),
                hands_count=int(stats["hands"]),
                profit_money=round(float(stats["profit_money"]), 4),
                profit_bb=round(float(stats["profit_bb"]), 4),
            )
        )
    missing.sort(key=lambda s: (s.profit_money, -(s.hands_count or 0)))
    return MissingSpotsResponse(
        strategy_id=str(strategy_id),
        missing_count=len(missing),
        missing=missing,
    )


def ensure_spots_from_hands(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
) -> EnsureSpotsResponse:
    """Insert missing StrategySpot rows for distinct hand branches (explicit opt-in)."""
    needed, existing = _collect_needed(db, user_id, strategy_id)

    max_order = db.scalar(
        select(func.coalesce(func.max(StrategySpot.sort_order), -1)).where(
            StrategySpot.strategy_id == strategy_id
        )
    )
    sort_order = int(max_order or -1) + 1

    created: list[EnsuredSpotInfo] = []
    for spot_key, hero, villain in sorted(needed, key=lambda t: (t[0], t[1], t[2] or "")):
        key = (spot_key, hero, villain)
        if _is_covered(existing, spot_key, hero, villain):
            continue
        stats = needed[key]
        spot = StrategySpot(
            strategy_id=strategy_id,
            spot_key=spot_key,
            hero_position=hero,
            villain_position=villain,
            label=_spot_label(spot_key, hero, villain),
            sort_order=sort_order,
        )
        sort_order += 1
        db.add(spot)
        existing.add(key)
        created.append(
            EnsuredSpotInfo(
                spot_key=spot_key,
                hero_position=hero,
                villain_position=villain,
                label=spot.label or "",
                hands_count=int(stats["hands"]),
                profit_money=round(float(stats["profit_money"]), 4),
                profit_bb=round(float(stats["profit_bb"]), 4),
            )
        )

    if created:
        db.commit()
        invalidate_trainer_cache(strategy_id=strategy_id)

    return EnsureSpotsResponse(
        strategy_id=str(strategy_id),
        created_count=len(created),
        created=created,
    )
