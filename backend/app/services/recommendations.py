"""Math-based recommendations from hand history (no player strategy charts)."""

from __future__ import annotations

import re
from collections import Counter
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.schemas.analysis import (
    GameEvaluation,
    HudEvalItem,
    PlanChecklistItem,
    RecommendationHandItem,
    RecommendationsResponse,
)
from app.services.hand_replay import _parse_board
from app.services.hud_stats import (
    OppCounters,
    _analyze_hand,
    _apply,
    _counters_to_stats,
    load_strategy_hands,
)
from app.services.results import resolve_hand_result
from app.services.strategy_match import hero_preflop_action

_CARD_RE = re.compile(r"^([2-9TJQKA])([cdhs])$", re.I)
_RANK_ORDER = "23456789TJQKA"
_STREET_RU = {"preflop": "префлопе", "flop": "флопе", "turn": "терне", "river": "ривере"}
_ACTION_RU = {
    "fold": "Фолд",
    "call": "Колл",
    "raise": "Рейз",
    "check": "Чек",
}

# Max open frequency by position (math baseline, not user charts)
_OPEN_TOP_PCT: dict[str, float] = {
    "UTG": 0.14,
    "UTG+1": 0.16,
    "UTG1": 0.16,
    "UTG+2": 0.18,
    "UTG2": 0.18,
    "MP": 0.20,
    "MP1": 0.20,
    "HJ": 0.22,
    "CO": 0.30,
    "BTN": 0.48,
    "SB": 0.40,
    "BB": 0.0,
}


def _parse_hero_cards(hero_hand: str | None) -> list[str]:
    if not hero_hand or len(hero_hand) < 4:
        return []
    a, b = hero_hand[:2], hero_hand[2:4]
    return [a, b] if _CARD_RE.match(a) and _CARD_RE.match(b) else []


def _fmt_cards(cards: list[str]) -> str:
    return " ".join(cards) if cards else "—"


def _fmt_board(board: list[str]) -> str:
    return " ".join(board) if board else "—"


def _board_for_street(board: list[str], street: str) -> list[str]:
    if street == "flop":
        return board[:3]
    if street == "turn":
        return board[:4]
    if street == "river":
        return board[:5]
    return []


def _hand_rank_index(code: str | None) -> int:
    """1 = strongest (AA), 169 = weakest. Approx Sklansky-Chubukov style tiers."""
    if not code:
        return 169
    c = code.strip().upper()
    pairs = {
        "AA": 1,
        "KK": 2,
        "QQ": 3,
        "JJ": 4,
        "TT": 5,
        "99": 8,
        "88": 12,
        "77": 18,
        "66": 28,
        "55": 40,
        "44": 55,
        "33": 70,
        "22": 85,
    }
    if c in pairs:
        return pairs[c]
    if len(c) < 2:
        return 169
    r1, r2 = c[0], c[1]
    suited = c.endswith("S")
    offsuit = c.endswith("O") or len(c) == 2
    try:
        i1, i2 = _RANK_ORDER.index(r1), _RANK_ORDER.index(r2)
    except ValueError:
        return 169
    hi, lo = max(i1, i2), min(i1, i2)
    gap = hi - lo
    # Broadway / Ax strength
    base = 90 - hi * 5 - lo * 2
    if suited:
        base -= 12
    if offsuit and not suited and len(c) >= 3:
        base += 8
    if gap >= 3:
        base += gap * 4
    if hi == 12:  # Ace
        base -= 10
    return max(1, min(169, int(base)))


def _equity_vs_open(code: str | None) -> float:
    """Rough equity % of hand vs ~30–35% open range."""
    idx = _hand_rank_index(code)
    # Map rank → equity band ~22–85%
    return round(max(18.0, min(85.0, 88.0 - idx * 0.38)), 1)


def _equity_vs_3bet(code: str | None) -> float:
    """Rough equity % vs ~10–12% 3-bet range."""
    idx = _hand_rank_index(code)
    return round(max(12.0, min(82.0, 80.0 - idx * 0.42)), 1)


