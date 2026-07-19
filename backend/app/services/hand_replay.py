"""Build poker-table replay payloads for HUD-stat hand filters."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, HandUpload, PlaySession
from app.parsers.pokerstars import SEAT_RE, TABLE_RE, _assign_positions, extract_hu_postflop_branch
from app.schemas.analysis import (
    ReplayAction,
    ReplayHand,
    ReplaySeat,
    StatHandsResponse,
)
from app.services.hud_stats import HandFlags, _analyze_hand, load_strategy_hands
from app.services.results import resolve_hand_result
from app.services.hand_dedupe import prefer_active_then_dedupe

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

# stat key → which HandFlags field marks a matching hand (numerator event)
STAT_FLAG: dict[str, str] = {
    "vpip": "vpip",
    "pfr": "pfr",
    "three_bet": "three_bet",
    "fold_to_3bet": "fold_to_3bet",
    "four_bet": "four_bet",
    "ats": "ats",
    "fold_bb_steal": "fold_bb_steal",
    "limp": "limp",
    "cbet": "cbet",
    "fold_to_cbet": "fold_to_cbet",
    "wtsd": "went_to_showdown",
    "wsd": "won_at_showdown",
    "wwsf": "won_when_saw_flop",
}

STAT_LABELS = {
    "vpip": "VPIP",
    "pfr": "PFR",
    "three_bet": "3-bet",
    "fold_to_3bet": "Fold to 3-bet",
    "four_bet": "4-bet",
    "ats": "Steal",
    "fold_bb_steal": "Fold BB to steal",
    "limp": "Limp",
    "cbet": "C-bet flop",
    "fold_to_cbet": "Fold to C-bet",
    "af": "AF",
    "afq": "AFq",
    "wtsd": "WTSD",
    "wsd": "W$SD",
    "wwsf": "WWSF",
}


def _matches_stat(flags: HandFlags, stat: str) -> bool:
    if stat in {"af", "afq"}:
        return (flags.postflop_bets + flags.postflop_raises) > 0
    if stat == "wtsd":
        return flags.saw_flop and flags.went_to_showdown
    field = STAT_FLAG.get(stat)
    if not field:
        return False
    return bool(getattr(flags, field, False))


def _parse_board(raw: str) -> list[str]:
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
    return [c.upper() if len(c) == 2 else c for c in board]


def _labels_for_table_size(n: int) -> tuple[str, ...]:
    if n <= 2:
        return ("SB", "BB")
    if n == 3:
        return ("BTN", "SB", "BB")
    if n == 4:
        return ("BTN", "SB", "BB", "CO")
    if n == 5:
        return ("BTN", "SB", "BB", "UTG", "CO")
    if n == 6:
        return ("BTN", "SB", "BB", "UTG", "MP", "CO")
    extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"]
    return ("BTN", "SB", "BB", "UTG", *extra[: max(0, n - 4)])


def _infer_table_size(hand: Hand, raw: str) -> int:
    for line in raw.replace("\r\n", "\n").splitlines():
        tm = TABLE_RE.match(line.strip())
        if tm:
            try:
                return max(2, min(9, int(tm.group("max"))))
            except (TypeError, ValueError):
                break
    # Snapshot rows often omit HH — use how many distinct actors + hero position.
    names = {a.player_name for a in hand.actions if a.player_name}
    if hand.hero_name:
        names.add(hand.hero_name)
    n_act = len(names)
    pos = (hand.hero_position or "").upper()
    # Full-ring seats when hero is not HU blinds-only.
    if pos in {"UTG", "UTG+1", "UTG1", "UTG+2", "UTG2", "MP", "MP1", "HJ", "CO", "BTN"}:
        return max(6, n_act)
    if pos in {"SB", "BB"} and n_act <= 3:
        return max(3, n_act)
    return max(6 if n_act >= 3 else max(2, n_act), n_act)


def _synthetic_seats(hand: Hand, *, max_seats: int) -> list[ReplaySeat]:
    """Build a full table when Seat lines are missing (compact snapshot rows)."""
    labels = list(_labels_for_table_size(max_seats))
    hero = (hand.hero_name or "Hero").strip()
    hero_l = hero.lower()
    hero_pos = (hand.hero_position or "BTN").strip().upper()
    aliases = {
        "HJ": "MP",
        "MP1": "MP",
        "UTG1": "UTG",
        "UTG+1": "UTG",
        "UTG2": "MP",
        "UTG+2": "MP",
    }
    if hero_pos not in labels:
        hero_pos = aliases.get(hero_pos, hero_pos)
    if hero_pos not in labels:
        hero_pos = labels[0]

    # Real nicknames only — from HH actions / hero (never invent "FishN").
    action_names: list[str] = []
    for a in sorted(hand.actions, key=lambda x: x.action_order):
        if a.player_name and a.player_name not in action_names:
            action_names.append(a.player_name)

    other_names = [n for n in action_names if n.lower() != hero_l]
    name_by_pos: dict[str, str] = {hero_pos: hero}
    empty_pos = [p for p in labels if p != hero_pos]

    villain_pos = (hand.villain_position or "").strip().upper()
    if villain_pos and villain_pos not in labels:
        villain_pos = aliases.get(villain_pos, villain_pos)
    if villain_pos in empty_pos and other_names:
        name_by_pos[villain_pos] = other_names[0]
        empty_pos = [p for p in empty_pos if p != villain_pos]
        other_names = other_names[1:]

    for pos, name in zip(empty_pos, other_names):
        name_by_pos[pos] = name

    bb = float(hand.big_blind) if hand.big_blind is not None else 1.0
    if bb <= 0:
        bb = 1.0
    hero_stack = (
        float(hand.stack_bb) * bb
        if hand.stack_bb is not None
        else 100.0 * bb
    )
    default_stack = hero_stack if hero_stack > 0 else 100.0 * bb

    # Always emit a full table. Unknown seats get "Seat N" (not invented nicknames).
    # UTG RFI often has only hero in actions — without this the table shows 1 player.
    out: list[ReplaySeat] = []
    for i, pos in enumerate(labels):
        name = name_by_pos.get(pos) or f"Seat {i + 1}"
        is_hero = pos == hero_pos
        out.append(
            ReplaySeat(
                seat=i + 1,
                name=name,
                position=pos,
                stack=hero_stack if is_hero else default_stack,
                is_hero=is_hero,
                is_button=pos == "BTN" or (max_seats == 2 and pos == "SB"),
                cards=hand.hero_hand if is_hero else None,
            )
        )
    return out


def _merge_seat_roster(
    parsed: list[ReplaySeat],
    hand: Hand,
    *,
    max_seats: int,
) -> list[ReplaySeat]:
    """Pad sparse HH seat lists (e.g. only Hero) to a full table."""
    if len(parsed) >= max_seats:
        return parsed
    syn = _synthetic_seats(hand, max_seats=max_seats)
    by_pos = {s.position: s for s in parsed if s.position}
    hero_parsed = next((s for s in parsed if s.is_hero), None)
    out: list[ReplaySeat] = []
    for s in syn:
        p = by_pos.get(s.position)
        if p is None and s.is_hero and hero_parsed is not None:
            p = hero_parsed
        if p is None:
            out.append(s)
            continue
        out.append(
            ReplaySeat(
                seat=s.seat,
                name=p.name,
                position=s.position,
                stack=p.stack if p.stack is not None else s.stack,
                is_hero=bool(s.is_hero or p.is_hero),
                is_button=s.is_button,
                cards=p.cards or s.cards,
            )
        )
    return out


def _parse_seats(hand: Hand) -> list[ReplaySeat]:
    raw = hand.raw_text or ""
    button = 1
    table_max: int | None = None
    seats: dict[int, tuple[str, float]] = {}
    for line in raw.replace("\r\n", "\n").splitlines():
        tm = TABLE_RE.match(line.strip())
        if tm:
            button = int(tm.group("button"))
            try:
                table_max = max(2, min(9, int(tm.group("max"))))
            except (TypeError, ValueError):
                table_max = None
            continue
        sm = SEAT_RE.match(line.strip())
        if sm:
            seats[int(sm.group("seat"))] = (sm.group("name").strip(), float(sm.group("stack")))

    expected = table_max or _infer_table_size(hand, raw)
    if not seats:
        return _synthetic_seats(hand, max_seats=expected)

    pos_map = _assign_positions(list(seats.keys()), button)
    hero = (hand.hero_name or "Hero").lower()
    out: list[ReplaySeat] = []
    for seat_n, (name, stack) in sorted(seats.items()):
        cards = None
        if name.lower() == hero and hand.hero_hand:
            # hero_hand stored as AhKd style (4 chars)
            cards = hand.hero_hand
        out.append(
            ReplaySeat(
                seat=seat_n,
                name=name,
                position=pos_map.get(seat_n),
                stack=stack,
                is_hero=name.lower() == hero,
                is_button=seat_n == button,
                cards=cards,
            )
        )
    # Incomplete stubs (1 Seat line) used to show Hero alone + pot $0.
    return _merge_seat_roster(out, hand, max_seats=expected)


def _hero_cards(hand: Hand) -> list[str]:
    h = hand.hero_hand or ""
    if len(h) >= 4:
        return [h[0:2], h[2:4]]
    return []


def build_replay_hand(hand: Hand) -> ReplayHand:
    net, net_bb = resolve_hand_result(hand)
    actions = sorted(hand.actions, key=lambda a: a.action_order)
    return ReplayHand(
        id=str(hand.id),
        external_hand_id=hand.external_hand_id,
        played_at=hand.played_at.isoformat() if hand.played_at else None,
        table_name=hand.table_name,
        small_blind=float(hand.small_blind) if hand.small_blind is not None else None,
        big_blind=float(hand.big_blind) if hand.big_blind is not None else None,
        hero_name=hand.hero_name,
        hero_position=hand.hero_position,
        hero_cards=_hero_cards(hand),
        board=_parse_board(hand.raw_text or ""),
        hero_net=round(net, 4),
        hero_net_bb=round(net_bb, 4),
        seats=_parse_seats(hand),
        actions=[
            ReplayAction(
                street=a.street,
                order=a.action_order,
                player_name=a.player_name,
                is_hero=a.is_hero,
                action=a.action,
                amount=float(a.amount) if a.amount is not None else None,
            )
            for a in actions
        ],
        raw_text=(hand.raw_text or "").replace("\r\n", "\n").strip(),
    )


def get_strategy_hand_replay(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    hand_id: UUID,
) -> ReplayHand:
    """Return a single hand replay if it belongs to this user (any strategy)."""
    del strategy_id  # ownership is by user/session, not strategy
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    hand = db.scalar(
        select(Hand)
        .options(selectinload(Hand.actions))
        .where(
            Hand.id == hand_id,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
    )
    if hand is None:
        raise LookupError("Раздача не найдена")
    return build_replay_hand(hand)


def list_stat_hands(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    stat: str,
    *,
    limit: int = 150,
) -> StatHandsResponse:
    key = stat.strip().lower()
    if key not in STAT_LABELS:
        raise ValueError(f"Неизвестный стат: {stat}")

    hands = load_strategy_hands(db, user_id, strategy_id)
    matched: list[Hand] = []
    for hand in hands:
        flags = _analyze_hand(hand)
        if _matches_stat(flags, key):
            matched.append(hand)

    return StatHandsResponse(
        strategy_id=str(strategy_id),
        stat=key,
        label=STAT_LABELS[key],
        total_matched=len(matched),
        hands=[build_replay_hand(h) for h in matched[:limit]],
    )


def _match_hu_branch(hand: Hand, pot_kind: str, matchup: str) -> bool:
    branch = extract_hu_postflop_branch(hand.raw_text)
    if not branch:
        return False
    return (
        branch["pot_kind"].lower() == pot_kind.strip().lower()
        and branch["matchup"].upper() == matchup.strip().upper()
    )


def _hu_label(pot_kind: str, matchup: str) -> str:
    tags = {"srp": "Raise", "3bp": "3-bet", "4bp": "4-bet", "limp": "Limp"}
    tag = tags.get(pot_kind.strip().lower(), pot_kind or "Raise")
    return f"{tag} {matchup.strip().upper()}"


def list_strategy_hu_pot_hands(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    pot_kind: str,
    matchup: str,
    *,
    limit: int = 150,
) -> StatHandsResponse:
    """Hands for one HU pot branch (exactly 2 players after flop)."""
    pk = pot_kind.strip().lower()
    mu = matchup.strip().upper()
    if not pk or not mu:
        raise ValueError("Нужны pot_kind и matchup")

    hands = load_strategy_hands(db, user_id, strategy_id)
    matched = [h for h in hands if _match_hu_branch(h, pk, mu)]
    # Worst first (same idea as branch P/L), then chronological.
    matched.sort(
        key=lambda h: (resolve_hand_result(h)[0], h.played_at or h.id),
    )

    return StatHandsResponse(
        strategy_id=str(strategy_id),
        stat=f"hu:{pk}:{mu}",
        label=_hu_label(pk, mu),
        total_matched=len(matched),
        hands=[build_replay_hand(h) for h in matched[:limit]],
    )


def list_results_hu_pot_hands(
    db: Session,
    user_id: UUID,
    pot_kind: str,
    matchup: str,
    *,
    session_id: UUID | None = None,
    date_from=None,
    date_to=None,
    database_id: UUID | None = None,
    limit: int = 150,
) -> StatHandsResponse:
    """Career/report hands for one HU pot branch."""
    from app.services.results import _in_period

    pk = pot_kind.strip().lower()
    mu = matchup.strip().upper()
    if not pk or not mu:
        raise ValueError("Нужны pot_kind и matchup")

    q = select(PlaySession).where(PlaySession.user_id == user_id)
    if database_id is not None:
        q = q.where(PlaySession.database_id == database_id)
    sessions = list(db.scalars(q))
    if session_id is not None:
        sessions = [s for s in sessions if s.id == session_id]
    session_ids = [s.id for s in sessions]
    if not session_ids:
        return StatHandsResponse(
            strategy_id="results",
            stat=f"hu:{pk}:{mu}",
            label=_hu_label(pk, mu),
            total_matched=0,
            hands=[],
        )

    all_hands = list(
        db.scalars(
            select(Hand)
            .options(selectinload(Hand.actions))
            .where(Hand.session_id.in_(session_ids))
            .order_by(Hand.played_at.asc().nulls_last(), Hand.id.asc())
        )
    )
    hands = prefer_active_then_dedupe(
        [h for h in all_hands if _in_period(h.played_at, date_from, date_to)],
        {s.id: (s.status or "active") for s in sessions},
    )
    matched = [h for h in hands if _match_hu_branch(h, pk, mu)]
    matched.sort(key=lambda h: (resolve_hand_result(h)[0], h.played_at or h.id))

    return StatHandsResponse(
        strategy_id="results",
        stat=f"hu:{pk}:{mu}",
        label=_hu_label(pk, mu),
        total_matched=len(matched),
        hands=[build_replay_hand(h) for h in matched[:limit]],
    )
