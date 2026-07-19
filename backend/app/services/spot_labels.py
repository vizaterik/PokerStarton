"""Short branch labels for charts / analysis / trainer."""

from __future__ import annotations

_ACTION = {
    "rfi": "RFI",
    "iso": "ISO",
    "vs_open": "vs Open",
    "vs_3bet": "vs 3-Bet",
    "vs_4bet": "vs 4-Bet",
    "squeeze": "Squeeze",
}


def spot_action_label(spot_key: str) -> str:
    key = (spot_key or "").strip().lower()
    return _ACTION.get(key, key.replace("_", " ") or "spot")


def format_branch_label(
    spot_key: str,
    hero: str | None = None,
    villain: str | None = None,
) -> str:
    """Constructor-style tag: `Raise UTGvsBB`."""
    pot = spot_pot_tag(spot_key)
    matchup = pot_matchup_label(spot_key, hero, villain)
    if not matchup or matchup == "—":
        return pot
    return f"{pot} {matchup}"


def spot_pot_kind(spot_key: str) -> str:
    """Constructor-style pot: srp | 3bp | 4bp."""
    key = (spot_key or "").strip().lower()
    if key in {"vs_3bet", "squeeze"}:
        return "3bp"
    if key == "vs_4bet":
        return "4bp"
    return "srp"


def spot_pot_tag(spot_key: str) -> str:
    kind = spot_pot_kind(spot_key)
    if kind == "3bp":
        return "3-bet"
    if kind == "4bp":
        return "4-bet"
    return "Raise"


def pot_matchup_label(
    spot_key: str,
    hero: str | None,
    villain: str | None,
) -> str:
    """Who vs whom for a closed pot line (raiser vs caller), like tree branches.

    Facing spots: villain was last aggressor → `VvsH`.
    Opens without villain: hero seat alone.
    """
    h = (hero or "").strip().upper()
    v = (villain or "").strip().upper() if villain else ""
    key = (spot_key or "").strip().lower()
    if key in {"rfi", "iso"} or not v or v == h:
        return h or "—"
    # Tree / postflop pot: last raiser vs the caller (hero faced the raise).
    if key in {"vs_open", "vs_3bet", "vs_4bet", "squeeze"}:
        return f"{v}vs{h}"
    if h and v:
        return f"{h}vs{v}"
    return h or "—"


def hand_reached_flop(raw_text: str | None) -> bool:
    if not raw_text:
        return False
    upper = raw_text.upper()
    return "*** FLOP ***" in upper or "*** FLOP" in upper
