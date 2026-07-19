from app.parsers.pokerstars import compute_hero_net, parse_pokerstars

WIN_STEAL = """
Poker Hand #RC1: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:32:47
Table 'T' 6-max Seat #1 is the button
Seat 1: Hero ($2 in chips)
Seat 2: SB ($2 in chips)
Seat 3: BB ($2 in chips)
SB: posts small blind $0.01
BB: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Tc Td]
Hero: raises $0.04 to $0.06
SB: folds
BB: folds
Uncalled bet ($0.04) returned to Hero
*** SHOWDOWN ***
Hero collected $0.05 from pot
*** SUMMARY ***
Seat 1: Hero (button) collected ($0.05)
"""

FOLD_BB = """
Poker Hand #RC2: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:33:00
Table 'T' 6-max Seat #1 is the button
Seat 1: BTN ($2 in chips)
Seat 2: SB ($2 in chips)
Seat 3: Hero ($2 in chips)
SB: posts small blind $0.01
Hero: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
BTN: raises $0.02 to $0.04
SB: folds
Hero: folds
Uncalled bet ($0.02) returned to BTN
*** SHOWDOWN ***
BTN collected $0.05 from pot
*** SUMMARY ***
Seat 3: Hero (big blind) folded before Flop
"""


def test_steal_blinds_net():
    net, net_bb = compute_hero_net(WIN_STEAL, big_blind=0.02)
    assert net == 0.03
    assert net_bb == 1.5


def test_fold_bb_net():
    net, net_bb = compute_hero_net(FOLD_BB, big_blind=0.02)
    assert net == -0.02
    assert net_bb == -1.0


def test_parse_includes_net():
    hands = parse_pokerstars(WIN_STEAL)
    assert len(hands) == 1
    assert hands[0].hero_net == 0.03
    assert hands[0].hero_net_bb == 1.5


SB_RAISE_CHOP = """
Poker Hand #RCCHOP: Hold'em No Limit ($0.01/$0.02) - 2026/07/14 14:34:21
Table 'T' 6-max Seat #1 is the button
Seat 1: Villain ($2 in chips)
Seat 2: Hero ($2 in chips)
Hero: posts small blind $0.01
Villain: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Ac 4c]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [3d 6d Qd]
Hero: checks
Villain: checks
*** TURN *** [3d 6d Qd] [2s]
Hero: checks
Villain: checks
*** RIVER *** [3d 6d Qd 2s] [7s]
Hero: checks
Villain: checks
Hero: shows [Ac 4c]
Villain: shows [4h As]
*** SHOWDOWN ***
Hero collected $0.06 from pot
Villain collected $0.06 from pot
*** SUMMARY ***
Total pot $0.12 | Rake $0
Seat 2: Hero (small blind) showed [Ac 4c] and won ($0.06)
Seat 1: Villain (big blind) showed [4h As] and won ($0.06)
"""


def test_sb_raise_keeps_blind_in_street_commitment():
    """Blind posted before HOLE CARDS must count toward raise 'to' amount."""
    net, net_bb = compute_hero_net(SB_RAISE_CHOP, big_blind=0.02)
    assert net == 0.0
    assert net_bb == 0.0