def _percentile(code: str | None) -> float:
    """Top percentile of hand (AA ≈ 0.006, trash ≈ 1.0)."""
    return _hand_rank_index(code) / 169.0


def _flush_draw_outs(hero: list[str], board: list[str]) -> int:
    suits = Counter(c[1].lower() for c in hero + board)
    for suit, n in suits.items():
        if n != 4:
            continue
        hero_suits = sum(1 for c in hero if c[1].lower() == suit)
        board_suits = sum(1 for c in board if c[1].lower() == suit)
        if hero_suits >= 1 and board_suits >= 2:
            return 9
    return 0


def _straight_draw_outs(hero: list[str], board: list[str]) -> int:
    ranks: list[int] = []
    for c in hero + board:
        r = c[0].upper()
        if r in _RANK_ORDER:
            ranks.append(_RANK_ORDER.index(r))
    uniq = sorted(set(ranks))
    if 12 in uniq:  # Ace also as wheel low
        uniq = sorted(set(uniq + [0]))
    if len(uniq) < 3:
        return 0
    best = 0
    for start in range(0, 13):
        window = [r for r in uniq if start <= r <= start + 4]
        if len(window) == 4:
            span = window[-1] - window[0]
            if span == 3:
                best = max(best, 8)
            elif span == 4:
                best = max(best, 4)
        if len(window) >= 3 and (window[-1] - window[0]) <= 4:
            best = max(best, 4)
    return best


def _draw_equity_one_street(outs: int) -> float:
    if outs <= 0:
        return 0.0
    return min(95.0, outs * 2.0)


def _draw_label(outs: int, flush: int, straight: int) -> str:
    parts: list[str] = []
    if flush:
        parts.append("флеш-дро")
    if straight >= 8:
        parts.append("OESD")
    elif straight >= 4:
        parts.append("гатшот")
    if not parts:
        parts.append(f"{outs} outs")
    return " + ".join(parts)


def _running_pot_before(hand: Hand, action_order: int) -> float:
    pot = float(hand.small_blind or 0) + float(hand.big_blind or 0)
    for a in hand.actions:
        if a.action_order >= action_order:
            break
        if a.amount is None:
            continue
        amt = float(a.amount)
        if amt > 0:
            pot += amt
    return max(pot, float(hand.big_blind or 0) * 1.5)


def _preflop_raises_before_hero(hand: Hand) -> int:
    n = 0
    for a in hand.actions:
        if a.street != "preflop":
            continue
        if a.is_hero:
            break
        if a.action == "raise" and a.amount is not None and float(a.amount) > 0:
            n += 1
    return n


def _hero_preflop_action_row(hand: Hand):
    for a in hand.actions:
        if a.street != "preflop" or not a.is_hero:
            continue
        if a.action in {"raise", "call", "fold"}:
            if a.action == "call" and (a.amount is None or float(a.amount) <= 0):
                continue
            return a
    return None


def _lost_money(hand: Hand) -> float:
    net, _ = resolve_hand_result(hand)
    return abs(float(net)) if float(net) < 0 else 0.0


def _call_ev(equity_pct: float, pot: float, bet: float) -> float:
    """EV of calling: equity * (pot + 2*bet) - bet."""
    eq = equity_pct / 100.0
    return eq * (pot + 2.0 * bet) - bet


def _item(
    *,
    hand: Hand,
    street: str,
    board: list[str],
    pot_before: float,
    bet_amount: float,
    actual: str,
    correct: str,
    lost: float,
    ev_loss: float,
    pot_odds_pct: float | None,
    equity_pct: float | None,
    outs: int | None,
    title: str,
    analysis: str,
    example: str,
) -> RecommendationHandItem:
    cards = _parse_hero_cards(hand.hero_hand)
    hid = hand.external_hand_id or str(hand.id)[:8]
    code = hand.hero_hand_code or "?"
    pos = (hand.hero_position or "?").upper()
    text = f"{title}\n\n{analysis}\n\nПример правильной линии: {example}"
    return RecommendationHandItem(
        hand_id=str(hand.id),
        external_hand_id=hid,
        hand_code=code,
        hero_cards=_fmt_cards(cards) if cards else (hand.hero_hand or ""),
        position=pos,
        street=street,
        board=board,
        pot_before=round(pot_before, 2),
        bet_amount=round(bet_amount, 2),
        actual_action=actual,
        correct_action=correct,
        lost_money=round(lost, 2),
        ev_loss=round(max(0.0, ev_loss), 2),
        pot_odds_pct=pot_odds_pct,
        equity_pct=equity_pct,
        outs=outs,
        title=title,
        analysis=analysis,
        example=example,
        text=text,
    )


