"""Preflop decision trainer: replay to hero's spot, grade vs strategy charts."""

from __future__ import annotations

import random
import time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, HandAction, HandUpload, PlaySession
from app.schemas.analysis import (
    TrainerDealResponse,
    TrainerGradeRequest,
    TrainerGradeResponse,
)
from app.services.deviation import is_deviation, is_in_play_range, pick_expected_action
from app.services.hand_replay import build_replay_hand
from app.models.strategy import Strategy
from app.services.strategy_match import (
    POS_ALIASES,
    hero_preflop_action,
    load_spot_maps,
    resolve_cell_freqs,
)
from app.services.strategy_modules import stack_window

from app.services.spot_labels import format_branch_label

# Fallback Cash ~100bb effective stack window
_STACK_BB_MIN = Decimal("70")
_STACK_BB_MAX = Decimal("140")

# cache key → (expires_at, hand_ids)
_POOL_CACHE: dict[tuple, tuple[float, list[UUID]]] = {}
_POOL_TTL_SEC = 180.0
_CHUNK = 40


def invalidate_trainer_cache(*, strategy_id: UUID | None = None) -> None:
    """Drop cached trainer pools (call after chart edits)."""
    if strategy_id is None:
        _POOL_CACHE.clear()
        return
    dead = [k for k in _POOL_CACHE if len(k) >= 2 and k[1] == strategy_id]
    for k in dead:
        _POOL_CACHE.pop(k, None)


def _load_owned_hand(db: Session, user_id: UUID, hand_id: UUID) -> Hand | None:
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    return db.scalar(
        select(Hand)
        .options(selectinload(Hand.actions))
        .where(
            Hand.id == hand_id,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
    )


def _hero_decision_index(hand: Hand) -> int | None:
    actions = sorted(hand.actions, key=lambda a: a.action_order)
    for i, a in enumerate(actions):
        if a.street != "preflop" or not a.is_hero:
            continue
        if a.action in {"raise", "call", "fold"}:
            return i
    return None


def _spot_label(spot) -> str:
    return format_branch_label(
        spot.spot_key,
        spot.hero_position,
        spot.villain_position,
    )


def _database_session_ids(user_id: UUID, database_id: UUID | None = None):
    """All sittings in the profile hand DB (active + archived) — same pool as Career."""
    q = select(PlaySession.id).where(PlaySession.user_id == user_id)
    if database_id is not None:
        q = q.where(PlaySession.database_id == database_id)
    return q


def _expand_positions(positions: list[str] | None) -> list[str] | None:
    """Selected filter seats → all HH labels that match (HJ↔MP, …)."""
    if not positions:
        return None
    out: set[str] = set()
    for raw in positions:
        key = raw.strip().upper()
        if not key:
            continue
        out.add(key)
        for alias, group in POS_ALIASES.items():
            if key == alias or key in group:
                out.add(alias)
                out.update(group)
    return sorted(out) if out else None


def _stack_bounds(db: Session, strategy_id: UUID) -> tuple[Decimal, Decimal]:
    strategy = db.get(Strategy, strategy_id)
    if strategy is None:
        return _STACK_BB_MIN, _STACK_BB_MAX
    lo, hi = stack_window(strategy.format, strategy.stack_depth, strategy.action_mode)
    if lo is None or hi is None:
        return _STACK_BB_MIN, _STACK_BB_MAX
    return Decimal(str(lo)), Decimal(str(hi))


def _painted_chart_meta(
    spot_by_key: dict,
    cell_by_key: dict,
) -> tuple[set[str], set[str]]:
    """Return (spot_keys, hero_positions) that have at least one painted chart."""
    painted_ids: set[UUID] = set()
    for (sid, _), cell in cell_by_key.items():
        if Decimal(str(cell.raise_freq)) > 0 or Decimal(str(cell.call_freq)) > 0:
            painted_ids.add(sid)
    keys: set[str] = set()
    heroes: set[str] = set()
    for (sk, hero, _vill), spot in spot_by_key.items():
        if spot.id not in painted_ids:
            continue
        keys.add(sk)
        heroes.add(hero.upper())
    return keys, heroes


def _candidate_filters(
    user_id: UUID,
    positions: list[str] | None,
    *,
    stack_min: Decimal,
    stack_max: Decimal,
    database_id: UUID | None = None,
    spot_keys: set[str] | None = None,
):
    # Include hands with unknown stack (snapshot rows) — still trainable vs charts.
    stack_ok = or_(
        Hand.stack_bb.is_(None),
        and_(Hand.stack_bb >= stack_min, Hand.stack_bb <= stack_max),
    )
    has_actions = (
        select(HandAction.id).where(HandAction.hand_id == Hand.id).exists()
    )
    clauses = [
        Hand.session_id.in_(_database_session_ids(user_id, database_id)),
        Hand.hero_hand_code.is_not(None),
        Hand.detected_spot.is_not(None),
        Hand.hero_position.is_not(None),
        stack_ok,
        has_actions,
    ]
    if spot_keys:
        clauses.append(Hand.detected_spot.in_(sorted(spot_keys)))
    expanded = _expand_positions(positions)
    if expanded:
        clauses.append(func.upper(Hand.hero_position).in_(expanded))
    return and_(*clauses)


def _load_pool_ids(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    mode: str,
    positions: list[str] | None,
    *,
    spot_keys: set[str] | None = None,
) -> list[UUID]:
    from app.models.user import User
    from app.services import databases as db_svc

    user = db.get(User, user_id)
    database_id = db_svc.get_active_database_id(db, user) if user else None

    pos_key = ",".join(sorted(p.upper() for p in (positions or [])))
    spots_key = ",".join(sorted(spot_keys or ()))
    key = (user_id, strategy_id, mode, pos_key, spots_key, str(database_id))
    now = time.monotonic()
    hit = _POOL_CACHE.get(key)
    if hit and hit[0] > now:
        return list(hit[1])

    stack_min, stack_max = _stack_bounds(db, strategy_id)
    ids = list(
        db.scalars(
            select(Hand.id)
            .where(
                _candidate_filters(
                    user_id,
                    positions,
                    stack_min=stack_min,
                    stack_max=stack_max,
                    database_id=database_id,
                    spot_keys=spot_keys,
                )
            )
            .order_by(func.random())
            .limit(2500)
        )
    )
    _POOL_CACHE[key] = (now + _POOL_TTL_SEC, ids)
    return list(ids)


def _try_deal(
    hand: Hand,
    spot_by_key,
    cell_by_key,
    *,
    mode: str,
    spots: set[str] | None = None,
) -> tuple[object, int] | None:
    if not hand.hero_hand_code or not hand.detected_spot or not hand.hero_position:
        return None
    if spots and hand.detected_spot not in spots:
        return None
    actual = hero_preflop_action(hand)
    if not actual:
        return None
    idx = _hero_decision_index(hand)
    if idx is None:
        return None
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key=hand.detected_spot,
        hero_position=hand.hero_position,
        villain_position=hand.villain_position,
        hand_code=hand.hero_hand_code,
    )
    if resolved is None:
        return None
    spot, raise_f, call_f, fold_f = resolved
    if mode == "errors" and not is_deviation(actual, raise_f, call_f, fold_f):
        return None
    return spot, idx


