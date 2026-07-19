"""Canonical poker hand codes for the 13x13 preflop matrix."""

RANKS = ("A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2")
RANK_INDEX = {r: i for i, r in enumerate(RANKS)}


def normalize_hand_code(code: str) -> str:
    """Normalize to AA / AKs / AKo."""
    raw = code.strip().upper().replace(" ", "")
    if len(raw) == 2 and raw[0] == raw[1] and raw[0] in RANK_INDEX:
        return raw
    if len(raw) == 3 and raw[0] in RANK_INDEX and raw[1] in RANK_INDEX and raw[2] in ("S", "O"):
        r1, r2, suited = raw[0], raw[1], raw[2].lower()
        if RANK_INDEX[r1] > RANK_INDEX[r2]:
            r1, r2 = r2, r1
        return f"{r1}{r2}{suited}"
    raise ValueError(f"Invalid hand code: {code!r}")


def cards_to_hand_code(card1: str, card2: str) -> str:
    """Convert two hole cards like 'Ah','Kd' to matrix code."""
    c1, c2 = card1.strip(), card2.strip()
    if len(c1) < 2 or len(c2) < 2:
        raise ValueError(f"Invalid cards: {card1!r}, {card2!r}")
    r1, s1 = c1[0].upper(), c1[1].lower()
    r2, s2 = c2[0].upper(), c2[1].lower()
    if r1 not in RANK_INDEX or r2 not in RANK_INDEX:
        raise ValueError(f"Invalid ranks: {card1!r}, {card2!r}")
    if r1 == r2:
        return f"{r1}{r2}"
    if RANK_INDEX[r1] > RANK_INDEX[r2]:
        r1, r2, s1, s2 = r2, r1, s2, s1
    return f"{r1}{r2}{'s' if s1 == s2 else 'o'}"


def all_hand_codes() -> list[str]:
    codes: list[str] = []
    for i, r1 in enumerate(RANKS):
        for j, r2 in enumerate(RANKS):
            if i == j:
                codes.append(f"{r1}{r2}")
            elif i < j:
                codes.append(f"{r1}{r2}s")
            else:
                codes.append(f"{r2}{r1}o")
    return codes