def find_preflop_math_leaks(hands: list[Hand], *, limit: int = 30) -> list[RecommendationHandItem]:
    """Preflop calls/opens that fail pot-odds / position math (not user charts)."""
    items: list[RecommendationHandItem] = []

    for hand in hands:
        code = hand.hero_hand_code
        pos = (hand.hero_position or "").upper()
        if not code or not pos:
            continue
        row = _hero_preflop_action_row(hand)
        if row is None:
            continue
        actual = hero_preflop_action(hand)
        if actual not in {"raise", "call"}:
            continue

        bet = float(row.amount or 0)
        pot = _running_pot_before(hand, row.action_order)
        lost = _lost_money(hand)
        raises_before = _preflop_raises_before_hero(hand)
        cards = _fmt_cards(_parse_hero_cards(hand.hero_hand))
        hid = hand.external_hand_id or str(hand.id)[:8]

        # --- Facing raise: call needs pot odds vs hand equity ---
        if actual == "call" and raises_before >= 1 and bet > 0:
            needed = round(100.0 * bet / (pot + bet * 2), 1) if pot + bet * 2 > 0 else 100.0
            eq = _equity_vs_3bet(code) if raises_before >= 2 else _equity_vs_open(code)
            vs = "3-бет диапазон" if raises_before >= 2 else "опен-рейз"
            ev = _call_ev(eq, pot, bet)
            if needed <= eq + 1.5:
                continue
            ev_loss = abs(ev) if ev < 0 else (bet * (needed - eq) / 100.0)
            items.append(
                _item(
                    hand=hand,
                    street="preflop",
                    board=[],
                    pot_before=pot,
                    bet_amount=bet,
                    actual="call",
                    correct="fold",
                    lost=lost,
                    ev_loss=ev_loss,
                    pot_odds_pct=needed,
                    equity_pct=eq,
                    outs=None,
                    title=f"−EV колл на префлопе · {code} · {pos}",
                    analysis=(
                        f"Раздача #{hid}: у вас {cards} ({code}) из {pos}. "
                        f"Вы заколлировали ${bet:.2f} при банке ≈ ${pot:.2f}. "
                        f"Шансы банка требовали ≈ {needed:.1f}% эквити, а против типичного {vs} "
                        f"у {code} примерно {eq:.1f}%. "
                        f"Математическое ожидание колла ≈ {ev:.2f}$. "
                        f"В раздаче результат: −${lost:.2f}."
                    ),
                    example=(
                        f"На префлопе с {code} из {pos} правильная линия — {_ACTION_RU['fold']}. "
                        f"Без нужного эквити против {vs} колл убыточен на дистанции; "
                        f"фолд сохраняет стек и убирает −EV спот."
                    ),
                )
            )
            continue

        # --- Open/raise too wide by position math ---
        if actual == "raise" and raises_before == 0:
            top = _OPEN_TOP_PCT.get(pos)
            if top is None or top <= 0:
                continue
            pct = _percentile(code)
            if pct <= top:
                continue
            # Weak open — flag especially if lost money or very wide
            if lost <= 0 and pct < top + 0.12:
                continue
            items.append(
                _item(
                    hand=hand,
                    street="preflop",
                    board=[],
                    pot_before=pot,
                    bet_amount=bet,
                    actual="raise",
                    correct="fold",
                    lost=lost,
                    ev_loss=max(lost, float(hand.big_blind or 1) * 2.5),
                    pot_odds_pct=None,
                    equity_pct=round((1.0 - pct) * 100, 1),
                    outs=None,
                    title=f"Слишком широкий опен · {code} · {pos}",
                    analysis=(
                        f"Раздача #{hid}: {cards} ({code}) из {pos}. "
                        f"Вы открыли банк рейзом, хотя по позиционной математике из {pos} "
                        f"играбельны примерно топ-{int(top * 100)}% рук, а {code} слабее этого порога "
                        f"(примерный перцентиль силы ~{int(pct * 100)}%). "
                        f"Такие открытие на дистанции теряют блайнды и создают −EV постфлоп. "
                        f"Итог раздачи: −${lost:.2f}."
                    ),
                    example=(
                        f"С {code} из {pos} базовая линия — {_ACTION_RU['fold']}. "
                        f"Открывайте из {pos} только руки из топ-{int(top * 100)}% "
                        f"(пары, сильные бродвеи, качественные suited connectors)."
                    ),
                )
            )

    items.sort(key=lambda x: (-x.lost_money, -x.ev_loss))
    return items[:limit]