def next_trainer_deal(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    *,
    mode: str = "all",
    exclude_ids: list[UUID] | None = None,
    positions: list[str] | None = None,
    spots: list[str] | None = None,
) -> TrainerDealResponse:
    mode_key = mode if mode in {"all", "errors"} else "all"
    exclude = {x for x in (exclude_ids or [])}
    pos_filter = [p.strip().upper() for p in (positions or []) if p.strip()] or None
    spot_filter = {s.strip().lower() for s in (spots or []) if s.strip()} or None
    spot_by_key, cell_by_key = load_spot_maps(db, strategy_id)

    chart_keys, chart_heroes = _painted_chart_meta(spot_by_key, cell_by_key)
    if not chart_keys:
        raise LookupError(
            "В стратегии нет закрашенных чартов — открой конструктор, добавь ветки и закрась диапазоны"
        )

    usable_keys = chart_keys
    if spot_filter:
        usable_keys = chart_keys & spot_filter
        if not usable_keys:
            have = ", ".join(sorted(chart_keys))
            raise LookupError(
                f"Нет чартов для выбранных ситуаций. В стратегии закрашено: {have}"
            )

    # Prefer seats that actually have painted charts (UI filter ∩ chart heroes).
    seat_filter = pos_filter
    if chart_heroes:
        chart_seat_labels = _expand_positions(sorted(chart_heroes)) or sorted(chart_heroes)
        if pos_filter:
            ui_seats = set(_expand_positions(pos_filter) or pos_filter)
            overlap = ui_seats & set(chart_seat_labels)
            if not overlap:
                raise LookupError(
                    "Фильтр позиций не пересекается с закрашенными чартами — "
                    f"в стратегии есть: {', '.join(sorted(chart_heroes))}"
                )
            seat_filter = sorted(overlap)
        else:
            seat_filter = chart_seat_labels

    def load_pool() -> list[UUID]:
        return [
            i
            for i in _load_pool_ids(
                db,
                user_id,
                strategy_id,
                mode_key,
                seat_filter,
                spot_keys=usable_keys,
            )
            if i not in exclude
        ]

    pool_ids = load_pool()
    if not pool_ids:
        invalidate_trainer_cache(strategy_id=strategy_id)
        pool_ids = load_pool()

    if not pool_ids:
        have = ", ".join(sorted(usable_keys))
        raise LookupError(
            f"В базе профиля нет раздач под чарты ({have}) — загрузи историю в Анализ "
            "или сними фильтр позиций"
        )

    random.shuffle(pool_ids)
    pool_size = len(pool_ids) + len(exclude)

    # Scan the whole pool (not just the first ~200) so rare chart matches still hit.
    for c in range(0, len(pool_ids), _CHUNK):
        chunk_ids = pool_ids[c : c + _CHUNK]
        hands = list(
            db.scalars(
                select(Hand)
                .options(selectinload(Hand.actions))
                .where(Hand.id.in_(chunk_ids))
            )
        )
        random.shuffle(hands)
        for hand in hands:
            found = _try_deal(
                hand,
                spot_by_key,
                cell_by_key,
                mode=mode_key,
                spots=usable_keys,
            )
            if found is None:
                continue
            spot, decision_index = found
            return TrainerDealResponse(
                strategy_id=str(strategy_id),
                hand_id=str(hand.id),
                hand_code=hand.hero_hand_code or "",
                spot_key=spot.spot_key,
                spot_label=_spot_label(spot),
                hero_position=hand.hero_position,
                villain_position=hand.villain_position or spot.villain_position,
                decision_index=decision_index,
                pause_at=decision_index - 1,
                pool_size=pool_size,
                hand=build_replay_hand(hand),
            )

    if mode_key == "errors":
        raise LookupError(
            "Нет ошибок против закрашенных чартов — переключи режим на «Все» "
            "или догрузи сессию"
        )
    raise LookupError(
        "Есть раздачи и чарты, но нет совпадения по позиции героя — "
        "закрась нужные позиции в конструкторе или сними фильтр позиций"
    )


