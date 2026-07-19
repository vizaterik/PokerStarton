"""Compare a hand's hero preflop action against current strategy cells."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.models.strategy import StrategyCell, StrategySpot
from app.services.deviation import is_deviation
from app.services.hand_codes import normalize_hand_code

_VOLUNTARY = frozenset({"raise", "call", "fold"})

# (spot_key, hero_position, villain_position|None)
SpotMapKey = tuple[str, str, str | None]

# HH labels → chart seat labels used in strategies / presets
POS_ALIASES: dict[str, tuple[str, ...]] = {
    "UTG": ("UTG",),
    "UTG+1": ("UTG1", "UTG+1", "MP"),
    "UTG1": ("UTG1", "UTG+1", "MP"),
    "UTG+2": ("UTG2", "UTG+2", "MP1", "MP"),
    "UTG2": ("UTG2", "UTG+2", "MP1", "MP"),
    "MP": ("MP", "HJ", "UTG1"),
    "MP1": ("MP1", "MP", "HJ"),
    "HJ": ("HJ", "MP"),
    "CO": ("CO",),
    "BTN": ("BTN",),
    "SB": ("SB",),
    "BB": ("BB",),
}

# Parent-chart fallbacks removed: score only exact spots that exist & are painted
# in the user's strategy (constructor). iso must not silently use rfi, etc.
_SPOT_FALLBACKS: dict[str, tuple[str, ...]] = {}


def hero_preflop_action(hand: Hand) -> str | None:
    """First hero voluntary preflop action. Checks count as fold (not call)."""
    for a in hand.actions:
        if a.street != "preflop" or not a.is_hero:
            continue
        if a.action not in _VOLUNTARY:
            continue
        # Parser stores checks as call with no amount — treat as fold for charts
        if a.action == "call" and (a.amount is None or float(a.amount) <= 0):
            return "fold"
        return a.action
    return None


def _pos_candidates(position: str | None) -> list[str]:
    if not position:
        return []
    key = position.strip().upper()
    aliases = POS_ALIASES.get(key)
    if aliases:
        return list(aliases)
    return [key]


def load_spot_maps(
    db: Session, strategy_id: UUID
) -> tuple[dict[SpotMapKey, StrategySpot], dict[tuple[UUID, str], StrategyCell]]:
    """Load all spots including villain-specific charts."""
    spots = list(
        db.scalars(select(StrategySpot).where(StrategySpot.strategy_id == strategy_id))
    )
    spot_by_key: dict[SpotMapKey, StrategySpot] = {
        (
            s.spot_key,
            s.hero_position.upper(),
            s.villain_position.upper() if s.villain_position else None,
        ): s
        for s in spots
    }
    if not spots:
        return spot_by_key, {}

    spot_ids = [s.id for s in spots]
    cells = list(db.scalars(select(StrategyCell).where(StrategyCell.spot_id.in_(spot_ids))))
    cell_by_key = {(c.spot_id, c.hand_code): c for c in cells}
    return spot_by_key, cell_by_key


def resolve_spot(
    spot_by_key: dict[SpotMapKey, StrategySpot],
    spot_key: str | None,
    hero_position: str | None,
    villain_position: str | None = None,
) -> StrategySpot | None:
    """Prefer villain-specific chart, fall back to generic (villain=None)."""
    if not spot_key or not hero_position:
        return None
    for hero in _pos_candidates(hero_position):
        if villain_position:
            for v in _pos_candidates(villain_position):
                exact = spot_by_key.get((spot_key, hero, v))
                if exact is not None:
                    return exact
        generic = spot_by_key.get((spot_key, hero, None))
        if generic is not None:
            return generic
    return None


def resolve_cell_freqs(
    spot_by_key: dict[SpotMapKey, StrategySpot],
    cell_by_key: dict[tuple[UUID, str], StrategyCell],
    *,
    spot_key: str,
    hero_position: str,
    villain_position: str | None,
    hand_code: str,
) -> tuple[StrategySpot | None, Decimal, Decimal, Decimal] | None:
    """Return (spot, raise, call, fold) or None if hand is not comparable.

    - Prefers villain-specific spot, then generic for the same spot_key.
    - Does not fall back to parent spot types (iso↛rfi): only constructor charts.
    - Missing cell on a painted chart ⇒ not comparable (skip).
      Do not invent 100% fold — that made orphan/incomplete charts look perfect.
    - No usable chart at all ⇒ not comparable (skip).
    """
    # Spot counts as painted only if it has any raise/call (not an all-fold shell).
    painted_ids: set[UUID] = set()
    for (sid, _), cell in cell_by_key.items():
        if Decimal(str(cell.raise_freq)) > 0 or Decimal(str(cell.call_freq)) > 0:
            painted_ids.add(sid)

    try:
        code = normalize_hand_code(hand_code)
    except ValueError:
        code = hand_code

    def read_painted(
        s: StrategySpot,
    ) -> tuple[Decimal, Decimal, Decimal] | None:
        if s.id not in painted_ids:
            return None
        cell = cell_by_key.get((s.id, code)) or cell_by_key.get((s.id, hand_code))
        if cell is None:
            return None
        return (
            Decimal(str(cell.raise_freq)),
            Decimal(str(cell.call_freq)),
            Decimal(str(cell.fold_freq)),
        )

    candidates: list[StrategySpot] = []
    primary = resolve_spot(spot_by_key, spot_key, hero_position, villain_position)
    if primary is not None:
        candidates.append(primary)
    if villain_position:
        generic = resolve_spot(spot_by_key, spot_key, hero_position, None)
        if generic is not None and generic not in candidates:
            candidates.append(generic)
    for fb_key in _SPOT_FALLBACKS.get(spot_key, ()):
        fb = resolve_spot(spot_by_key, fb_key, hero_position, villain_position)
        if fb is None:
            fb = resolve_spot(spot_by_key, fb_key, hero_position, None)
        if fb is not None and fb not in candidates:
            candidates.append(fb)

    # First painted chart wins; a painted miss is out-of-range (not parent fallback)
    for s in candidates:
        freqs = read_painted(s)
        if freqs is None:
            continue
        return s, freqs[0], freqs[1], freqs[2]

    return None


def hand_is_deviation(
    hand: Hand,
    spot_by_key: dict[SpotMapKey, StrategySpot],
    cell_by_key: dict[tuple[UUID, str], StrategyCell],
    *,
    action_mode: str = "standard",
) -> bool | None:
    """Return True/False when hand can be compared to a chart; None if not comparable."""
    if not hand.hero_hand_code or not hand.detected_spot or not hand.hero_position:
        return None
    actual = hero_preflop_action(hand)
    if not actual:
        return None
    # Push-fold charts: call is never in the strategy — treat as deviation vs fold/raise.
    if action_mode == "push_fold" and actual == "call":
        resolved = resolve_cell_freqs(
            spot_by_key,
            cell_by_key,
            spot_key=hand.detected_spot,
            hero_position=hand.hero_position,
            villain_position=hand.villain_position,
            hand_code=hand.hero_hand_code,
        )
        if resolved is None:
            return None
        return True
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key=hand.detected_spot,
        hero_position=hand.hero_position,
        villain_position=hand.villain_position,
        hand_code=hand.hero_hand_code,
    )
    if resolved is None:
        return None
    _, raise_f, call_f, fold_f = resolved
    if action_mode == "push_fold":
        # Only raise (push) / fold matter; ignore call mix on cells.
        call_f = Decimal("0")
    return is_deviation(actual, raise_f, call_f, fold_f)
