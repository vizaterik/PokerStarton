"""Format modules for strategies: cash / mtt / spins presets and validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

StrategyFormat = Literal["cash", "mtt", "spins"]
TableSize = Literal["2-max", "3-max", "6-max", "8-max", "9-max"]
ActionMode = Literal["standard", "push_fold"]
MttStage = Literal["early", "ante", "bubble", "final"]

FORMATS: tuple[StrategyFormat, ...] = ("cash", "mtt", "spins")
TABLE_SIZES: tuple[TableSize, ...] = ("2-max", "3-max", "6-max", "8-max", "9-max")
ACTION_MODES: tuple[ActionMode, ...] = ("standard", "push_fold")
MTT_STAGES: tuple[MttStage, ...] = ("early", "ante", "bubble", "final")

POSITIONS_BY_TABLE: dict[str, tuple[str, ...]] = {
    "2-max": ("BTN", "BB"),
    "3-max": ("BTN", "SB", "BB"),
    "6-max": ("UTG", "MP", "CO", "BTN", "SB", "BB"),
    "8-max": ("UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"),
    "9-max": ("UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"),
}

# Situation filter labels → spot_key
SITUATIONS: tuple[tuple[str, str], ...] = (
    ("rfi", "RFI"),
    ("iso", "ISO"),
    ("vs_open", "vs Open"),
    ("vs_3bet", "vs 3-Bet"),
    ("squeeze", "Squeeze"),
    ("vs_4bet", "vs 4-Bet"),
)

PUSH_FOLD_SITUATIONS: tuple[tuple[str, str], ...] = (
    ("rfi", "Push"),
    ("vs_open", "vs Push"),
)


@dataclass(frozen=True)
class ModulePreset:
    format: StrategyFormat
    table_size: TableSize
    stack_depth: str
    mtt_stage: MttStage | None
    action_mode: ActionMode
    label: str


CASH_PRESETS: tuple[ModulePreset, ...] = (
    ModulePreset("cash", "6-max", "100bb", None, "standard", "Cash 6-max · 100bb"),
)

MTT_PRESETS: tuple[ModulePreset, ...] = (
    ModulePreset("mtt", "6-max", "40bb", "early", "standard", "MTT 6-max · Ранняя стадия"),
    ModulePreset("mtt", "6-max", "25bb", "ante", "standard", "MTT 6-max · Стадия анте"),
    ModulePreset("mtt", "6-max", "15bb", "bubble", "push_fold", "MTT 6-max · Баббл (Push-Fold)"),
    ModulePreset("mtt", "6-max", "12bb", "final", "push_fold", "MTT 6-max · Финал (Push-Fold)"),
    ModulePreset("mtt", "8-max", "40bb", "early", "standard", "MTT 8-max · Ранняя стадия"),
    ModulePreset("mtt", "8-max", "25bb", "ante", "standard", "MTT 8-max · Стадия анте"),
    ModulePreset("mtt", "8-max", "15bb", "bubble", "push_fold", "MTT 8-max · Баббл (Push-Fold)"),
    ModulePreset("mtt", "8-max", "12bb", "final", "push_fold", "MTT 8-max · Финал (Push-Fold)"),
)

SPINS_PRESETS: tuple[ModulePreset, ...] = (
    ModulePreset("spins", "3-max", "25bb", None, "standard", "Spin & Go · 25bb"),
    ModulePreset("spins", "3-max", "20bb", None, "standard", "Spin & Go · 20bb"),
    ModulePreset("spins", "3-max", "15bb", None, "push_fold", "Spin & Go · 15bb Push-Fold"),
    ModulePreset("spins", "3-max", "10bb", None, "push_fold", "Spin & Go · 10bb Push-Fold"),
)

ALL_PRESETS: tuple[ModulePreset, ...] = CASH_PRESETS + MTT_PRESETS + SPINS_PRESETS


def parse_stack_bb(stack_depth: str) -> float:
    s = (stack_depth or "").strip().lower().replace(" ", "")
    if s.endswith("bb"):
        s = s[:-2]
    return float(s)


def stack_window(format: str, stack_depth: str, action_mode: str) -> tuple[float | None, float | None]:
    """Return (min_bb, max_bb) for matching / spot defaults."""
    try:
        mid = parse_stack_bb(stack_depth)
    except ValueError:
        return None, None
    if action_mode == "push_fold" or mid < 15:
        return 0.0, max(15.0, mid + 2.0)
    if format == "spins":
        return max(8.0, mid - 2.0), mid + 2.0
    if format == "cash":
        return max(20.0, mid * 0.55), mid * 1.45
    return max(10.0, mid * 0.5), mid * 1.4


def positions_for(table_size: str) -> tuple[str, ...]:
    return POSITIONS_BY_TABLE.get(table_size, POSITIONS_BY_TABLE["6-max"])


def situations_for(action_mode: str) -> tuple[tuple[str, str], ...]:
    return PUSH_FOLD_SITUATIONS if action_mode == "push_fold" else SITUATIONS


def resolve_action_mode(
    format: str,
    stack_depth: str,
    mtt_stage: str | None,
    action_mode: str | None,
) -> ActionMode:
    if action_mode in ACTION_MODES:
        mode = action_mode  # type: ignore[assignment]
    else:
        mode = "standard"
    try:
        mid = parse_stack_bb(stack_depth)
    except ValueError:
        mid = 100.0
    if format == "mtt" and (mid < 15 or mtt_stage in {"bubble", "final"}):
        return "push_fold"
    if format == "spins" and mid <= 15:
        return "push_fold"
    if mode == "push_fold":
        return "push_fold"
    return "standard"


def validate_strategy_meta(
    *,
    format: str,
    table_size: str,
    stack_depth: str,
    mtt_stage: str | None,
    action_mode: str | None,
) -> dict:
    if format not in FORMATS:
        raise ValueError(f"Unknown format: {format}")
    if table_size not in TABLE_SIZES:
        raise ValueError(f"Unknown table_size: {table_size}")
    try:
        parse_stack_bb(stack_depth)
    except ValueError as exc:
        raise ValueError(f"Invalid stack_depth: {stack_depth}") from exc

    if format == "cash" and table_size != "6-max":
        raise ValueError("Cash supports only 6-max")
    if format == "spins" and table_size != "3-max":
        raise ValueError("Spins require 3-max")
    if format == "mtt" and table_size not in {"6-max", "8-max"}:
        raise ValueError("MTT supports 6-max and 8-max")
    if format == "mtt":
        if mtt_stage is None or mtt_stage not in MTT_STAGES:
            raise ValueError("MTT requires a stage (early / ante / bubble / final)")
    else:
        mtt_stage = None

    mode = resolve_action_mode(format, stack_depth, mtt_stage, action_mode)
    return {
        "format": format,
        "table_size": table_size,
        "stack_depth": stack_depth if stack_depth.endswith("bb") else f"{stack_depth}bb",
        "mtt_stage": mtt_stage,
        "action_mode": mode,
    }


def hand_matches_strategy_meta(
    *,
    format: str,
    table_size: str,
    stack_depth: str,
    action_mode: str,
    hero_position: str | None,
    stack_bb: float | None,
    seat_count_hint: int | None = None,
) -> bool:
    """Whether a hand is in-scope for this strategy module."""
    pos_ok = positions_for(table_size)
    if hero_position:
        hp = hero_position.strip().upper()
        aliases = {
            "UTG1": "UTG+1",
            "UTG+1": "UTG+1",
            "HJ": "HJ" if "HJ" in pos_ok else "MP",
            "MP1": "MP",
            "BTN": "BTN",
            "BU": "BTN",
        }
        mapped = aliases.get(hp, hp)
        if mapped == "BTN" and "BTN" not in pos_ok and "BU" in pos_ok:
            mapped = "BU"
        if mapped not in pos_ok and hp not in pos_ok:
            if table_size == "6-max" and mapped in {"HJ", "UTG+1", "UTG1"}:
                pass
            elif format == "spins" and mapped not in pos_ok:
                return False

    lo, hi = stack_window(format, stack_depth, action_mode)
    if stack_bb is not None and lo is not None and hi is not None:
        if stack_bb < lo or stack_bb > hi:
            return False

    if seat_count_hint is not None:
        expected = {"2-max": 2, "3-max": 3, "6-max": 6, "8-max": 8, "9-max": 9}.get(table_size)
        if expected and abs(seat_count_hint - expected) > 2 and format != "mtt":
            if format in {"cash", "spins"}:
                return False
    return True