def find_pot_odds_leaks(hands: list[Hand], *, limit: int = 30) -> list[RecommendationHandItem]:
    """Postflop calls with draws where pot odds > draw equity."""
    items: list[RecommendationHandItem] = []

    for hand in hands:
        hero = _parse_hero_cards(hand.hero_hand)
        if len(hero) != 2:
            continue
        board_full = _parse_board(hand.raw_text or "")
        if len(board_full) < 3:
            continue
        lost = _lost_money(hand)
        code = hand.hero_hand_code or "?"
        hid = hand.external_hand_id or str(hand.id)[:8]
        cards = _fmt_cards(hero)

        for a in hand.actions:
            if not a.is_hero or a.street not in {"flop", "turn", "river"}:
                continue
            if a.action != "call" or a.amount is None or float(a.amount) <= 0:
                continue
            street_board = _board_for_street(board_full, a.street)
            if len(street_board) < 3:
                continue

            flush_o = _flush_draw_outs(hero, street_board)
            straight_o = _straight_draw_outs(hero, street_board)
            outs = max(flush_o, straight_o)
            if outs <= 0:
                continue

            bet = float(a.amount)
            pot = _running_pot_before(hand, a.action_order)
            denom = pot + bet * 2
            if denom <= 0:
                continue
            needed = round(100.0 * bet / denom, 1)
            equity = round(_draw_equity_one_street(outs), 1)
            if needed <= equity:
                continue

            ev = _call_ev(equity, pot, bet)
            ev_loss = abs(ev) if ev < 0 else bet * (needed - equity) / 100.0
            street_ru = _STREET_RU.get(a.street, a.street)
            draw = _draw_label(outs, flush_o, straight_o)
            board_s = _fmt_board(street_board)

            items.append(
                _item(
                    hand=hand,
                    street=a.street,
                    board=street_board,
                    pot_before=pot,
                    bet_amount=bet,
                    actual="call",
                    correct="fold",
                    lost=lost,
                    ev_loss=ev_loss,
                    pot_odds_pct=needed,
                    equity_pct=equity,
                    outs=outs,
                    title=f"−EV колл с дро · {a.street.upper()} · −${max(lost, ev_loss):.2f}",
                    analysis=(
                        f"Раздача #{hid}: {cards} ({code}), борд {board_s}, улица — {street_ru}. "
                        f"Вы заколлировали ставку ${bet:.2f} при банке ≈ ${pot:.2f}, имея {draw} "
                        f"({outs} outs ≈ {equity:.1f}% на одну улицу по правилу ×2). "
                        f"Шансы банка требовали {needed:.1f}% — колл математически убыточен "
                        f"(EV ≈ {ev:.2f}$). Результат раздачи: −${lost:.2f}."
                    ),
                    example=(
                        f"На {street_ru} с бордом {board_s} правильная линия — {_ACTION_RU['fold']}. "
                        f"Коллируйте дро только когда equity ≥ pot odds "
                        f"(здесь нужно ≥ {needed:.1f}%, у вас ≈ {equity:.1f}%). "
                        f"Без цены банка фолд сохраняет деньги на дистанции."
                    ),
                )
            )

    items.sort(key=lambda x: (-x.ev_loss, -x.lost_money))
    return items[:limit]


