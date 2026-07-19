"""All-In EV (H2N / HM2 style).



For pots that go all-in before the river with a runout:

  hand_EV = pot_after_fees × equity − hero_investment



pot_after_fees = Total pot − Rake − Jackpot (GG awarded pot; matches

"collected" totals in hand history).



Otherwise hand_EV = realized net (Amount Won).

"""



from __future__ import annotations



import re

from dataclasses import dataclass



from app.services.equity import hero_equity



STREET_RE = re.compile(

    r"^\*\*\*\s+(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*",

    re.IGNORECASE,

)

FLOP_RE = re.compile(

    r"\*\*\*\s+FLOP\s+\*\*\*\s*\[([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\]",

    re.IGNORECASE,

)

TURN_RE = re.compile(

    r"\*\*\*\s+TURN\s+\*\*\*.*?\[([2-9TJQKA][shdc])\]",

    re.IGNORECASE,

)

RIVER_RE = re.compile(

    r"\*\*\*\s+RIVER\s+\*\*\*.*?\[([2-9TJQKA][shdc])\]",

    re.IGNORECASE,

)

ALL_IN_RE = re.compile(

    r"^(?P<name>.+?):\s+(?:folds|checks|calls|bets|raises|posts).*\band is all-in\b",

    re.IGNORECASE,

)

SHOWS_RE = re.compile(

    r"^(?P<name>[^:\n]+?):\s*shows?\s*\[(?P<c1>[2-9TJQKA][shdc])\s+(?P<c2>[2-9TJQKA][shdc])\]",

    re.IGNORECASE | re.MULTILINE,

)

SUMMARY_SHOWED_RE = re.compile(

    r"^Seat\s+\d+:\s*(?P<name>.+?)\s+(?:\([^)]*\)\s+)?"

    r"(?:showed|mucked)\s*\[(?P<c1>[2-9TJQKA][shdc])\s+(?P<c2>[2-9TJQKA][shdc])\]",

    re.IGNORECASE | re.MULTILINE,

)

TOTAL_POT_RE = re.compile(

    r"Total pot \$?(?P<pot>[\d.]+)(?:\s*\|\s*Rake \$?(?P<rake>[\d.]+))?",

    re.IGNORECASE,

)

JACKPOT_RE = re.compile(r"Jackpot \$?([\d.]+)", re.IGNORECASE)

DEALT_HERO_RE = re.compile(

    r"^Dealt to (?P<name>.+?)\s+\[(?P<c1>[2-9TJQKA][shdc])\s+(?P<c2>[2-9TJQKA][shdc])\]",

    re.IGNORECASE | re.MULTILINE,

)



STREET_BOARD_LEN = {"preflop": 0, "flop": 3, "turn": 4, "river": 5}





@dataclass(frozen=True)

class AllInEvBreakdown:

    used_equity: bool

    hand_ev: float

    equity: float | None = None

    pot: float | None = None

    investment: float | None = None

    all_in_street: str | None = None





def _norm_card(c: str) -> str:

    return c[0].upper() + c[1].lower()





def _parse_shown_cards(raw: str) -> dict[str, tuple[str, str]]:

    out: dict[str, tuple[str, str]] = {}

    for re_obj in (SHOWS_RE, SUMMARY_SHOWED_RE):

        for m in re_obj.finditer(raw):

            name = m.group("name").replace("(button)", "").strip()

            name = re.sub(r"\s+\([^)]*\)\s*$", "", name).strip().lower()

            if not name or "***" in name:

                continue

            out[name] = (_norm_card(m.group("c1")), _norm_card(m.group("c2")))

    return out





def _parse_hero_cards(raw: str, hero_name: str) -> tuple[str, str] | None:

    for m in DEALT_HERO_RE.finditer(raw):

        if m.group("name").strip().lower() == hero_name.lower():

            return _norm_card(m.group("c1")), _norm_card(m.group("c2"))

    return None





def _parse_full_board(raw: str) -> list[str]:

    board: list[str] = []

    m = FLOP_RE.search(raw)

    if m:

        board.extend([m.group(1), m.group(2), m.group(3)])

    m = TURN_RE.search(raw)

    if m:

        board.append(m.group(1))

    m = RIVER_RE.search(raw)

    if m:

        board.append(m.group(1))

    return [_norm_card(c) for c in board]





def _parse_pot_after_fees(raw: str) -> float | None:

    """Awarded pot: Total pot − Rake − Jackpot (H2N / GG)."""

    m = TOTAL_POT_RE.search(raw)

    if not m:

        return None

    pot = float(m.group("pot"))

    rake = float(m.group("rake") or 0)

    jm = JACKPOT_RE.search(raw)

    jack = float(jm.group(1)) if jm else 0.0

    return round(max(0.0, pot - rake - jack), 4)





