"""Parse PokerStars / GGPoker text hand histories into structured hands."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from app.services.hand_codes import cards_to_hand_code

HAND_SPLIT_RE = re.compile(
    r"(?=PokerStars Hand #)|(?=Poker Hand #)|(?=PokerStars Zoom Hand #)",
    re.IGNORECASE,
)
HEADER_RE = re.compile(
    r"^(?:PokerStars(?: Zoom)? Hand|Poker Hand) #(?P<hid>[^\s:]+):\s*"
    r".*?\((?P<sb>\$?[\d.]+)/(?P<bb>\$?[\d.]+).*?\)\s*-\s*(?P<dt>\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})",
    re.IGNORECASE,
)
TABLE_RE = re.compile(
    r"^Table '(?P<table>[^']+)'\s+(?P<max>\d+)-max\s+Seat #(?P<button>\d+) is the button",
    re.IGNORECASE,
)
SEAT_RE = re.compile(
    r"^Seat (?P<seat>\d+):\s+(?P<name>.+?)\s+\(\$?(?P<stack>[\d.]+) in chips\)",
    re.IGNORECASE,
)
DEALT_RE = re.compile(
    r"^Dealt to (?P<name>.+?)(?:\s+\[(?P<c1>[2-9TJQKA][shdc])\s+(?P<c2>[2-9TJQKA][shdc])\])?\s*$",
    re.IGNORECASE,
)
ACTION_RE = re.compile(
    r"^(?P<name>.+?):\s+"
    r"(?P<verb>folds|checks|calls|bets|raises|posts)\b"
    r"(?:\s+(?:small blind|big blind|the ante))?"
    r"(?:\s+\$?(?P<a1>[\d.]+))?"
    r"(?:\s+to\s+\$?(?P<a2>[\d.]+))?",
    re.IGNORECASE,
)
# GG Rush&Cash run-it-twice: *** FIRST FLOP *** / *** SECOND RIVER ***
STREET_RE = re.compile(
    r"^\*\*\*\s+(?:(FIRST|SECOND)\s+)?(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*",
    re.IGNORECASE,
)


def street_from_marker(prefix: str | None, label: str) -> str:
    """Map HH street markers to engine streets. SECOND run → summary (no more acts)."""
    lab = (label or "").upper().strip()
    pref = (prefix or "").upper().strip()
    if pref == "SECOND":
        return "summary"
    if lab == "HOLE CARDS":
        return "preflop"
    if lab == "FLOP":
        return "flop"
    if lab == "TURN":
        return "turn"
    if lab == "RIVER":
        return "river"
    return "summary"

SIX_MAX = ("BTN", "SB", "BB", "UTG", "MP", "CO")
FIVE_MAX = ("BTN", "SB", "BB", "UTG", "CO")
FOUR_MAX = ("BTN", "SB", "BB", "CO")
THREE_MAX = ("BTN", "SB", "BB")


@dataclass
class ParsedAction:
    street: str
    action_order: int
    player_name: str
    is_hero: bool
    action: str
    amount: float | None = None


@dataclass
class ParsedHand:
    external_hand_id: str
    raw_text: str
    played_at: datetime | None = None
    table_name: str | None = None
    small_blind: float | None = None
    big_blind: float | None = None
    hero_name: str | None = None
    hero_position: str | None = None
    hero_hand: str | None = None
    hero_hand_code: str | None = None
    detected_spot: str | None = None
    villain_position: str | None = None
    stack_bb: float | None = None
    hero_preflop_action: str | None = None
    hero_net: float | None = None
    hero_net_bb: float | None = None
    went_to_showdown: bool = False
    hero_net_wsd: float | None = None
    hero_net_wsd_bb: float | None = None
    hero_net_wwsd: float | None = None
    hero_net_wwsd_bb: float | None = None
    actions: list[ParsedAction] = field(default_factory=list)


def _money(value: str | None) -> float | None:
    if value is None:
        return None
    return float(value.replace("$", ""))


def _normalize_verb(verb: str, has_to: bool) -> str | None:
    v = verb.lower()
    if v == "folds":
        return "fold"
    if v == "checks":
        return "call"
    if v == "calls":
        return "call"
    if v in {"bets", "raises"}:
        return "raise"
    if v == "posts":
        return None
    if has_to:
        return "raise"
    return None


def _assign_positions(seat_order: list[int], button: int) -> dict[int, str]:
    if not seat_order:
        return {}
    seats = sorted(seat_order)
    if button not in seats:
        button = seats[0]
    idx = seats.index(button)
    rotated = seats[idx:] + seats[:idx]
    n = len(rotated)
    if n == 2:
        labels = ("SB", "BB")  # button is SB in HU
    elif n == 3:
        labels = THREE_MAX
    elif n == 4:
        labels = FOUR_MAX
    elif n == 5:
        labels = FIVE_MAX
    else:
        labels = SIX_MAX[:n] if n < 6 else SIX_MAX
        if n > 6:
            # 7–9: BTN SB BB UTG ... CO
            extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"]
            labels = ("BTN", "SB", "BB", "UTG", *extra[: n - 4])
    return {seat: labels[i] for i, seat in enumerate(rotated)}


def extract_hu_postflop_branch(raw_text: str | None) -> dict[str, str] | None:
    """Heads-up after flop: pot tag + matchup `BBvsSB` (last raiser vs caller).

    Returns None if the hand never reached flop or more/less than 2 players saw flop.
    """
    if not raw_text or not raw_text.strip():
        return None

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    button = 1
    seats: dict[int, str] = {}
    street = "preflop"
    folded: set[str] = set()
    seated_names: set[str] = set()
    raise_count = 0
    last_raiser: str | None = None
    saw_flop = False
    hero_name: str | None = None

    for line in lines:
        street_m = STREET_RE.match(line)
        if street_m:
            street = street_from_marker(street_m.group(1), street_m.group(2))
            if street == "flop":
                saw_flop = True
            continue

        if street == "summary":
            continue

        table_m = TABLE_RE.match(line)
        if table_m:
            button = int(table_m.group("button"))
            continue

        seat_m = SEAT_RE.match(line)
        if seat_m:
            if re.search(r"\bsitting out\b", line, re.IGNORECASE):
                continue
            name = seat_m.group("name").strip()
            seats[int(seat_m.group("seat"))] = name
            seated_names.add(name)
            continue

        dealt_m = DEALT_RE.match(line)
        if dealt_m:
            hero_name = dealt_m.group("name").strip()
            continue

        if street != "preflop":
            continue

        act_m = ACTION_RE.match(line)
        if not act_m:
            continue
        name = act_m.group("name").strip()
        verb = act_m.group("verb").lower()
        if verb == "folds":
            folded.add(name)
        elif verb in {"raises", "bets"}:
            raise_count += 1
            last_raiser = name

    if not saw_flop:
        return None

    live = [n for n in seated_names if n not in folded]
    if len(live) != 2:
        return None

    pos_map = _assign_positions(list(seats.keys()), button)
    name_to_pos = {name: pos_map[seat] for seat, name in seats.items() if seat in pos_map}
    a_name, b_name = live[0], live[1]
    a_pos = name_to_pos.get(a_name)
    b_pos = name_to_pos.get(b_name)
    if not a_pos or not b_pos:
        return None

    # Matchup = last preflop raiser vs the other (tree-style BBvsSB).
    if last_raiser and last_raiser in live:
        raiser_pos = name_to_pos.get(last_raiser)
        other = b_pos if last_raiser == a_name else a_pos
        if raiser_pos and other and raiser_pos != other:
            matchup = f"{raiser_pos}vs{other}"
        else:
            matchup = f"{a_pos}vs{b_pos}"
    else:
        order = ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"]
        pair = sorted([a_pos, b_pos], key=lambda p: order.index(p) if p in order else 99)
        matchup = f"{pair[0]}vs{pair[1]}"

    if raise_count >= 3:
        pot_kind, pot_tag = "4bp", "4-bet"
    elif raise_count == 2:
        pot_kind, pot_tag = "3bp", "3-bet"
    elif raise_count == 0:
        pot_kind, pot_tag = "limp", "Limp"
    else:
        pot_kind, pot_tag = "srp", "Raise"

    # Prefer real Hero seat when labeling hero/villain fields.
    hero_pos, villain_pos = a_pos, b_pos
    if hero_name and hero_name in live:
        hero_pos = name_to_pos.get(hero_name) or a_pos
        other_name = b_name if hero_name == a_name else a_name
        villain_pos = name_to_pos.get(other_name) or b_pos

    return {
        "matchup": matchup,
        "pot_kind": pot_kind,
        "pot_tag": pot_tag,
        "spot_key": {
            "limp": "limp",
            "srp": "vs_open",
            "3bp": "vs_3bet",
            "4bp": "vs_4bet",
        }.get(pot_kind, "vs_open"),
        "hero_position": hero_pos,
        "villain_position": villain_pos,
        "label": f"{pot_tag} {matchup}",
    }


def compute_hero_net(block: str, hero_name: str = "Hero", big_blind: float | None = None) -> tuple[float | None, float | None]:
    """Return (net $, net BB) for hero from a single hand history block."""
    if not block.strip():
        return None, None

    hero = re.escape(hero_name)
    invested = 0.0
    street_in = 0.0
    collected = 0.0
    returned = 0.0
    saw_money = False

    post_re = re.compile(rf"^{hero}: posts .+?\$?([\d.]+)", re.IGNORECASE)
    call_re = re.compile(rf"^{hero}: calls \$?([\d.]+)", re.IGNORECASE)
    bet_re = re.compile(rf"^{hero}: bets \$?([\d.]+)", re.IGNORECASE)
    raise_re = re.compile(rf"^{hero}: raises \$?([\d.]+) to \$?([\d.]+)", re.IGNORECASE)
    returned_re = re.compile(
        rf"^Uncalled bet \(\$?([\d.]+)\) returned to {hero}\b", re.IGNORECASE
    )
    collected_re = re.compile(rf"^{hero} collected \$?([\d.]+)", re.IGNORECASE)
    summary_won_re = re.compile(
        rf"^Seat \d+:\s+{hero}\b.+(?:won|collected) \(\$?([\d.]+)\)",
        re.IGNORECASE,
    )

    for raw in block.replace("\r\n", "\n").splitlines():
        line = raw.strip()
        if not line:
            continue
        sm = STREET_RE.match(line)
        if sm:
            # Blinds are posted BEFORE "*** HOLE CARDS ***". Resetting street_in
            # there double-counts the blind on the next raise ("to $X").
            mapped = street_from_marker(sm.group(1), sm.group(2))
            if mapped in {"flop", "turn", "river", "summary"}:
                street_in = 0.0
            continue

        m = post_re.match(line)
        if m:
            amt = float(m.group(1))
            invested += amt
            street_in += amt
            saw_money = True
            continue

        m = call_re.match(line)
        if m:
            amt = float(m.group(1))
            invested += amt
            street_in += amt
            saw_money = True
            continue

        m = bet_re.match(line)
        if m:
            amt = float(m.group(1))
            invested += amt
            street_in += amt
            saw_money = True
            continue

        m = raise_re.match(line)
        if m:
            to_amt = float(m.group(2))
            delta = max(0.0, to_amt - street_in)
            invested += delta
            street_in = to_amt
            saw_money = True
            continue

        m = returned_re.match(line)
        if m:
            returned += float(m.group(1))
            saw_money = True
            continue

        m = collected_re.match(line)
        if m:
            collected += float(m.group(1))
            saw_money = True
            continue

        # Fallback if action lines missed the win (avoid double-count).
        if collected == 0:
            m = summary_won_re.match(line)
            if m:
                collected += float(m.group(1))
                saw_money = True

    if not saw_money and invested == 0 and collected == 0:
        return 0.0, 0.0 if big_blind else None

    net = round(collected + returned - invested, 4)
    net_bb = round(net / big_blind, 4) if big_blind and big_blind > 0 else None
    return net, net_bb


_REVEAL_ACTION_RE = re.compile(
    r"^(?P<name>[^:\n]+?):\s*shows?\s*\[(?P<cards>[2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]",
    re.IGNORECASE | re.MULTILINE,
)
_REVEAL_SUMMARY_RE = re.compile(
    r"^Seat\s+\d+:\s*(?P<name>.+?)\s+(?:\([^)]*\)\s+)?(?:showed|mucked)\s*"
    r"\[(?P<cards>[2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]",
    re.IGNORECASE | re.MULTILINE,
)


def _players_who_revealed_cards(block: str) -> set[str]:
    """Player names (lower) that tabled/mucked hole cards in the HH."""
    names: set[str] = set()
    for re_obj in (_REVEAL_ACTION_RE, _REVEAL_SUMMARY_RE):
        for m in re_obj.finditer(block):
            name = m.group("name").strip()
            name = re.sub(r"\s+\([^)]*\)\s*$", "", name).strip().lower()
            if name and "***" not in name:
                names.add(name)
    return names


def detect_went_to_showdown(block: str, hero_name: str = "Hero") -> bool:
    """True if hero went to a *contested* showdown (H2N Won-at-SD / blue line).

    GG prints ``*** SHOWDOWN ***`` and even ``Hero showed [..] and won`` on
    uncontested pots where everyone folded. H2N counts those as *without*
    showdown. Require hero + at least one other player to reveal hole cards.
    """
    revealed = _players_who_revealed_cards(block)
    hero_key = hero_name.strip().lower()
    if hero_key not in revealed:
        return False
    return any(name != hero_key for name in revealed)


def split_net_by_showdown(
    hero_net: float | None,
    hero_net_bb: float | None,
    went_to_showdown: bool,
) -> tuple[float | None, float | None, float | None, float | None]:
    """Return (wsd, wsd_bb, wwsd, wwsd_bb). Entire hand net goes into one bucket."""
    if hero_net is None:
        return None, None, None, None
    zero_bb = 0.0 if hero_net_bb is not None else None
    if went_to_showdown:
        return hero_net, hero_net_bb, 0.0, zero_bb
    return 0.0, zero_bb, hero_net, hero_net_bb


def extract_showdown_nets(
    block: str,
    hero_name: str = "Hero",
    big_blind: float | None = None,
    hero_net: float | None = None,
    hero_net_bb: float | None = None,
) -> tuple[bool, float | None, float | None, float | None, float | None]:
    """Detect showdown and split hero net into WSD / WWSD buckets."""
    went = detect_went_to_showdown(block, hero_name=hero_name)
    if hero_net is None:
        hero_net, hero_net_bb = compute_hero_net(block, hero_name=hero_name, big_blind=big_blind)
    wsd, wsd_bb, wwsd, wwsd_bb = split_net_by_showdown(hero_net, hero_net_bb, went)
    return went, wsd, wsd_bb, wwsd, wwsd_bb


def _detect_spot(actions_before_hero: list[str], hero_action: str) -> str:
    raises = 0
    limps = 0
    calls_after_raise = 0
    for act in actions_before_hero:
        if act == "raise":
            raises += 1
            calls_after_raise = 0
        elif act == "call":
            if raises == 0:
                limps += 1
            else:
                calls_after_raise += 1

    if raises == 0:
        if limps > 0 and hero_action == "raise":
            return "iso"
        return "rfi"
    if raises == 1:
        if calls_after_raise >= 1 and hero_action == "raise":
            return "squeeze"
        return "vs_open"
    if raises == 2:
        return "vs_3bet"
    return "vs_4bet"


def _parse_one(block: str) -> ParsedHand | None:
    lines = [ln.rstrip() for ln in block.strip().splitlines() if ln.strip()]
    if not lines:
        return None

    header = HEADER_RE.match(lines[0])
    if not header:
        return None

    hid = header.group("hid").strip()
    sb = _money(header.group("sb"))
    bb = _money(header.group("bb"))
    try:
        played_at = datetime.strptime(header.group("dt"), "%Y/%m/%d %H:%M:%S")
    except ValueError:
        played_at = None

    table_name = None
    button = 1
    seats: dict[int, tuple[str, float]] = {}
    hero_name = "Hero"
    hero_cards: tuple[str, str] | None = None
    street = "preflop"
    actions: list[ParsedAction] = []
    action_order = 0
    preflop_voluntary: list[tuple[str, str]] = []  # (player, action)

    for line in lines[1:]:
        street_m = STREET_RE.match(line)
        if street_m:
            street = street_from_marker(street_m.group(1), street_m.group(2))
            continue

        if street == "summary":
            continue

        table_m = TABLE_RE.match(line)
        if table_m:
            table_name = table_m.group("table")
            button = int(table_m.group("button"))
            continue

        seat_m = SEAT_RE.match(line)
        if seat_m:
            seats[int(seat_m.group("seat"))] = (seat_m.group("name").strip(), float(seat_m.group("stack")))
            continue

        dealt_m = DEALT_RE.match(line)
        if dealt_m:
            name = dealt_m.group("name").strip()
            if dealt_m.group("c1") and dealt_m.group("c2"):
                hero_name = name
                hero_cards = (dealt_m.group("c1"), dealt_m.group("c2"))
            continue

        act_m = ACTION_RE.match(line)
        if act_m and street in {"preflop", "flop", "turn", "river"}:
            name = act_m.group("name").strip()
            verb = act_m.group("verb")
            amount = _money(act_m.group("a2") or act_m.group("a1"))
            norm = _normalize_verb(verb, bool(act_m.group("a2")))
            if norm is None:
                continue
            action_order += 1
            actions.append(
                ParsedAction(
                    street=street,
                    action_order=action_order,
                    player_name=name,
                    is_hero=name.lower() == hero_name.lower(),
                    action=norm,
                    amount=amount,
                )
            )
            if street == "preflop":
                # Checks are stored as call on the action row (HUD), but for
                # spot/decision they are folds (BB option), not limps.
                pf_act = "fold" if verb.lower() == "checks" else norm
                preflop_voluntary.append((name, pf_act))

    pos_map = _assign_positions(list(seats.keys()), button)
    name_to_seat = {name: seat for seat, (name, _) in seats.items()}
    hero_seat = name_to_seat.get(hero_name)
    hero_position = pos_map.get(hero_seat) if hero_seat is not None else None
    stack_bb = None
    if hero_seat is not None and bb:
        stack_bb = seats[hero_seat][1] / bb

    hero_hand = None
    hero_hand_code = None
    if hero_cards:
        c1, c2 = hero_cards[0], hero_cards[1]
        hero_hand = f"{c1}{c2}"
        try:
            hero_hand_code = cards_to_hand_code(c1, c2)
        except ValueError:
            hero_hand_code = None

    hero_preflop_action = None
    detected_spot = None
    villain_position = None
    before: list[str] = []
    before_players: list[str] = []
    for player, act in preflop_voluntary:
        if player.lower() == hero_name.lower():
            hero_preflop_action = act
            detected_spot = _detect_spot(before, act)
            for p, a in zip(before_players, before, strict=True):
                if a == "raise":
                    seat = name_to_seat.get(p)
                    villain_position = pos_map.get(seat) if seat is not None else None
            break
        before.append(act)
        before_players.append(player)

    hero_net, hero_net_bb = compute_hero_net(block, hero_name=hero_name, big_blind=bb)
    went_to_showdown, hero_net_wsd, hero_net_wsd_bb, hero_net_wwsd, hero_net_wwsd_bb = (
        extract_showdown_nets(
            block,
            hero_name=hero_name,
            big_blind=bb,
            hero_net=hero_net,
            hero_net_bb=hero_net_bb,
        )
    )

    return ParsedHand(
        external_hand_id=hid[:64],
        raw_text=block.strip(),
        played_at=played_at,
        table_name=table_name,
        small_blind=sb,
        big_blind=bb,
        hero_name=hero_name,
        hero_position=hero_position,
        hero_hand=hero_hand[:4] if hero_hand else None,
        hero_hand_code=hero_hand_code,
        detected_spot=detected_spot,
        villain_position=villain_position,
        stack_bb=stack_bb,
        hero_preflop_action=hero_preflop_action,
        hero_net=hero_net,
        hero_net_bb=hero_net_bb,
        went_to_showdown=went_to_showdown,
        hero_net_wsd=hero_net_wsd,
        hero_net_wsd_bb=hero_net_wsd_bb,
        hero_net_wwsd=hero_net_wwsd,
        hero_net_wwsd_bb=hero_net_wwsd_bb,
        actions=actions,
    )


def parse_pokerstars(text: str) -> list[ParsedHand]:
    """Parse PokerStars / GGPoker HH text into structured hands."""
    if not text or not text.strip():
        return []
    # Normalize newlines and ensure split works when file starts with Poker Hand
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not re.search(r"Poker(?:Stars)?(?: Zoom)? Hand #", normalized, re.IGNORECASE):
        return []
    parts = HAND_SPLIT_RE.split(normalized)
    hands: list[ParsedHand] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        parsed = _parse_one(part)
        if parsed is not None:
            hands.append(parsed)
    return hands