def build_critical_damage(
    preflop: list[RecommendationHandItem],
    pot: list[RecommendationHandItem],
    *,
    top: int = 5,
) -> list[RecommendationHandItem]:
    """Most expensive math mistakes — prefer real $ lost, then EV loss."""
    merged = preflop + pot
    # Dedupe by hand_id keeping costliest
    best: dict[str, RecommendationHandItem] = {}
    for it in merged:
        score = it.lost_money * 1.5 + it.ev_loss
        prev = best.get(it.hand_id)
        prev_score = (prev.lost_money * 1.5 + prev.ev_loss) if prev else -1
        if score > prev_score and (it.lost_money > 0 or it.ev_loss > 0):
            best[it.hand_id] = it
    ranked = sorted(best.values(), key=lambda x: (-x.lost_money, -x.ev_loss))
    out: list[RecommendationHandItem] = []
    for it in ranked[:top]:
        out.append(
            it.model_copy(
                update={
                    "title": f"Дорогой лик −${it.lost_money:.2f} · #{it.external_hand_id}",
                    "text": (
                        f"Дорогой лик: в раздаче #{it.external_hand_id} с {it.hero_cards} "
                        f"({it.hand_code}) из {it.position} вы сделали {_ACTION_RU.get(it.actual_action, it.actual_action)} "
                        f"вместо {_ACTION_RU.get(it.correct_action, it.correct_action)} и потеряли "
                        f"{it.lost_money:.2f}$ (оценка −EV спота ≈ {it.ev_loss:.2f}$).\n\n"
                        f"{it.analysis}\n\n"
                        f"Пример правильной линии: {it.example}"
                    ),
                }
            )
        )
    return out


def build_plan(
    preflop: list[RecommendationHandItem],
    pot: list[RecommendationHandItem],
    critical: list[RecommendationHandItem],
) -> list[PlanChecklistItem]:
    by_pos = Counter(i.position for i in preflop)
    worst_pos, worst_n = (by_pos.most_common(1)[0] if by_pos else ("BTN", 0))
    damage = sum(i.lost_money for i in critical)
    pot_n = len(pot)

    items: list[PlanChecklistItem] = []
    if worst_n > 0:
        items.append(
            PlanChecklistItem(
                priority=1,
                text=(
                    f"Сфокусируйтесь на математике префлопа из {worst_pos}: "
                    f"найдено {worst_n} −EV входов. Перед сессией повторите, "
                    f"какие руки реально имеют цену колла/опена с этой позиции."
                ),
            )
        )
    else:
        items.append(
            PlanChecklistItem(
                priority=1,
                text=(
                    "Держите префлоп-дисциплину: не коллируйте рейзы руками без нужного эквити "
                    "и не открывайте мусор из ранних позиций."
                ),
            )
        )

    if pot_n > 0:
        items.append(
            PlanChecklistItem(
                priority=2,
                text=(
                    f"На постфлопе считайте pot odds до колла с дро — найдено {pot_n} убыточных "
                    f"коллов. Если equity (outs×2) меньше требуемых шансов банка — фолд."
                ),
            )
        )
    else:
        items.append(
            PlanChecklistItem(
                priority=2,
                text=(
                    "Не коллируйте ставки на терне/ривере с дро, если математика банка "
                    "этого не позволяет (equity < pot odds)."
                ),
            )
        )

    if damage > 0:
        items.append(
            PlanChecklistItem(
                priority=3,
                text=(
                    f"Разберите топ дорогих ошибок (суммарно ≈ ${damage:.2f}): откройте раздачи "
                    f"во вкладке «Дорогие лики» и проговорите вслух правильную линию до действия."
                ),
            )
        )
    else:
        items.append(
            PlanChecklistItem(
                priority=3,
                text=(
                    "Перед сессией возьмите 2–3 прошлые крупные банки и проверьте: "
                    "был ли у колла правильный pot odds и альтернатива фолдом."
                ),
            )
        )
    return items[:3]


