"""H2N-compatible showdown detection for WSD / WWSD graph lines."""

from app.parsers.pokerstars import detect_went_to_showdown, extract_showdown_nets

CONTESTED_SD = """
Poker Hand #RC1: Hold'em No Limit ($0.01/$0.02) - 2026/07/14 00:00:00
Table 'T' 6-max Seat #1 is the button
Seat 1: Hero ($2 in chips)
Seat 2: Villain ($2 in chips)
Hero: posts small blind $0.01
Villain: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Hero: raises $1.98 to $2 and is all-in
Villain: calls $1.98 and is all-in
Hero: shows [Ac Ad]
Villain: shows [As Kc]
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [2d]
*** SHOWDOWN ***
Hero collected $3.80 from pot
*** SUMMARY ***
Total pot $4 | Rake $0.20
Seat 1: Hero showed [Ac Ad] and won ($3.80)
Seat 2: Villain showed [As Kc] and lost
"""

UNCONTESTED_GG_FALSE_SD = """
Poker Hand #RC2: Hold'em No Limit ($0.01/$0.02) - 2026/07/14 00:00:00
Table 'T' 6-max Seat #1 is the button
Seat 1: Hero ($2 in chips)
Seat 2: Villain ($2 in chips)
Hero: posts small blind $0.01
Villain: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [8d 5h]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [6c 2h 8c]
Hero: bets $0.18
Villain: folds
Uncalled bet ($0.18) returned to Hero
*** SHOWDOWN ***
Hero collected $0.55 from pot
*** SUMMARY ***
Total pot $0.60 | Rake $0.02
Board [6c 2h 8c]
Seat 1: Hero (small blind) showed [8d 5h] and won ($0.55)
Seat 2: Villain (big blind) folded on the Flop
"""


def test_contested_all_in_is_showdown():
    assert detect_went_to_showdown(CONTESTED_SD) is True


def test_uncontested_gg_showed_is_not_showdown():
    """GG prints Hero showed + SHOWDOWN even when villain folded — H2N = WWSD."""
    assert detect_went_to_showdown(UNCONTESTED_GG_FALSE_SD) is False


def test_uncontested_net_goes_to_wwsd_bucket():
    went, wsd, _wsd_bb, wwsd, _wwsd_bb = extract_showdown_nets(
        UNCONTESTED_GG_FALSE_SD, big_blind=0.02
    )
    assert went is False
    assert wsd == 0.0
    assert wwsd is not None and wwsd > 0


def test_contested_net_goes_to_wsd_bucket():
    went, wsd, _wsd_bb, wwsd, _wwsd_bb = extract_showdown_nets(
        CONTESTED_SD, big_blind=0.02
    )
    assert went is True
    assert wsd is not None and wsd > 0
    assert wwsd == 0.0
