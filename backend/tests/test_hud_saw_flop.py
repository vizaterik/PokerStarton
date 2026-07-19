"""WTSD / WWSF must use hero-saw-flop, not any-player flop action."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.services.hud_stats import _analyze_hand, _hero_saw_flop, _apply, OppCounters, _counters_to_stats


def _action(street: str, *, is_hero: bool, action: str, order: int, amount=None):
    return SimpleNamespace(
        street=street,
        is_hero=is_hero,
        action=action,
        action_order=order,
        amount=Decimal(str(amount)) if amount is not None else None,
        player_name="Hero" if is_hero else "Villain",
    )


def _hand(raw: str, actions: list, *, net: float = 0.0):
    return SimpleNamespace(
        id=uuid4(),
        raw_text=raw,
        hero_name="Hero",
        hero_position="BTN",
        villain_position="BB",
        hero_hand="AhKd",
        big_blind=Decimal("0.02"),
        hero_net=Decimal(str(net)),
        hero_net_bb=Decimal(str(net / 0.02)),
        actions=actions,
    )


FOLD_PRE_OTHERS_FLOP = """
Poker Hand #X1: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Hero: folds
*** FLOP *** [Ah Kd 2c]
Villain: bets $0.02
*** SUMMARY ***
Total pot $0.05
"""

HERO_SEES_FLOP = """
Poker Hand #X2: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [2c 7d 9s]
Hero: checks
Villain: checks
*** SUMMARY ***
Total pot $0.12
"""

HERO_AI_PRE_SEES_FLOP = """
Poker Hand #X3: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Hero: raises $2 to $2 and is all-in
Villain: calls $2 and is all-in
Hero: shows [Ac Ad]
Villain: shows [As Kc]
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [2d]
*** SHOWDOWN ***
Hero collected $4 from pot
*** SUMMARY ***
Total pot $4
Seat 1: Hero showed [Ac Ad] and won ($4)
Seat 2: Villain showed [As Kc] and lost
"""


def test_folded_preflop_does_not_count_as_saw_flop_when_others_play():
    actions = [
        _action("preflop", is_hero=True, action="fold", order=1),
        _action("flop", is_hero=False, action="raise", order=2, amount=0.02),
    ]
    hand = _hand(FOLD_PRE_OTHERS_FLOP, actions)
    assert _hero_saw_flop(hand, actions) is False
    flags = _analyze_hand(hand)
    assert flags.saw_flop is False


def test_hero_check_flop_counts_as_saw_flop():
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=0.06),
        _action("preflop", is_hero=False, action="call", order=2, amount=0.04),
        _action("flop", is_hero=True, action="call", order=3),  # check
        _action("flop", is_hero=False, action="call", order=4),
    ]
    hand = _hand(HERO_SEES_FLOP, actions, net=-0.06)
    assert _hero_saw_flop(hand, actions) is True


def test_preflop_all_in_counts_as_saw_flop_without_postflop_actions():
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=2),
        _action("preflop", is_hero=False, action="call", order=2, amount=2),
    ]
    hand = _hand(HERO_AI_PRE_SEES_FLOP, actions, net=2.0)
    assert _hero_saw_flop(hand, actions) is True
    flags = _analyze_hand(hand)
    assert flags.saw_flop is True
    assert flags.went_to_showdown is True
    assert flags.won_when_saw_flop is True


def test_wwsf_denominator_ignores_folded_preflop_flops():
    c = OppCounters()
    fold_hand = _hand(
        FOLD_PRE_OTHERS_FLOP,
        [_action("preflop", is_hero=True, action="fold", order=1),
         _action("flop", is_hero=False, action="raise", order=2, amount=0.02)],
        net=-0.02,
    )
    see_hand = _hand(
        HERO_SEES_FLOP,
        [
            _action("preflop", is_hero=True, action="raise", order=1, amount=0.06),
            _action("preflop", is_hero=False, action="call", order=2, amount=0.04),
            _action("flop", is_hero=True, action="call", order=3),
        ],
        net=0.12,
    )
    _apply(c, _analyze_hand(fold_hand), fold_hand)
    _apply(c, _analyze_hand(see_hand), see_hand)
    stats = {s.key: s for s in _counters_to_stats(c)}
    assert stats["wwsf"].samples == 1  # only hero-saw-flop hand
    assert stats["wtsd"].samples == 1