# Solid 6-max regular targets (NLHE). Outside band → coaching note.
_HUD_TARGETS: list[dict] = [
    {
        "key": "vpip",
        "label": "VPIP",
        "lo": 18.0,
        "hi": 28.0,
        "unit": "pct",
        "low": "Слишком тайтово: мало добровольных входов. Добавьте стилы с BTN/CO и чуть шире опен из поздних позиций.",
        "high": "Слишком пассивно/лузово на префлопе: сузьте колл-спектр, меньше лимпов и маргинальных коллов рейзов.",
    },
    {
        "key": "pfr",
        "label": "PFR",
        "lo": 14.0,
        "hi": 24.0,
        "unit": "pct",
        "low": "Не хватает префлоп-агрессии: чаще открывайте рейзом вместо колла/лимпа, особенно CO/BTN.",
        "high": "PFR завышен: сократите мусорные опены из ранних позиций и слабые изолейты.",
    },
    {
        "key": "gap",
        "label": "VPIP−PFR",
        "lo": 0.0,
        "hi": 7.0,
        "unit": "pct",
        "low": "Спектр почти полностью на рейзе — ок для тайтового рега; следите, чтобы не фолдить слишком много защиты BB.",
        "high": "Большой gap: много коллов/лимпов. Играйте больше через рейз, меньше пассивных входов.",
    },
    {
        "key": "three_bet",
        "label": "3-bet",
        "lo": 5.5,
        "hi": 12.0,
        "unit": "pct",
        "low": "Мало 3-бетов: добавьте value+блеф 3-беты vs CO/BTN опены (Axs, KQs, suited connectors).",
        "high": "3-бет слишком часто: сузьте блеф-часть, особенно из блайндов vs ранние опены.",
    },
    {
        "key": "ats",
        "label": "Steal",
        "lo": 28.0,
        "hi": 48.0,
        "unit": "pct",
        "low": "Слабый стил: чаще атакуйте блайнды с CO/BTN/SB подходящими руками.",
        "high": "Стил слишком широкий: оппоненты защищаются — уберите слабые руки из стила.",
    },
    {
        "key": "afq",
        "label": "AFq",
        "lo": 32.0,
        "hi": 55.0,
        "unit": "pct",
        "low": "Не хватает постфлоп-агрессии: чаще бетите за value и как полублеф с дро вместо чистого колла.",
        "high": "Переагрессия постфлоп: меньше баррелей без эквити/фолд-эквити, больше чек-коллов сильной средней силы.",
    },
    {
        "key": "af",
        "label": "AF",
        "lo": 1.4,
        "hi": 3.8,
        "unit": "ratio",
        "low": "AF низкий — вы слишком часто коллите. Заменяйте часть коллов на беты/рейзы в выгодных спотах.",
        "high": "AF высокий — много бессмысленной агрессии. Чаще контролируйте банк чеком с маргиналом.",
    },
    {
        "key": "cbet",
        "label": "C-bet",
        "lo": 45.0,
        "hi": 72.0,
        "unit": "pct",
        "low": "Мало c-bet: на сухих бордах чаще ставьте продолжение (value + блеф).",
        "high": "C-bet слишком часто: на влажных/связанных бордах чаще чекайте и играйте от диапазона.",
    },
    {
        "key": "wtsd",
        "label": "WTSD",
        "lo": 22.0,
        "hi": 32.0,
        "unit": "pct",
        "low": "Редко доходите до вскрытия: возможно, слишком много фолдов на средние ставки — не сбрасывайте сильный маргинал без чтения.",
        "high": "Слишком часто идёте на вскрытие: больше фолдов на крупных улицах без натсов/сильного дро и цены банка.",
    },
    {
        "key": "wsd",
        "label": "W$SD",
        "lo": 47.0,
        "hi": 58.0,
        "unit": "pct",
        "low": "Слабо выигрываете на вскрытии: либо доходите со слабыми руками, либо мало value-бетов. Усильте спектр шоудауна.",
        "high": "W$SD высокий — хорошо; не переходите в излишний тайтнес и не фолдите слишком много маргинала.",
    },
    {
        "key": "wwsf",
        "label": "WWSF",
        "lo": 42.0,
        "hi": 52.0,
        "unit": "pct",
        "low": "Мало выигранных банков без шоудауна: не хватает блефов/полублефов и давления на оппонента.",
        "high": "Много выигранных банков без шоудауна — сильная агрессия; следите, чтобы не оверблефовать коллящих оппов.",
    },
    {
        "key": "limp",
        "label": "Limp",
        "lo": 0.0,
        "hi": 4.0,
        "unit": "pct",
        "low": "Лимпов почти нет — отлично для современного рега.",
        "high": "Много лимпов: почти всегда лучше рейз или фолд. Уберите открытые лимпы из стратегии.",
    },
]


