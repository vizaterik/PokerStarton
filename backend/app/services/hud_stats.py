"""Hero HUD stats (H2N-style) aggregated from stored hand histories."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, PlaySession
from app.parsers.pokerstars import detect_went_to_showdown, extract_showdown_nets
from app.schemas.analysis import AnalysisCurvePoint, HudStat, PositionHudRow, StrategyAnalysis
from app.services.all_in_ev import hand_ev_money
from app.services.strategy_match import hand_is_deviation, load_spot_maps
from app.services.hand_dedupe import prefer_active_then_dedupe
from app.services.results import resolve_hand_result, resolve_showdown_split

FLOP_DEALT_RE = re.compile(r"\*\*\*\s+FLOP\s+\*\*\*", re.IGNORECASE)
STREET_MARK_RE = re.compile(
    r"^\*\*\*\s+(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*",
    re.IGNORECASE,
)
ALLIN_ACTION_RE = re.compile(
    r"^(?P<name>.+?):\s+(?:folds|checks|calls|bets|raises|posts)\b.*\band is all-in\b",
    re.IGNORECASE,
)


def _f(value: Decimal | float | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def _pct(num: int, den: int) -> float | None:
    """H2N: (cases / opportunities) * 100, one decimal place."""
    if den <= 0:
        return None
    return round(100.0 * num / den, 1)


def _allin_names_by_street(raw: str) -> dict[str, set[str]]:
    """Players who went all-in on each street (from HH text)."""
    out: dict[str, set[str]] = {
        "preflop": set(),
        "flop": set(),
        "turn": set(),
        "river": set(),
    }
    street = "preflop"
    for line in (raw or "").splitlines():
        mark = STREET_MARK_RE.match(line.strip())
        if mark:
            label = mark.group(1).upper()
            if label == "HOLE CARDS":
                street = "preflop"
            elif label == "FLOP":
                street = "flop"
            elif label == "TURN":
                street = "turn"
            elif label == "RIVER":
                street = "river"
            else:
                street = "summary"
            continue
        if street == "summary" or street not in out:
            continue
        m = ALLIN_ACTION_RE.match(line.strip())
        if m:
            out[street].add(m.group("name").strip().lower())
    return out


def _ratio(num: float, den: float) -> float | None:
    if den <= 0:
        return None
    return round(num / den, 2)


def _is_money_call(action: str, amount: Decimal | float | None) -> bool:
    """True call (put chips in). Checks are stored as call with no amount."""
    return action == "call" and amount is not None and float(amount) > 0


STEAL_POS = {"CO", "BTN", "SB"}


@dataclass
class OppCounters:
    hands: int = 0
    vpip_opp: int = 0
    vpip: int = 0
    pfr_opp: int = 0
    pfr: int = 0
    three_bet_opp: int = 0
    three_bet: int = 0
    fold_to_3bet_opp: int = 0
    fold_to_3bet: int = 0
    four_bet_opp: int = 0
    four_bet: int = 0
    ats_opp: int = 0
    ats: int = 0
    fold_bb_steal_opp: int = 0
    fold_bb_steal: int = 0
    limp: int = 0
    saw_flop: int = 0
    cbet_opp: int = 0
    cbet: int = 0
    fold_to_cbet_opp: int = 0
    fold_to_cbet: int = 0
    bets: int = 0
    raises: int = 0
    calls: int = 0
    wtsd_opp: int = 0
    wtsd: int = 0
    wsd_won: int = 0
    wwsf_opp: int = 0
    wwsf: int = 0
    profit_bb: float = 0.0
    profit_money: float = 0.0


@dataclass
class HandFlags:
    vpip_opp: bool = False
    vpip: bool = False
    pfr_opp: bool = False
    pfr: bool = False
    three_bet: bool = False
    three_bet_opp: bool = False
    fold_to_3bet: bool = False
    fold_to_3bet_opp: bool = False
    four_bet: bool = False
    four_bet_opp: bool = False
    ats: bool = False
    ats_opp: bool = False
    fold_bb_steal: bool = False
    fold_bb_steal_opp: bool = False
    limp: bool = False
    saw_flop: bool = False
    cbet: bool = False
    cbet_opp: bool = False
    fold_to_cbet: bool = False
    fold_to_cbet_opp: bool = False
    postflop_bets: int = 0
    postflop_raises: int = 0
    postflop_calls: int = 0
    went_to_showdown: bool = False
    won_at_showdown: bool = False
    won_when_saw_flop: bool = False


def _hero_saw_flop(hand: Hand, actions: list) -> bool:
    """H2N: hero saw the flop if a flop was dealt and hero did not fold preflop.

    Must NOT use \"any flop action at the table\" — that counts folded-preflop
    hands whenever others play a flop and tanks WTSD / WWSF denominators.
    Preflop all-ins still count (no hero postflop action, but flop is dealt).
    """
    raw = hand.raw_text or ""
    flop_dealt = bool(FLOP_DEALT_RE.search(raw)) or any(a.street == "flop" for a in actions)
    if not flop_dealt:
        return False
    hero_folded_pre = any(
        a.is_hero and a.street == "preflop" and a.action == "fold" for a in actions
    )
    return not hero_folded_pre


def _analyze_hand(hand: Hand) -> HandFlags:
    """Per-hand H2N flags: cases + opportunities for core HUD stats."""
    flags = HandFlags()
    actions = sorted(hand.actions, key=lambda a: (a.street, a.action_order))
    preflop = [a for a in actions if a.street == "preflop"]
    flop = [a for a in actions if a.street == "flop"]
    postflop = [a for a in actions if a.street in {"flop", "turn", "river"}]
    hero_name = (hand.hero_name or "Hero").lower()
    allin = _allin_names_by_street(hand.raw_text or "")
    pf_allin = allin["preflop"]

    flags.saw_flop = _hero_saw_flop(hand, actions)
    flags.went_to_showdown = detect_went_to_showdown(hand.raw_text, hand.hero_name or "Hero")
    net, _net_bb = resolve_hand_result(hand)
    if flags.went_to_showdown and net > 0:
        flags.won_at_showdown = True
    if flags.saw_flop and net > 0:
        flags.won_when_saw_flop = True

    raises_before = 0
    limps_before = 0
    hero_acted = False
    hero_folded_pre = False
    hero_open_raised = False
    opener_name: str | None = None
    opener_allin = False
    faced_3bet_after_open = False
    three_bettor_allin = False

    for act in preflop:
        actor = (act.player_name or "").lower()
        actor_ai = actor in pf_allin

        if act.is_hero:
            if hero_folded_pre:
                continue
            if not hero_acted:
                hero_acted = True
                pos = (hand.hero_position or "").upper()

                # VPIP/PFR opportunity: dealt in and facing a live decision
                # (exclude uncallable all-in jam with no raise option left).
                uncallable_jam = raises_before == 1 and opener_allin
                flags.vpip_opp = True
                flags.pfr_opp = not uncallable_jam

                if act.action == "raise":
                    flags.vpip = True
                    flags.pfr = True
                    if raises_before == 0:
                        hero_open_raised = True
                    elif raises_before == 1 and not opener_allin:
                        flags.three_bet = True
                    elif raises_before >= 2:
                        flags.four_bet = True
                elif _is_money_call(act.action, act.amount):
                    flags.vpip = True
                    if raises_before == 0:
                        flags.limp = True
                elif act.action == "fold":
                    hero_folded_pre = True

                # 3-bet opp: exactly one open-raise that is NOT an all-in jam
                if raises_before == 1 and not opener_allin:
                    flags.three_bet_opp = True
                if raises_before >= 2:
                    flags.four_bet_opp = True

                if raises_before == 0 and limps_before == 0 and pos in STEAL_POS:
                    flags.ats_opp = True
                    if act.action == "raise":
                        flags.ats = True

                if (
                    pos == "BB"
                    and raises_before == 1
                    and limps_before == 0
                    and opener_name is not None
                    and not opener_allin
                ):
                    open_pos = (hand.villain_position or "").upper()
                    if open_pos in STEAL_POS:
                        flags.fold_bb_steal_opp = True
                        if act.action == "fold":
                            flags.fold_bb_steal = True
            else:
                if hero_open_raised and faced_3bet_after_open and not three_bettor_allin:
                    flags.fold_to_3bet_opp = True
                    flags.four_bet_opp = True
                    if act.action == "fold":
                        flags.fold_to_3bet = True
                        hero_folded_pre = True
                    elif act.action == "raise":
                        flags.four_bet = True
                elif act.action == "fold":
                    hero_folded_pre = True
            continue

        if act.action == "raise":
            raises_before += 1
            if raises_before == 1:
                opener_name = act.player_name
                opener_allin = actor_ai
            if hero_open_raised and not faced_3bet_after_open:
                faced_3bet_after_open = True
                three_bettor_allin = actor_ai
        elif _is_money_call(act.action, act.amount) and raises_before == 0:
            limps_before += 1

    if hero_open_raised and faced_3bet_after_open and not three_bettor_allin:
        flags.fold_to_3bet_opp = True
        flags.four_bet_opp = True

    # Dealt but never acted (walk / disconnect) — still a VPIP sample if cards dealt
    if not hero_acted and preflop:
        flags.vpip_opp = True
        flags.pfr_opp = True

    # --- C-bet / Fold to C-bet (flop) — H2N: checked to aggressor, live chips ---
    last_pf_aggressor: str | None = None
    for act in preflop:
        if act.action == "raise":
            last_pf_aggressor = act.player_name
    hero_allin_pf = hero_name in pf_allin
    # Dead money: either side already all-in preflop → no postflop bet sample
    postflop_betting_live = not hero_allin_pf and not (
        last_pf_aggressor and last_pf_aggressor.lower() in pf_allin
    )

    if (
        last_pf_aggressor
        and last_pf_aggressor.lower() == hero_name
        and flop
        and flags.saw_flop
        and postflop_betting_live
        and not hero_folded_pre
    ):
        # Checked to hero: only checks before hero's first flop action
        prior_agg = False
        hero_seen = False
        for act in flop:
            if act.is_hero:
                hero_seen = True
                if not prior_agg:
                    flags.cbet_opp = True
                    if act.action == "raise":
                        flags.cbet = True
                break
            if act.action == "raise":
                prior_agg = True  # donk — not a cbet spot
        if not hero_seen and not prior_agg and flop:
            # Checked through without hero acting (rare) — still cbet opp if first to act
            first = flop[0]
            if first.is_hero or all(
                a.action == "call" and not _is_money_call(a.action, a.amount) for a in flop
            ):
                flags.cbet_opp = True

    if (
        last_pf_aggressor
        and last_pf_aggressor.lower() != hero_name
        and flop
        and flags.saw_flop
        and postflop_betting_live
        and not hero_folded_pre
    ):
        # True cbet: PFA makes the first bet on flop (only checks before)
        pfa = last_pf_aggressor.lower()
        seen_agg = False
        for act in flop:
            actor = (act.player_name or "").lower()
            if not seen_agg:
                if act.action == "raise":
                    if actor == pfa:
                        seen_agg = True
                        flags.fold_to_cbet_opp = True
                    else:
                        break  # donk / other line — not fold-to-cbet
                continue
            if act.is_hero:
                if act.action == "fold":
                    flags.fold_to_cbet = True
                break

    for act in postflop:
        if not act.is_hero:
            continue
        if act.action == "raise":
            street_acts = [
                a
                for a in postflop
                if a.street == act.street and a.action_order < act.action_order
            ]
            prior_agg = any(a.action == "raise" for a in street_acts)
            if prior_agg:
                flags.postflop_raises += 1
            else:
                flags.postflop_bets += 1
        elif _is_money_call(act.action, act.amount):
            flags.postflop_calls += 1

    return flags


def _apply(counters: OppCounters, flags: HandFlags, hand: Hand) -> None:
    counters.hands += 1
    net_m, net_bb = resolve_hand_result(hand)
    counters.profit_bb += net_bb
    counters.profit_money += net_m
    if flags.vpip_opp:
        counters.vpip_opp += 1
    if flags.vpip:
        counters.vpip += 1
    if flags.pfr_opp:
        counters.pfr_opp += 1
    if flags.pfr:
        counters.pfr += 1
    if flags.three_bet_opp:
        counters.three_bet_opp += 1
    if flags.three_bet:
        counters.three_bet += 1
    if flags.fold_to_3bet_opp:
        counters.fold_to_3bet_opp += 1
    if flags.fold_to_3bet:
        counters.fold_to_3bet += 1
    if flags.four_bet_opp:
        counters.four_bet_opp += 1
    if flags.four_bet:
        counters.four_bet += 1
    if flags.ats_opp:
        counters.ats_opp += 1
    if flags.ats:
        counters.ats += 1
    if flags.fold_bb_steal_opp:
        counters.fold_bb_steal_opp += 1
    if flags.fold_bb_steal:
        counters.fold_bb_steal += 1
    if flags.limp:
        counters.limp += 1
    if flags.saw_flop:
        counters.saw_flop += 1
        counters.wtsd_opp += 1
        counters.wwsf_opp += 1
    if flags.cbet_opp:
        counters.cbet_opp += 1
    if flags.cbet:
        counters.cbet += 1
    if flags.fold_to_cbet_opp:
        counters.fold_to_cbet_opp += 1
    if flags.fold_to_cbet:
        counters.fold_to_cbet += 1
    counters.bets += flags.postflop_bets
    counters.raises += flags.postflop_raises
    counters.calls += flags.postflop_calls
    if flags.saw_flop and flags.went_to_showdown:
        counters.wtsd += 1
        if flags.won_at_showdown:
            counters.wsd_won += 1
    if flags.won_when_saw_flop:
        counters.wwsf += 1


def _stat(
    key: str,
    label: str,
    cases: int,
    opportunities: int,
    unit: str = "pct",
) -> HudStat:
    value = _pct(cases, opportunities) if unit == "pct" else None
    return HudStat(
        key=key,
        label=label,
        value=value,
        samples=opportunities,
        cases=cases,
        opportunities=opportunities,
        unit=unit,
    )


def _counters_to_stats(c: OppCounters) -> list[HudStat]:
    af_den = float(c.calls)
    af_num = float(c.bets + c.raises)
    afq_den = int(c.bets + c.raises + c.calls)
    af_stat = HudStat(
        key="af",
        label="AF",
        value=_ratio(af_num, af_den),
        samples=afq_den,
        cases=c.bets + c.raises,
        opportunities=afq_den,
        unit="ratio",
    )
    return [
        _stat("vpip", "VPIP", c.vpip, c.vpip_opp or c.hands),
        _stat("pfr", "PFR", c.pfr, c.pfr_opp or c.hands),
        _stat("three_bet", "3-bet", c.three_bet, c.three_bet_opp),
        _stat("fold_to_3bet", "Fold to 3-bet", c.fold_to_3bet, c.fold_to_3bet_opp),
        _stat("four_bet", "4-bet", c.four_bet, c.four_bet_opp),
        _stat("ats", "Steal", c.ats, c.ats_opp),
        _stat("fold_bb_steal", "Fold BB to steal", c.fold_bb_steal, c.fold_bb_steal_opp),
        _stat("limp", "Limp", c.limp, c.vpip_opp or c.hands),
        _stat("cbet", "C-bet flop", c.cbet, c.cbet_opp),
        _stat("fold_to_cbet", "Fold to C-bet", c.fold_to_cbet, c.fold_to_cbet_opp),
        af_stat,
        _stat("afq", "AFq", c.bets + c.raises, afq_den),
        _stat("wtsd", "WTSD", c.wtsd, c.wtsd_opp),
        _stat("wsd", "W$SD", c.wsd_won, c.wtsd),
        _stat("wwsf", "WWSF", c.wwsf, c.wwsf_opp),
    ]


def backfill_showdown_fields(db: Session, hands: list[Hand], *, force: bool = True) -> int:
    """Refresh went_to_showdown / wsd / wwsd from raw_text.

    Default force=True because older rows used GG's false SHOWDOWN marker.
    """
    updated = 0
    for hand in hands:
        if not force:
            complete = (
                hand.went_to_showdown is not None
                and hand.hero_net_wsd is not None
                and hand.hero_net_wwsd is not None
                and hand.hero_net_wsd_bb is not None
                and hand.hero_net_wwsd_bb is not None
            )
            if complete:
                continue
        hero = hand.hero_name or "Hero"
        bb = float(hand.big_blind) if hand.big_blind is not None else None
        net = float(hand.hero_net) if hand.hero_net is not None else None
        net_bb = float(hand.hero_net_bb) if hand.hero_net_bb is not None else None
        went, wsd, wsd_bb, wwsd, wwsd_bb = extract_showdown_nets(
            hand.raw_text,
            hero_name=hero,
            big_blind=bb,
            hero_net=net,
            hero_net_bb=net_bb,
        )
        hand.went_to_showdown = went
        hand.hero_net_wsd = Decimal(str(wsd)) if wsd is not None else None
        hand.hero_net_wsd_bb = Decimal(str(wsd_bb)) if wsd_bb is not None else None
        hand.hero_net_wwsd = Decimal(str(wwsd)) if wwsd is not None else None
        hand.hero_net_wwsd_bb = Decimal(str(wwsd_bb)) if wwsd_bb is not None else None
        updated += 1
    if updated:
        db.commit()
    return updated


def load_strategy_hands(db: Session, user_id: UUID, strategy_id: UUID) -> list[Hand]:
    """All unique hands in the user's active profile hand database.

    Sessions may be archived on re-upload; Analysis/Career still use the full DB.
    ``strategy_id`` is only for chart comparison in callers.
    """
    del strategy_id  # chart selection happens in callers
    from app.models.user import User
    from app.services import databases as db_svc

    user = db.get(User, user_id)
    active_db_id = db_svc.get_active_database_id(db, user) if user else None
    if active_db_id is None:
        return []

    session_rows = list(
        db.execute(
            select(PlaySession.id, PlaySession.status).where(
                PlaySession.user_id == user_id,
                PlaySession.database_id == active_db_id,
            )
        ).all()
    )
    session_ids = [row[0] for row in session_rows]
    status_by_id = {row[0]: row[1] for row in session_rows}
    if not session_ids:
        return []

    hands = list(
        db.scalars(
            select(Hand)
            .options(selectinload(Hand.actions))
            .where(Hand.session_id.in_(session_ids))
            .order_by(Hand.played_at.asc().nulls_last(), Hand.external_hand_id.asc())
        )
    )
    return prefer_active_then_dedupe(hands, status_by_id)


def build_strategy_analysis(db: Session, user_id: UUID, strategy_id: UUID) -> StrategyAnalysis:
    hands = load_strategy_hands(db, user_id, strategy_id)
    if hands:
        backfill_showdown_fields(db, hands, force=True)
        hands = load_strategy_hands(db, user_id, strategy_id)

    total = OppCounters()
    by_pos: dict[str, OppCounters] = defaultdict(OppCounters)

    curve: list[AnalysisCurvePoint] = []
    cum_bb = cum_wsd_bb = cum_wwsd_bb = 0.0
    cum_m = cum_wsd_m = cum_wwsd_m = 0.0
    cum_ev_m = cum_ev_bb = 0.0
    compared = 0
    compliant = 0
    spot_by_key, cell_by_key = load_spot_maps(db, strategy_id)
    from app.models.strategy import Strategy

    strategy_row = db.get(Strategy, strategy_id)
    action_mode = (strategy_row.action_mode if strategy_row else "standard") or "standard"

    for idx, hand in enumerate(hands, start=1):
        flags = _analyze_hand(hand)
        _apply(total, flags, hand)
        pos = (hand.hero_position or "?").upper()
        _apply(by_pos[pos], flags, hand)

        net_m, net_bb = resolve_hand_result(hand)
        wsd_m, wsd_bb, wwsd_m, wwsd_bb = resolve_showdown_split(hand)

        cum_bb += net_bb
        cum_wsd_bb += wsd_bb
        cum_wwsd_bb += wwsd_bb
        cum_m += net_m
        cum_wsd_m += wsd_m
        cum_wwsd_m += wwsd_m

        # All-In EV: pot×equity − investment when all-in before river; else = net
        bb = float(hand.big_blind) if hand.big_blind is not None else 0.0
        ev_m = hand_ev_money(
            hand.raw_text,
            hero_name=hand.hero_name or "Hero",
            hero_net=net_m,
            hero_hand=hand.hero_hand,
        )
        ev_bb = (ev_m / bb) if bb > 0 else 0.0
        cum_ev_m += ev_m
        cum_ev_bb += ev_bb

        deviant = hand_is_deviation(hand, spot_by_key, cell_by_key, action_mode=action_mode)
        if deviant is True:
            compared += 1
        elif deviant is False:
            compared += 1
            compliant += 1

        compliance = round(100.0 * compliant / compared, 2) if compared else 100.0

        curve.append(
            AnalysisCurvePoint(
                hand_index=idx,
                cum_total_bb=round(cum_bb, 4),
                cum_wwsd_bb=round(cum_wwsd_bb, 4),
                cum_wsd_bb=round(cum_wsd_bb, 4),
                cum_total_money=round(cum_m, 4),
                cum_wwsd_money=round(cum_wwsd_m, 4),
                cum_wsd_money=round(cum_wsd_m, 4),
                cum_ev_bb=round(cum_ev_bb, 4),
                cum_ev_money=round(cum_ev_m, 4),
                compliance_rate=compliance,
            )
        )

    n = total.hands
    winrate = round(100.0 * total.profit_bb / n, 2) if n else None

    pos_order = ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB", "?"]
    by_position: list[PositionHudRow] = []
    for pos in pos_order:
        if pos not in by_pos:
            continue
        c = by_pos[pos]
        wr = round(100.0 * c.profit_bb / c.hands, 2) if c.hands else None
        by_position.append(
            PositionHudRow(
                position=pos,
                hands=c.hands,
                vpip=_pct(c.vpip, c.vpip_opp or c.hands),
                pfr=_pct(c.pfr, c.pfr_opp or c.hands),
                three_bet=_pct(c.three_bet, c.three_bet_opp),
                winrate_bb100=wr,
                profit_bb=round(c.profit_bb, 2),
            )
        )
    for pos, c in by_pos.items():
        if pos in pos_order:
            continue
        wr = round(100.0 * c.profit_bb / c.hands, 2) if c.hands else None
        by_position.append(
            PositionHudRow(
                position=pos,
                hands=c.hands,
                vpip=_pct(c.vpip, c.vpip_opp or c.hands),
                pfr=_pct(c.pfr, c.pfr_opp or c.hands),
                three_bet=_pct(c.three_bet, c.three_bet_opp),
                winrate_bb100=wr,
                profit_bb=round(c.profit_bb, 2),
            )
        )

    return StrategyAnalysis(
        strategy_id=str(strategy_id),
        hands=n,
        winrate_bb100=winrate,
        total_profit_bb=round(total.profit_bb, 2),
        total_profit_money=round(total.profit_money, 2),
        stats=_counters_to_stats(total),
        by_position=by_position,
        curve=curve,
    )
