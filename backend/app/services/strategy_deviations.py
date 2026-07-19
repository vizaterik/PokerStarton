"""Live strategy deviations: compare hands to current strategy cells on read."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.hand import Hand
from app.schemas.analysis import (
    ChartErrorCell,
    ChartErrorSpot,
    HuPotBranchRow,
    LeakFinderReport,
    LeakHeatCell,
    LeakInsight,
    PreflopBranchAccuracy,
    PreflopOpenBreakdown,
    PreflopPositionOpenRow,
    PreflopSpotAccuracy,
    StrategyDeviationRow,
    StrategyDeviationsResponse,
)
from app.parsers.pokerstars import extract_hu_postflop_branch
from app.services.deviation import is_deviation, pick_expected_action
from app.services.hud_stats import load_strategy_hands
from app.services.results import resolve_hand_result
from app.services.strategy_match import (
    hero_preflop_action,
    load_spot_maps,
    resolve_cell_freqs,
)
from app.services.spot_labels import (
    format_branch_label,
    pot_matchup_label,
    spot_action_label,
    spot_pot_kind,
    spot_pot_tag,
)

_POS_ORDER = ["UTG", "UTG1", "MP", "MP1", "HJ", "CO", "BTN", "SB", "BB"]
_SPOT_ORDER = ["rfi", "vs_open", "vs_3bet", "vs_4bet", "squeeze", "iso"]


def _pct(correct: int, decisions: int) -> float:
    if decisions <= 0:
        return 100.0
    return round(100.0 * correct / decisions, 1)


def _pos_sort_key(pos: str) -> tuple[int, str]:
    try:
        return (_POS_ORDER.index(pos), pos)
    except ValueError:
        return (len(_POS_ORDER), pos)


def _spot_sort_key(key: str) -> tuple[int, str]:
    try:
        return (_SPOT_ORDER.index(key), key)
    except ValueError:
        return (len(_SPOT_ORDER), key)


def _hero_preflop_amount(hand: Hand) -> float | None:
    for a in hand.actions:
        if a.street != "preflop" or not a.is_hero:
            continue
        if a.action not in {"raise", "call", "bet", "all-in", "allin"}:
            continue
        if a.amount is None:
            continue
        amt = float(a.amount)
        if amt > 0:
            return amt
    return None


def _estimate_missed_ev(hand: Hand, *, actual: str, expected: str) -> float:
    """
    Rough $ leak: money put in when chart wanted fold (call/raise vs fold),
    or open size when chart wanted fold on RFI.
    """
    if expected != "fold" or actual not in {"call", "raise"}:
        return 0.0
    amt = _hero_preflop_amount(hand)
    if amt is not None and amt > 0:
        return round(amt, 2)
    bb = float(hand.big_blind or 0)
    if bb <= 0:
        return 0.0
    # Fallback: call ≈ 1bb to open / raise ≈ 2.5bb open size
    return round(bb * (2.5 if actual == "raise" else 1.0), 2)


def _build_leak_finder(
    *,
    rows: list[StrategyDeviationRow],
    by_position: list[PreflopPositionOpenRow],
    by_spot: list[PreflopSpotAccuracy],
    play_decisions: int,
    play_correct: int,
) -> LeakFinderReport:
    missed = round(sum(r.missed_ev_money for r in rows), 2)
    critical = sum(1 for r in rows if r.missed_ev_money > 0)

    # Heatmap: aggregate by hand
    heat_map: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])  # errors, $
    for r in rows:
        heat_map[r.hand_code][0] += 1
        heat_map[r.hand_code][1] += r.missed_ev_money
    heat = [
        LeakHeatCell(hand_code=code, errors=int(vals[0]), lost_money=round(vals[1], 2))
        for code, vals in sorted(heat_map.items(), key=lambda kv: (-kv[1][0], -kv[1][1]))
    ]

    # a) Blind discipline SB/BB
    blind_dec = blind_ok = 0
    for p in by_position:
        if p.position in {"SB", "BB"}:
            blind_dec += p.decisions
            # approximate correct from accuracy
            blind_ok += int(round(p.decisions * p.accuracy_pct / 100.0))
    blind_pct = _pct(blind_ok, blind_dec) if blind_dec else None
    if blind_pct is None:
        blind_status, blind_hint = "ok", "Недостаточно решений на блайндах для вывода."
    elif blind_pct >= 85:
        blind_status, blind_hint = "ok", "Дисциплина на блайндах в норме относительно ваших чартов."
    elif blind_pct >= 70:
        blind_status, blind_hint = (
            "warn",
            "Лик найден: на SB/BB вы чаще отклоняетесь от чарта — проверьте защиту и фолды на 3-беты.",
        )
    else:
        blind_status, blind_hint = (
            "leak",
            "Лик найден: Вы переигрываете слабые тузы (A-xo) из позиции SB против 3-бетов.",
        )

    # b) Fold vs 3-bet too often
    vs3 = next((s for s in by_spot if s.spot_key == "vs_3bet"), None)
    fold_vs3 = [r for r in rows if r.spot_key == "vs_3bet" and r.actual_action == "fold"]
    vs3_dec = vs3.decisions if vs3 else 0
    fold_share = round(100.0 * len(fold_vs3) / vs3_dec, 0) if vs3_dec else None
    if fold_share is None:
        f3_status, f3_hint = "ok", "Мало спотов vs 3-bet для оценки фолд-дисциплины."
        f3_score = None
    elif fold_share >= 65:
        f3_status, f3_hint = (
            "leak",
            f"Вы фолдите {int(fold_share)}% ошибочных решений на префлопе против ререйзов. Оппоненты зарабатывают на вас без боя.",
        )
        f3_score = max(0.0, 100.0 - fold_share)
    elif fold_share >= 45:
        f3_status, f3_hint = (
            "warn",
            f"Фолд на 3-бет завышен (~{int(fold_share)}% среди ошибок). Проверьте продолжения по чарту.",
        )
        f3_score = max(0.0, 100.0 - fold_share)
    else:
        f3_status, f3_hint = "ok", "Фолды на 3-бет не выглядят критическим ликом."
        f3_score = max(0.0, 100.0 - (fold_share or 0))

    # c) Sizing / over-aggression proxy: raise when chart wanted fold or call
    over = [
        r
        for r in rows
        if r.actual_action == "raise" and r.expected_action in {"fold", "call"}
    ]
    over_n = len(over)
    if over_n >= 8:
        sz_status, sz_hint = (
            "leak",
            "Вы ставите слишком много / рейзите с неготовыми руками относительно чарта, сжигая банкролл.",
        )
        sz_score = max(0.0, 100.0 - min(90.0, over_n * 4))
    elif over_n >= 3:
        sz_status, sz_hint = (
            "warn",
            "Есть признаки овер-агрессии: рейзы там, где чарт ждал call/fold.",
        )
        sz_score = max(0.0, 100.0 - over_n * 6)
    else:
        sz_status, sz_hint = "ok", "Грубых ошибок сайзинга/овербета по чарту почти нет."
        sz_score = 92.0 if play_decisions else None

    insights = [
        LeakInsight(
            id="blinds",
            title="Дисциплина на блайндах (SB/BB)",
            score_pct=blind_pct,
            status=blind_status,
            hint=blind_hint,
        ),
        LeakInsight(
            id="fold_3bet",
            title="Слишком частый фолд на 3-бет",
            score_pct=f3_score,
            status=f3_status,
            hint=f3_hint,
        ),
        LeakInsight(
            id="sizing",
            title="Ошибки сайзинга (Over-betting)",
            score_pct=sz_score,
            status=sz_status,
            hint=sz_hint,
        ),
    ]

    return LeakFinderReport(
        missed_profit_money=missed,
        critical_errors=critical,
        insights=insights,
        heat=heat,
    )


def list_strategy_deviations(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    *,
    limit: int = 300,
) -> StrategyDeviationsResponse:
    """Compare all strategy hands against the current charts (not upload snapshots)."""
    from app.models.strategy import Strategy
    from app.services.strategy_modules import hand_matches_strategy_meta

    strategy = db.get(Strategy, strategy_id)
    hands = load_strategy_hands(db, user_id, strategy_id)
    spot_by_key, cell_by_key = load_spot_maps(db, strategy_id)
    action_mode = (strategy.action_mode if strategy else "standard") or "standard"

    out: list[StrategyDeviationRow] = []
    decisions = correct = 0
    open_decisions = open_correct = 0
    play_decisions = play_correct = 0
    spot_stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # decisions, correct

    # RFI detailed breakdown vs chart majority action
    rfi_opened = rfi_folded = rfi_called = 0
    should_open = opened_correct = missed_opens = 0
    should_fold = folded_correct = wrong_opens = 0

    # position → RFI counters
    pos_stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "decisions": 0,
            "opened": 0,
            "folded": 0,
            "called": 0,
            "should_open": 0,
            "opened_correct": 0,
            "missed_opens": 0,
            "should_fold": 0,
            "folded_correct": 0,
            "wrong_opens": 0,
            "correct": 0,
        }
    )

    # (spot_key, hero_pos, villain_pos|'') → [decisions, correct, profit_money, profit_bb]
    branch_stats: dict[tuple[str, str, str], list] = defaultdict(
        lambda: [0, 0, 0.0, 0.0]
    )

    # (spot_key, hero_pos, villain_pos|'') → hand_code → error meta
    chart_map: dict[tuple[str, str, str], dict[str, dict]] = defaultdict(dict)
    # Same key → painted StrategySpot.id used for scoring (for Errors UI)
    chart_spot_ids: dict[tuple[str, str, str], str] = {}

    for hand in hands:
        if not hand.hero_hand_code or not hand.detected_spot or not hand.hero_position:
            continue
        if strategy is not None and not hand_matches_strategy_meta(
            format=strategy.format,
            table_size=strategy.table_size,
            stack_depth=strategy.stack_depth,
            action_mode=action_mode,
            hero_position=hand.hero_position,
            stack_bb=float(hand.stack_bb) if hand.stack_bb is not None else None,
        ):
            continue
        actual = hero_preflop_action(hand)
        if not actual:
            continue
        if action_mode == "push_fold" and actual == "call":
            # Still score via resolve below; call vs push-fold is always a miss when chart exists.
            pass

        resolved = resolve_cell_freqs(
            spot_by_key,
            cell_by_key,
            spot_key=hand.detected_spot,
            hero_position=hand.hero_position,
            villain_position=hand.villain_position,
            hand_code=hand.hero_hand_code,
        )
        if resolved is None:
            continue

        spot, raise_f, call_f, fold_f = resolved
        if action_mode == "push_fold":
            call_f = Decimal("0")
            if actual == "call":
                deviant = True
            else:
                deviant = is_deviation(actual, raise_f, call_f, fold_f)
            expected = pick_expected_action(raise_f, call_f, fold_f)
        else:
            deviant = is_deviation(actual, raise_f, call_f, fold_f)
            expected = pick_expected_action(raise_f, call_f, fold_f)

        decisions += 1
        # Key aggregates by the *matched* chart (after aliases / iso→rfi fallbacks),
        # so Errors UI loads the same painted spot used for scoring.
        spot_key = spot.spot_key
        hero_pos = spot.hero_position or hand.hero_position or "?"
        vill_pos = spot.villain_position
        vill_key = vill_pos or ""

        spot_stats[spot_key][0] += 1
        branch_key = (spot_key, hero_pos, vill_key)
        branch_stats[branch_key][0] += 1
        net_m, net_bb_hand = resolve_hand_result(hand)
        branch_stats[branch_key][2] += float(net_m)
        branch_stats[branch_key][3] += float(net_bb_hand)
        if not deviant:
            correct += 1
            spot_stats[spot_key][1] += 1
            branch_stats[branch_key][1] += 1

        if spot_key == "rfi":
            open_decisions += 1
            ps = pos_stats[hero_pos]
            ps["decisions"] += 1
            if not deviant:
                open_correct += 1
                ps["correct"] += 1

            if actual == "raise":
                rfi_opened += 1
                ps["opened"] += 1
            elif actual == "fold":
                rfi_folded += 1
                ps["folded"] += 1
            else:
                rfi_called += 1
                ps["called"] += 1

            # In-range (raise or call on chart) ⇒ raise/call OK; only pure-fold
            # hands count as "should fold".
            in_range = raise_f > 0 or call_f > 0
            if in_range:
                should_open += 1
                ps["should_open"] += 1
                if actual == "raise":
                    opened_correct += 1
                    ps["opened_correct"] += 1
                elif actual == "fold" and deviant:
                    missed_opens += 1
                    ps["missed_opens"] += 1
                elif actual == "call":
                    # Call on an open chart still counts as not missing the hand
                    opened_correct += 1
                    ps["opened_correct"] += 1
            else:
                should_fold += 1
                ps["should_fold"] += 1
                if actual in ("raise", "call"):
                    wrong_opens += 1
                    ps["wrong_opens"] += 1
                else:
                    folded_correct += 1
                    ps["folded_correct"] += 1
        else:
            play_decisions += 1
            if not deviant:
                play_correct += 1

        if not deviant:
            continue

        # Second matrix: only error hands; track action mix for color bars
        chart_spot_ids[branch_key] = str(spot.id)
        err_cell = chart_map[branch_key].get(hand.hero_hand_code)
        if err_cell is None:
            err_cell = {
                "errors": 0,
                "raise": 0,
                "call": 0,
                "fold": 0,
                "actual_action": actual,
                "expected_action": expected,
            }
            chart_map[branch_key][hand.hero_hand_code] = err_cell
        err_cell["errors"] += 1
        if actual in ("raise", "call", "fold"):
            err_cell[actual] += 1
        err_cell["actual_action"] = actual
        err_cell["expected_action"] = expected

        freqs = {"raise": raise_f, "call": call_f, "fold": fold_f}
        actual_freq = freqs.get(actual, Decimal("0"))
        expected_freq = freqs[expected]
        severity = abs(expected_freq - actual_freq)
        missed_ev = _estimate_missed_ev(hand, actual=actual, expected=expected)

        spot_label = format_branch_label(spot.spot_key, hero_pos, vill_pos)

        out.append(
            StrategyDeviationRow(
                id=str(hand.id),
                hand_id=str(hand.id),
                hand_code=hand.hero_hand_code,
                actual_action=actual,
                expected_action=expected,
                actual_freq=float(actual_freq),
                expected_freq=float(expected_freq),
                severity=float(severity),
                spot_key=spot.spot_key,
                spot_label=spot_label,
                hero_position=hero_pos,
                villain_position=vill_pos,
                external_hand_id=hand.external_hand_id,
                played_at=hand.played_at.isoformat() if hand.played_at else None,
                hero_net_bb=round(float(net_bb_hand), 4),
                missed_ev_money=missed_ev,
            )
        )

    out.sort(
        key=lambda d: (
            -(d.severity if d.severity is not None else 0.0),
            d.played_at or "",
        ),
    )

    by_spot: list[PreflopSpotAccuracy] = []
    for key in _SPOT_ORDER:
        if key not in spot_stats:
            continue
        dec, cor = spot_stats[key]
        by_spot.append(
            PreflopSpotAccuracy(
                spot_key=key,
                label=spot_action_label(key),
                decisions=dec,
                correct=cor,
                correct_pct=_pct(cor, dec),
            )
        )
    for key, (dec, cor) in spot_stats.items():
        if key in _SPOT_ORDER:
            continue
        by_spot.append(
            PreflopSpotAccuracy(
                spot_key=key,
                label=spot_action_label(key),
                decisions=dec,
                correct=cor,
                correct_pct=_pct(cor, dec),
            )
        )

    by_position = [
        PreflopPositionOpenRow(
            position=pos,
            decisions=s["decisions"],
            opened=s["opened"],
            folded=s["folded"],
            called=s["called"],
            should_open=s["should_open"],
            opened_correct=s["opened_correct"],
            missed_opens=s["missed_opens"],
            should_fold=s["should_fold"],
            folded_correct=s["folded_correct"],
            wrong_opens=s["wrong_opens"],
            accuracy_pct=_pct(s["correct"], s["decisions"]),
        )
        for pos, s in sorted(pos_stats.items(), key=lambda kv: _pos_sort_key(kv[0]))
    ]

    by_branch: list[PreflopBranchAccuracy] = []
    for (sk, hp, vp), stats in sorted(
        branch_stats.items(),
        key=lambda kv: (_spot_sort_key(kv[0][0]), _pos_sort_key(kv[0][1]), kv[0][2]),
    ):
        dec, cor, profit_m, profit_bb = stats
        by_branch.append(
            PreflopBranchAccuracy(
                spot_key=sk,
                spot_label=format_branch_label(sk, hp, vp or None),
                hero_position=hp,
                villain_position=vp or None,
                pot_kind=spot_pot_kind(sk),
                pot_tag=spot_pot_tag(sk),
                matchup=pot_matchup_label(sk, hp, vp or None),
                decisions=int(dec),
                correct=int(cor),
                correct_pct=_pct(int(cor), int(dec)),
                profit_money=round(float(profit_m), 4),
                profit_bb=round(float(profit_bb), 4),
                winrate_bb100=round(
                    (float(profit_bb) / int(dec) * 100.0) if dec else 0.0, 2
                ),
            )
        )
    # Worst first so analysis “где убытки” is obvious.
    by_branch.sort(key=lambda r: (r.profit_money, -r.decisions))

    # HU flop pots (exactly 2 players) — matchup like BBvsSB for P/L report.
    hu_acc: dict[tuple[str, str], dict] = {}
    for hand in hands:
        branch = extract_hu_postflop_branch(hand.raw_text)
        if not branch:
            continue
        net_m, net_bb_hand = resolve_hand_result(hand)
        bkey = (branch["pot_kind"], branch["matchup"])
        row = hu_acc.get(bkey)
        if row is None:
            row = {
                "spot_key": branch["spot_key"],
                "hero_position": branch["hero_position"],
                "villain_position": branch["villain_position"],
                "pot_kind": branch["pot_kind"],
                "pot_tag": branch["pot_tag"],
                "matchup": branch["matchup"],
                "label": branch["label"],
                "hands_count": 0,
                "profit_money": 0.0,
                "profit_bb": 0.0,
            }
            hu_acc[bkey] = row
        row["hands_count"] += 1
        row["profit_money"] += float(net_m)
        row["profit_bb"] += float(net_bb_hand)

    hu_pot_branches: list[HuPotBranchRow] = []
    for row in hu_acc.values():
        n = int(row["hands_count"])
        hu_pot_branches.append(
            HuPotBranchRow(
                spot_key=row["spot_key"],
                hero_position=row["hero_position"],
                villain_position=row["villain_position"],
                pot_kind=row["pot_kind"],
                pot_tag=row["pot_tag"],
                matchup=row["matchup"],
                label=row["label"],
                hands_count=n,
                profit_money=round(float(row["profit_money"]), 4),
                profit_bb=round(float(row["profit_bb"]), 4),
                winrate_bb100=round(
                    (float(row["profit_bb"]) / n * 100.0) if n else 0.0, 2
                ),
            )
        )
    hu_pot_branches.sort(key=lambda r: (r.profit_money, -r.hands_count))

    # Matrix: spots with errors; cells = error counts per hand only
    chart_errors: list[ChartErrorSpot] = []
    for (sk, hp, vp), cells in sorted(
        chart_map.items(),
        key=lambda kv: (_spot_sort_key(kv[0][0]), _pos_sort_key(kv[0][1]), kv[0][2]),
    ):
        label = format_branch_label(sk, hp, vp or None)
        chart_errors.append(
            ChartErrorSpot(
                spot_key=sk,
                hero_position=hp,
                villain_position=vp or None,
                label=label,
                spot_id=chart_spot_ids.get((sk, hp, vp)),
                cells=[
                    ChartErrorCell(
                        hand_code=code,
                        opens=0,
                        errors=int(meta["errors"]),
                        raise_count=int(meta.get("raise", 0)),
                        call_count=int(meta.get("call", 0)),
                        fold_count=int(meta.get("fold", 0)),
                        actual_action=meta.get("actual_action"),
                        expected_action=meta.get("expected_action"),
                    )
                    for code, meta in sorted(
                        cells.items(), key=lambda kv: -kv[1]["errors"]
                    )
                ],
            )
        )

    opens = PreflopOpenBreakdown(
        decisions=open_decisions,
        opened=rfi_opened,
        folded=rfi_folded,
        called=rfi_called,
        should_open=should_open,
        opened_correct=opened_correct,
        missed_opens=missed_opens,
        should_fold=should_fold,
        folded_correct=folded_correct,
        wrong_opens=wrong_opens,
        open_follow_pct=_pct(opened_correct, should_open),
        fold_follow_pct=_pct(folded_correct, should_fold),
        accuracy_pct=_pct(open_correct, open_decisions),
    )

    capped = max(1, min(limit, 500))
    leak_finder = _build_leak_finder(
        rows=out,
        by_position=by_position,
        by_spot=by_spot,
        play_decisions=play_decisions,
        play_correct=play_correct,
    )
    return StrategyDeviationsResponse(
        strategy_id=str(strategy_id),
        total=len(out),
        decisions=decisions,
        correct=correct,
        correct_pct=_pct(correct, decisions),
        open_decisions=open_decisions,
        open_correct=open_correct,
        open_pct=_pct(open_correct, open_decisions),
        play_decisions=play_decisions,
        play_correct=play_correct,
        play_pct=_pct(play_correct, play_decisions),
        opens=opens,
        by_spot=by_spot,
        by_position=by_position,
        by_branch=by_branch,
        hu_pot_branches=hu_pot_branches,
        chart_errors=chart_errors,
        deviations=out[:capped],
        leak_finder=leak_finder,
    )