def _hero_investment(raw: str, hero_name: str) -> float:

    """Chips hero put into the pot that stayed (invested − uncalled return)."""

    hero = re.escape(hero_name)

    post_re = re.compile(

        rf"^{hero}: posts (?:small blind|big blind|the ante) \$?([\d.]+)",

        re.IGNORECASE,

    )

    call_re = re.compile(rf"^{hero}: calls \$?([\d.]+)", re.IGNORECASE)

    bet_re = re.compile(rf"^{hero}: bets \$?([\d.]+)", re.IGNORECASE)

    raise_re = re.compile(rf"^{hero}: raises \$?([\d.]+) to \$?([\d.]+)", re.IGNORECASE)

    returned_re = re.compile(

        rf"^Uncalled bet \(\$?([\d.]+)\) returned to {hero}\b",

        re.IGNORECASE,

    )



    invested = 0.0

    returned = 0.0

    street_in = 0.0

    for raw_line in raw.replace("\r\n", "\n").splitlines():

        line = raw_line.strip()

        if not line:

            continue

        sm = STREET_RE.match(line)

        if sm:

            label = sm.group(1).upper()

            # Blinds are posted before HOLE CARDS — keep street_in across that marker.

            if label in {"FLOP", "TURN", "RIVER", "SHOWDOWN", "SUMMARY"}:

                street_in = 0.0

            continue

        m = post_re.match(line)

        if m:

            amt = float(m.group(1))

            invested += amt

            street_in += amt

            continue

        m = call_re.match(line)

        if m:

            amt = float(m.group(1))

            invested += amt

            street_in += amt

            continue

        m = bet_re.match(line)

        if m:

            amt = float(m.group(1))

            invested += amt

            street_in += amt

            continue

        m = raise_re.match(line)

        if m:

            to_amt = float(m.group(2))

            delta = max(0.0, to_amt - street_in)

            invested += delta

            street_in = to_amt

            continue

        m = returned_re.match(line)

        if m:

            returned += float(m.group(1))

    return round(max(0.0, invested - returned), 4)





def _detect_all_in_street(raw: str) -> str | None:

    """Street of the last all-in before showdown. None if no all-in."""

    street = "preflop"

    last_ai: str | None = None

    for raw_line in raw.replace("\r\n", "\n").splitlines():

        line = raw_line.strip()

        if not line:

            continue

        sm = STREET_RE.match(line)

        if sm:

            label = sm.group(1).upper()

            if label == "HOLE CARDS":

                street = "preflop"

            elif label == "FLOP":

                street = "flop"

            elif label == "TURN":

                street = "turn"

            elif label == "RIVER":

                street = "river"

            elif label in {"SHOWDOWN", "SUMMARY"}:

                break

            continue

        if ALL_IN_RE.match(line) and street in STREET_BOARD_LEN:

            last_ai = street

    return last_ai





def _hero_involved_in_showdown(raw: str, hero_name: str, shown: dict[str, tuple[str, str]]) -> bool:

    key = hero_name.lower()

    if key in shown:

        return True

    if re.search(rf"^{re.escape(hero_name)}:\s*shows?\s*\[", raw, re.I | re.M):

        return True

    if re.search(rf"Seat \d+:\s*{re.escape(hero_name)}\b.+\bshowed\s*\[", raw, re.I):

        return True

    return False





def compute_hand_all_in_ev(

    raw_text: str,

    *,

    hero_name: str = "Hero",

    hero_net: float,

    hero_hand: str | None = None,

) -> AllInEvBreakdown:

    """Return All-In EV for one hand (money units)."""

    raw = raw_text or ""

    if not raw.strip():

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net)



    ai_street = _detect_all_in_street(raw)

    if ai_street is None or ai_street == "river":

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    shown = _parse_shown_cards(raw)

    if not _hero_involved_in_showdown(raw, hero_name, shown):

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    hero_cards = _parse_hero_cards(raw, hero_name)

    if hero_cards is None and hero_hand and len(hero_hand) >= 4:

        hero_cards = (_norm_card(hero_hand[0:2]), _norm_card(hero_hand[2:4]))

    if hero_cards is None:

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    villains: list[list[str]] = []

    for name, cards in shown.items():

        if name == hero_name.lower():

            continue

        villains.append([cards[0], cards[1]])

    if not villains:

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    full_board = _parse_full_board(raw)

    board_len = STREET_BOARD_LEN[ai_street]

    if len(full_board) <= board_len:

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    board_at_ai = full_board[:board_len]

    pot = _parse_pot_after_fees(raw)

    investment = _hero_investment(raw, hero_name)

    if pot is None or pot <= 0 or investment < 0:

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    try:

        equity = hero_equity([hero_cards[0], hero_cards[1]], villains, board_at_ai)

    except Exception:

        return AllInEvBreakdown(used_equity=False, hand_ev=hero_net, all_in_street=ai_street)



    hand_ev = round(pot * equity - investment, 4)

    return AllInEvBreakdown(

        used_equity=True,

        hand_ev=hand_ev,

        equity=round(equity, 6),

        pot=pot,

        investment=investment,

        all_in_street=ai_street,

    )





def hand_ev_money(

    raw_text: str | None,

    *,

    hero_name: str = "Hero",

    hero_net: float,

    hero_hand: str | None = None,

) -> float:

    return compute_hand_all_in_ev(

        raw_text or "",

        hero_name=hero_name,

        hero_net=hero_net,

        hero_hand=hero_hand,

    ).hand_ev