def _stat_map(hands: list[Hand]) -> dict[str, tuple[float | None, int, str]]:
    total = OppCounters()
    for hand in hands:
        _apply(total, _analyze_hand(hand), hand)
    out: dict[str, tuple[float | None, int, str]] = {}
    for s in _counters_to_stats(total):
        out[s.key] = (s.value, s.samples, s.unit)
    vpip = out.get("vpip", (None, 0, "pct"))[0]
    pfr = out.get("pfr", (None, 0, "pct"))[0]
    if vpip is not None and pfr is not None:
        out["gap"] = (round(vpip - pfr, 1), out.get("vpip", (None, 0, "pct"))[1], "pct")
    return out


def _metric_score(value: float, lo: float, hi: float, *, soft: float = 0.35) -> tuple[str, float]:
    """Return status + 0..10 score. Soft = how far outside band still scores >0."""
    if lo <= value <= hi:
        # closer to center → slightly higher
        mid = (lo + hi) / 2
        half = max((hi - lo) / 2, 0.01)
        dist = abs(value - mid) / half
        return "ok", round(10.0 - dist * 0.8, 2)
    if value < lo:
        span = max(lo * soft, 1.0)
        pen = min(10.0, (lo - value) / span * 5.0)
        return "low", round(max(0.0, 10.0 - pen), 2)
    span = max(hi * soft, 1.0)
    pen = min(10.0, (value - hi) / span * 5.0)
    return "high", round(max(0.0, 10.0 - pen), 2)


def _score_label(score: float) -> str:
    if score >= 9:
        return "Элитный уровень"
    if score >= 7.5:
        return "Солидный рег"
    if score >= 6:
        return "Рабочий уровень"
    if score >= 4.5:
        return "Есть заметные лики"
    if score >= 3:
        return "Слабая дистанция"
    return "Критичные лики"


