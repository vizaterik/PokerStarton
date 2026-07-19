"""All-In EV: pre-river all-in uses (pot − rake − jackpot) × equity − investment."""

from pathlib import Path

from app.services.all_in_ev import compute_hand_all_in_ev
from app.services.equity import heads_up_equity
from app.parsers.pokerstars import compute_hero_net

AA_VS_AKO_PREFLOP = """
Poker Hand #RC4642030568: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:05:53
Table 'RushAndCash16805219' 6-max Seat #1 is the button
Seat 1: 324bbd2e ($3.09 in chips)
Seat 2: Hero ($5.91 in chips)
Seat 3: b41ed234 ($2.54 in chips)
Seat 4: 82a5cc04 ($2.66 in chips)
Seat 5: c8f859f7 ($2.16 in chips)
Seat 6: 39e8b645 ($2.02 in chips)
Hero: posts small blind $0.01
b41ed234: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
82a5cc04: folds
c8f859f7: raises $0.04 to $0.06
39e8b645: folds
324bbd2e: folds
Hero: raises $0.14 to $0.2
b41ed234: folds
c8f859f7: raises $0.42 to $0.62
Hero: raises $5.29 to $5.91 and is all-in
c8f859f7: calls $1.54 and is all-in
Uncalled bet ($3.75) returned to Hero
Hero: shows [Ac Ad]
c8f859f7: shows [As Kc]
*** FLOP *** [4d 7h 6s]
*** TURN *** [4d 7h 6s] [9h]
*** RIVER *** [4d 7h 6s 9h] [Kd]
*** SHOWDOWN ***
Hero collected $4.25 from pot
*** SUMMARY ***
Total pot $4.34 | Rake $0.06 | Jackpot $0.03 | Bingo $0 | Fortune $0 | Tax $0
Board [4d 7h 6s 9h Kd]
Seat 2: Hero (small blind) showed [Ac Ad] and won ($4.25) with a pair of Aces
Seat 5: c8f859f7 showed [As Kc] and lost with a pair of Kings
"""

STEAL_NO_AI = """
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
Total pot $0.05 | Rake $0
Seat 1: Hero (button) collected ($0.05)
"""

RIVER_ALL_IN = """
Poker Hand #RC9: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:18:40
Table 'T' 6-max Seat #1 is the button
Seat 1: Villain ($2 in chips)
Seat 2: Hero ($2 in chips)
Hero: posts small blind $0.01
Villain: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $0.04 to $0.06
Villain: calls $0.04
*** FLOP *** [2c 7d 9s]
Villain: checks
Hero: bets $0.08
Villain: calls $0.08
*** TURN *** [2c 7d 9s] [3h]
Villain: checks
Hero: checks
*** RIVER *** [2c 7d 9s 3h] [2d]
Villain: bets $1.86 and is all-in
Hero: calls $1.86
Villain: shows [2s 2h]
Hero: shows [Ah Kh]
*** SHOWDOWN ***
Villain collected $3.90 from pot
*** SUMMARY ***
Total pot $4.00 | Rake $0.10
Board [2c 7d 9s 3h 2d]
Seat 1: Villain showed [2s 2h] and won ($3.90)
Seat 2: Hero showed [Ah Kh] and lost
"""


def test_aa_vs_ako_preflop_all_in_ev_differs_from_net():
    net, _ = compute_hero_net(AA_VS_AKO_PREFLOP, big_blind=0.02)
    br = compute_hand_all_in_ev(AA_VS_AKO_PREFLOP, hero_net=net)
    assert br.used_equity is True
    assert br.all_in_street == "preflop"
    # Awarded pot = Total pot − Rake − Jackpot = 4.34 − 0.06 − 0.03
    assert br.pot == 4.25
    assert abs((br.investment or 0) - 2.16) < 1e-9
    eq = heads_up_equity(["Ac", "Ad"], ["As", "Kc"])
    expected = round(4.25 * eq - 2.16, 4)
    assert abs(br.hand_ev - expected) < 1e-9
    # Won the runout → realized net above EV
    assert net > br.hand_ev


def test_non_all_in_ev_equals_net():
    net, _ = compute_hero_net(STEAL_NO_AI, big_blind=0.02)
    br = compute_hand_all_in_ev(STEAL_NO_AI, hero_net=net)
    assert br.used_equity is False
    assert br.hand_ev == net


def test_river_all_in_ev_equals_net():
    net, _ = compute_hero_net(RIVER_ALL_IN, big_blind=0.02)
    br = compute_hand_all_in_ev(RIVER_ALL_IN, hero_net=net)
    assert br.used_equity is False
    assert br.all_in_street == "river"
    assert br.hand_ev == net


def test_sample_file_all_in_if_present():
    sample = Path(__file__).resolve().parent.parent / "_ai_sample.txt"
    if not sample.exists():
        return
    raw = sample.read_text(encoding="utf-8")
    net, _ = compute_hero_net(raw, big_blind=0.02)
    br = compute_hand_all_in_ev(raw, hero_net=net)
    assert br.used_equity is True
    assert br.hand_ev != net

