"""H2N-style HUD: cases / opportunities for VPIP, PFR, 3-bet, C-bet, fold to C-bet."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.services.hud_stats import _analyze_hand, _apply, OppCounters, _counters_to_stats


def _action(street, *, is_hero, action, order, amount=None, name=None):
    return SimpleNamespace(
        street=street,
        is_hero=is_hero,
        action=action,
        action_order=order,
        amount=Decimal(str(amount)) if amount is not None else None,
        player_name=name or ("Hero" if is_hero else "Villain"),
    )


def _hand(raw: str, actions: list, *, pos="BTN", net=0.0, villain_pos="BB"):
    return SimpleNamespace(
        id=uuid4(),
        raw_text=raw,
        hero_name="Hero",
        hero_position=pos,
        villain_position=villain_pos,
        hero_hand="AhKd",
        big_blind=Decimal("0.02"),
        hero_net=Decimal(str(net)),
        hero_net_bb=Decimal(str(net / 0.02)),
        actions=actions,
    )


def _stat_map(counters: OppCounters) -> dict:
    return {s.key: s for s in _counters_to_stats(counters)}


OPEN_CBET = """
Poker Hand #C1: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [2c 7d 9s]
Villain: checks
Hero: bets $0.04
Villain: folds
*** SUMMARY ***
"""

DONK_NOT_CBET = """
Poker Hand #C2: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [2c 7d 9s]
Villain: bets $0.04
Hero: raises $0.12 to $0.16
*** SUMMARY ***
"""

FOLD_TO_CBET = """
Poker Hand #C3: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Villain: raises $0.04 to $0.06
Hero: calls $0.04
*** FLOP *** [2c 7d 9s]
Villain: bets $0.04
Hero: folds
*** SUMMARY ***
"""

THREE_BET = """
Poker Hand #C4: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Villain: raises $0.04 to $0.06
Hero: raises $0.18 to $0.24
*** SUMMARY ***
"""

ALLIN_OPEN_NO_3BET_OPP = """
Poker Hand #C5: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Villain: raises $2 to $2 and is all-in
Hero: folds
*** SUMMARY ***
"""

AI_PRE_NO_CBET = """
Poker Hand #C6: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:00:00
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Hero: raises $2 to $2 and is all-in
Villain: calls $2 and is all-in
*** FLOP *** [2c 7d 9s]
*** SUMMARY ***
"""


def test_vpip_pfr_open_raise():
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=0.06),
        _action("preflop", is_hero=False, action="call", order=2, amount=0.04),
        _action("flop", is_hero=False, action="call", order=3),  # check
        _action("flop", is_hero=True, action="raise", order=4, amount=0.04),
    ]
    # checks stored as call with no amount
    actions[2] = _action("flop", is_hero=False, action="call", order=3, amount=None)
    h = _hand(OPEN_CBET, actions)
    f = _analyze_hand(h)
    assert f.vpip and f.pfr and f.vpip_opp and f.pfr_opp
    assert f.cbet_opp and f.cbet


def test_donk_is_not_cbet_opportunity():
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=0.06),
        _action("preflop", is_hero=False, action="call", order=2, amount=0.04),
        _action("flop", is_hero=False, action="raise", order=3, amount=0.04),
        _action("flop", is_hero=True, action="raise", order=4, amount=0.16),
    ]
    f = _analyze_hand(_hand(DONK_NOT_CBET, actions))
    assert not f.cbet_opp
    assert not f.cbet


def test_fold_to_cbet():
    actions = [
        _action("preflop", is_hero=False, action="raise", order=1, amount=0.06, name="Villain"),
        _action("preflop", is_hero=True, action="call", order=2, amount=0.04),
        _action("flop", is_hero=False, action="raise", order=3, amount=0.04, name="Villain"),
        _action("flop", is_hero=True, action="fold", order=4),
    ]
    f = _analyze_hand(_hand(FOLD_TO_CBET, actions, pos="BB", villain_pos="BTN"))
    assert f.fold_to_cbet_opp and f.fold_to_cbet
    assert f.vpip and not f.pfr


def test_three_bet_cases():
    actions = [
        _action("preflop", is_hero=False, action="raise", order=1, amount=0.06, name="Villain"),
        _action("preflop", is_hero=True, action="raise", order=2, amount=0.24),
    ]
    f = _analyze_hand(_hand(THREE_BET, actions, pos="BB", villain_pos="BTN"))
    assert f.three_bet_opp and f.three_bet
    assert f.vpip and f.pfr


def test_allin_open_excludes_3bet_opportunity():
    actions = [
        _action("preflop", is_hero=False, action="raise", order=1, amount=2.0, name="Villain"),
        _action("preflop", is_hero=True, action="fold", order=2),
    ]
    f = _analyze_hand(_hand(ALLIN_OPEN_NO_3BET_OPP, actions, pos="BB", villain_pos="BTN"))
    assert not f.three_bet_opp
    assert not f.pfr_opp  # jam — no raise option
    assert f.vpip_opp


def test_preflop_allin_excludes_cbet_opportunity():
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=2.0),
        _action("preflop", is_hero=False, action="call", order=2, amount=2.0),
    ]
    f = _analyze_hand(_hand(AI_PRE_NO_CBET, actions))
    assert f.vpip and f.pfr
    assert not f.cbet_opp


def test_json_shape_cases_opportunities():
    c = OppCounters()
    actions = [
        _action("preflop", is_hero=True, action="raise", order=1, amount=0.06),
        _action("preflop", is_hero=False, action="call", order=2, amount=0.04),
        _action("flop", is_hero=False, action="call", order=3, amount=None),
        _action("flop", is_hero=True, action="raise", order=4, amount=0.04),
    ]
    _apply(c, _analyze_hand(_hand(OPEN_CBET, actions)), _hand(OPEN_CBET, actions))
    m = _stat_map(c)
    vpip = m["vpip"]
    assert vpip.cases == 1 and vpip.opportunities == 1
    assert vpip.value == 100.0
    assert vpip.samples == vpip.opportunities
    cbet = m["cbet"]
    assert cbet.cases == 1 and cbet.opportunities == 1