def build_game_evaluation(
    hands: list[Hand],
    preflop: list[RecommendationHandItem],
    pot: list[RecommendationHandItem],
    critical: list[RecommendationHandItem],
) -> GameEvaluation:
    n = len(hands)
    stats = _stat_map(hands)

    hud_items: list[HudEvalItem] = []
    hud_scores: list[float] = []
    for spec in _HUD_TARGETS:
        key = spec["key"]
        val, samples, unit = stats.get(key, (None, 0, spec["unit"]))
        min_samples = 25 if key not in {"wtsd", "wsd", "wwsf", "cbet", "ats", "three_bet"} else 15
        if val is None or samples < min_samples:
            hud_items.append(
                HudEvalItem(
                    key=key,
                    label=spec["label"],
                    value=val,
                    unit=unit,
                    samples=samples,
                    target_min=spec["lo"],
                    target_max=spec["hi"],
                    status="unknown",
                    score=7.0,
                    recommendation=(
                        f"Мало данных по {spec['label']} (n={samples}). "
                        f"Целевой коридор рега: {spec['lo']:g}–{spec['hi']:g}"
                        f"{'%' if unit == 'pct' else ''}."
                    ),
                )
            )
            continue
        status, sc = _metric_score(float(val), float(spec["lo"]), float(spec["hi"]))
        tip = spec["low"] if status == "low" else spec["high"] if status == "high" else (
            f"{spec['label']} в норме солидного рега ({spec['lo']:g}–{spec['hi']:g}"
            f"{'%' if unit == 'pct' else ''}). Держите этот уровень."
        )
        hud_items.append(
            HudEvalItem(
                key=key,
                label=spec["label"],
                value=float(val),
                unit=unit,
                samples=samples,
                target_min=spec["lo"],
                target_max=spec["hi"],
                status=status,
                score=sc,
                recommendation=tip,
            )
        )
        hud_scores.append(sc)

    hud_score = round(sum(hud_scores) / len(hud_scores), 2) if hud_scores else 5.0

    # Math score: fewer / cheaper errors → higher
    err_n = len(preflop) + len(pot)
    damage = sum(i.lost_money for i in critical)
    if n <= 0:
        math_score = 5.0
    else:
        err_rate = err_n / max(n, 1)
        # 0 errors → 10; 15%+ error hands → ~2
        rate_pen = min(8.0, err_rate * 55.0)
        money_pen = min(4.0, damage / max(float(hands[0].big_blind or 1) * 40.0, 1.0))
        math_score = round(max(0.0, 10.0 - rate_pen - money_pen), 2)

    # Weight: HUD structure + math leaks
    score = round(0.55 * hud_score + 0.45 * math_score, 1)
    score = max(0.0, min(10.0, score))

    if n >= 200:
        confidence = "high"
    elif n >= 60:
        confidence = "medium"
    else:
        confidence = "low"

    # Focus: worst HUD + math themes
    focus: list[str] = []
    bad_hud = sorted(
        [h for h in hud_items if h.status in {"low", "high"}],
        key=lambda h: h.score,
    )
    for h in bad_hud[:4]:
        focus.append(h.recommendation)
    if preflop:
        focus.append(
            f"Префлоп-математика: {len(preflop)} −EV входов — сузьте коллы без цены и мусорные опены."
        )
    if pot:
        focus.append(
            f"Математика банка: {len(pot)} −EV коллов с дро — фолд, если outs×2 < pot odds."
        )
    # unique preserve order
    seen: set[str] = set()
    focus_unique: list[str] = []
    for f in focus:
        if f in seen:
            continue
        seen.add(f)
        focus_unique.append(f)
    focus_unique = focus_unique[:6]

    label = _score_label(score)
    summary = (
        f"Оценка {score:.1f}/10 — {label}. "
        f"Математика решений: {math_score:.1f}/10, профиль HUD: {hud_score:.1f}/10 "
        f"на выборке {n} раздач"
        + (" (мало данных — оценка предварительная)." if confidence == "low" else ".")
    )
    if bad_hud:
        top = ", ".join(h.label for h in bad_hud[:3])
        summary += f" Главные отклонения HUD: {top}."

    return GameEvaluation(
        score=score,
        label=label,
        summary=summary,
        hands=n,
        confidence=confidence,
        math_score=math_score,
        hud_score=hud_score,
        hud=hud_items,
        focus=focus_unique,
    )


def build_recommendations(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
) -> RecommendationsResponse:
    hands = load_strategy_hands(db, user_id, strategy_id)
    preflop = find_preflop_math_leaks(hands)
    pot = find_pot_odds_leaks(hands)
    critical = build_critical_damage(preflop, pot)
    plan = build_plan(preflop, pot, critical)
    evaluation = build_game_evaluation(hands, preflop, pot, critical)
    all_errs = preflop + pot
    return RecommendationsResponse(
        strategy_id=str(strategy_id),
        hands_count=len(hands),
        math_errors=len(all_errs),
        total_damage_money=round(sum(i.lost_money for i in critical), 2),
        discipline=preflop,
        critical_damage=critical,
        pot_odds=pot,
        plan=plan,
        evaluation=evaluation,
    )
