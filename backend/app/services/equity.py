"""Holdem equity vs known hands (exact HU via py-poker-equity, MC/exact multiway)."""

from __future__ import annotations

import random
from itertools import combinations

from py_poker_equity import evaluate_hand, get_equity

RANKS = "23456789TJQKA"
SUITS = "shdc"
FULL_DECK = [f"{r}{s}" for r in RANKS for s in SUITS]


def to_lib_card(card: str) -> str:
    """Normalize 'Td' → '10d' for py-poker-equity."""
    c = card.strip()
    if len(c) < 2:
        return c
    rank, suit = c[:-1].upper(), c[-1].lower()
    if rank == "T":
        rank = "10"
    return f"{rank}{suit}"


def _equity_from_result(res: dict[str, float]) -> float:
    """P(win) + P(tie)/2 in [0, 1]."""
    return (res["a_win"] + res["tie"] / 2.0) / 100.0


def heads_up_equity(hero: list[str], villain: list[str], board: list[str] | None = None) -> float:
    board = board or []
    res = get_equity(
        [to_lib_card(c) for c in hero],
        [to_lib_card(c) for c in villain],
        board=[to_lib_card(c) for c in board] if board else None,
    )
    return _equity_from_result(res)


def _cmp_hands(a, b) -> int:
    """>0 if a better, <0 if b better, 0 if tie.

    Same hand_rank category → compare tiebreaker (higher wins).
    """
    ra = a.hand_rank
    rb = b.hand_rank
    if ra != rb:
        # In this library lower category number is stronger (1=straight flush …)
        return 1 if ra < rb else -1
    ta = getattr(a, "tiebreaker", ())
    tb = getattr(b, "tiebreaker", ())
    if ta > tb:
        return 1
    if ta < tb:
        return -1
    return 0


def _score_runout(hero: list[str], villains: list[list[str]], board: list[str]) -> float:
    """Hero pot share on a complete 5-card board."""
    lib_board = [to_lib_card(c) for c in board]
    results = [evaluate_hand([to_lib_card(c) for c in hero], lib_board)]
    for v in villains:
        results.append(evaluate_hand([to_lib_card(c) for c in v], lib_board))

    best_i = 0
    winners = [0]
    for i, r in enumerate(results[1:], start=1):
        cmp = _cmp_hands(results[best_i], r)
        if cmp < 0:
            best_i = i
            winners = [i]
        elif cmp == 0:
            winners.append(i)
    return (1.0 / len(winners)) if 0 in winners else 0.0


def multiway_equity(
    hero: list[str],
    villains: list[list[str]],
    board: list[str] | None = None,
    *,
    samples: int = 8000,
    seed: int = 42,
) -> float:
    board = list(board or [])
    if not villains:
        return 1.0
    if len(villains) == 1:
        return heads_up_equity(hero, villains[0], board)

    known = {c.upper() for c in hero + board}
    for v in villains:
        known.update(c.upper() for c in v)
    remaining = [c for c in FULL_DECK if c.upper() not in known]
    need = 5 - len(board)
    if need < 0:
        return 0.0
    if need == 0:
        return _score_runout(hero, villains, board)

    n = len(remaining)
    total_combos = 1
    for i in range(need):
        total_combos *= n - i
        total_combos //= i + 1

    if total_combos <= 5000:
        equity_sum = 0.0
        trials = 0
        for combo in combinations(remaining, need):
            trials += 1
            equity_sum += _score_runout(hero, villains, board + list(combo))
        return equity_sum / trials if trials else 0.0

    rng = random.Random(seed)
    equity_sum = 0.0
    for _ in range(samples):
        deal = rng.sample(remaining, need)
        equity_sum += _score_runout(hero, villains, board + deal)
    return equity_sum / samples


def hero_equity(hero: list[str], villains: list[list[str]], board: list[str] | None = None) -> float:
    if len(villains) == 1:
        return heads_up_equity(hero, villains[0], board)
    return multiway_equity(hero, villains, board)