def grade_trainer_deal(
    db: Session,
    user_id: UUID,
    strategy_id: UUID,
    payload: TrainerGradeRequest,
) -> TrainerGradeResponse:
    action = payload.action.strip().lower()
    if action not in {"fold", "call", "raise"}:
        raise ValueError("action must be fold, call, or raise")

    try:
        hand_id = UUID(payload.hand_id)
    except ValueError as exc:
        raise LookupError("Раздача не найдена") from exc

    hand = _load_owned_hand(db, user_id, hand_id)
    if hand is None:
        raise LookupError("Раздача не найдена")

    # Always fresh charts — never use a stale in-memory pool for grading
    spot_by_key, cell_by_key = load_spot_maps(db, strategy_id)
    if not hand.detected_spot or not hand.hero_position or not hand.hero_hand_code:
        raise ValueError("Нет чарта для этой раздачи")

    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key=hand.detected_spot,
        hero_position=hand.hero_position,
        villain_position=hand.villain_position,
        hand_code=hand.hero_hand_code,
    )
    if resolved is None:
        raise ValueError("Нет чарта для этой раздачи")

    spot, raise_f, call_f, fold_f = resolved
    strategy = db.get(Strategy, strategy_id)
    action_mode = (strategy.action_mode if strategy else "standard") or "standard"
    if action_mode == "push_fold":
        call_f = Decimal("0")
        if action == "call":
            correct = False
        else:
            correct = not is_deviation(action, raise_f, call_f, fold_f)
    else:
        correct = not is_deviation(action, raise_f, call_f, fold_f)
    expected = pick_expected_action(raise_f, call_f, fold_f)
    in_range = is_in_play_range(raise_f, call_f)
    played = hero_preflop_action(hand)

    if action_mode == "push_fold":
        push_label = "all-in"
        if correct:
            tip = f"Верно — {push_label if action == 'raise' else action} по Push-Fold чарту."
        elif action == "call":
            tip = "Ошибка — в Push-Fold нет колла: только All-in или Fold."
        elif action == "raise" and not in_range:
            tip = "Ошибка — по чарту Fold (рука вне push-диапазона)."
        elif action == "fold" and in_range:
            tip = f"Ошибка — по чарту нужно пушить (часто {expected})."
        else:
            tip = f"Ошибка — по чарту чаще {expected}."
    elif correct:
        if action in ("raise", "call") and in_range:
            tip = "Верно — рука в диапазоне (raise/call по чарту)."
        elif action == "fold" and fold_f >= Decimal("0.005"):
            tip = "Верно — fold есть в миксе чарта."
        else:
            tip = "Верно."
    elif action in ("raise", "call") and not in_range:
        tip = (
            f"Ошибка — по чарту fold "
            f"(R {float(raise_f):.0%} / C {float(call_f):.0%} / F {float(fold_f):.0%}). "
            "Если только что правил дерево — подожди авто-синк чартов (~1с) и попробуй снова."
        )
    elif action == "fold" and in_range and fold_f < Decimal("0.005"):
        tip = f"Ошибка — по чарту нужно играть (часто {expected})."
    else:
        tip = f"Ошибка — по чарту чаще {expected}."

    return TrainerGradeResponse(
        hand_id=str(hand.id),
        correct=correct,
        chosen=action,
        expected_action=expected,
        raise_freq=float(raise_f),
        call_freq=float(call_f),
        fold_freq=float(fold_f),
        in_range=in_range,
        spot_label=_spot_label(spot),
        hand_code=hand.hero_hand_code or "",
        tip=tip,
        played_in_hh=played,
        hand=build_replay_hand(hand),
    )
