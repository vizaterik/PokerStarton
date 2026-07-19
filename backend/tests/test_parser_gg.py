from pathlib import Path

from app.parsers.pokerstars import parse_pokerstars

SAMPLE = Path(__file__).resolve().parents[1] / "uploads"


def test_parse_gg_sample_file():
    files = list(SAMPLE.glob("*.txt"))
    if not files:
        return
    hands = parse_pokerstars(files[0].read_text(encoding="utf-8", errors="replace"))
    assert len(hands) > 100
    first = hands[0]
    assert first.hero_hand_code == "Q9o"
    assert first.hero_position == "SB"
    assert first.detected_spot == "vs_open"
    assert first.hero_preflop_action == "fold"


def test_parse_minimal_block():
    text = """
Poker Hand #RC1: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:32:47
Table 'T' 6-max Seat #1 is the button
Seat 1: Villain ($2 in chips)
Seat 2: Hero ($2 in chips)
Seat 3: BBPlayer ($2 in chips)
Hero: posts small blind $0.01
BBPlayer: posts big blind $0.02
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Villain: raises $0.02 to $0.04
Hero: folds
BBPlayer: folds
*** SUMMARY ***
"""
    hands = parse_pokerstars(text)
    assert len(hands) == 1
    assert hands[0].hero_hand_code == "AKo"
    assert hands[0].hero_preflop_action == "fold"
    assert hands[0].detected_spot == "vs_open"
