"""Bankroll management: BRM strategies, game modes, stake recommendations."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.bankroll import BankrollEntry, BankrollSettings
from app.models.hand import Hand, PlaySession
from app.services.hand_dedupe import dedupe_hands_by_external_id
from app.services.results import resolve_hand_result

# --- Режимы игры ---
GameMode = str  # cash | mtt | spins

# Лестница кэш-лимитов: (метка, SB, BB, бай-ин 100бб). SB не всегда = BB/2 (NL5 = 0.02/0.05).
# Лестница кэш-лимитов PokerOK / GG: (метка, SB, BB, бай-ин). NL40 = $0.50/$1, дефолт $40.
CASH_STAKE_LADDER: list[tuple[str, Decimal, Decimal, Decimal]] = [
    ("NL2", Decimal("0.01"), Decimal("0.02"), Decimal("2")),
    ("NL5", Decimal("0.02"), Decimal("0.05"), Decimal("5")),
    ("NL10", Decimal("0.05"), Decimal("0.10"), Decimal("10")),
    ("NL25", Decimal("0.10"), Decimal("0.25"), Decimal("25")),
    ("NL50", Decimal("0.25"), Decimal("0.50"), Decimal("50")),
    ("NL40", Decimal("0.50"), Decimal("1.00"), Decimal("40")),
    ("NL200", Decimal("1.00"), Decimal("2.00"), Decimal("200")),
    ("NL400", Decimal("2.00"), Decimal("4.00"), Decimal("400")),
    ("NL1K", Decimal("5.00"), Decimal("10.00"), Decimal("1000")),
]

# Лестница МТТ: бай-ин = цена регистрации
MTT_STAKE_LADDER: list[tuple[str, Decimal, Decimal, Decimal]] = [
    ("MTT $1", Decimal("0"), Decimal("0"), Decimal("1")),
    ("MTT $3.30", Decimal("0"), Decimal("0"), Decimal("3.30")),
    ("MTT $5.50", Decimal("0"), Decimal("0"), Decimal("5.50")),
    ("MTT $11", Decimal("0"), Decimal("0"), Decimal("11")),
    ("MTT $22", Decimal("0"), Decimal("0"), Decimal("22")),
    ("MTT $55", Decimal("0"), Decimal("0"), Decimal("55")),
    ("MTT $109", Decimal("0"), Decimal("0"), Decimal("109")),
    ("MTT $215", Decimal("0"), Decimal("0"), Decimal("215")),
    ("MTT $530", Decimal("0"), Decimal("0"), Decimal("530")),
]

# Лестница Spin & Go
SPINS_STAKE_LADDER: list[tuple[str, Decimal, Decimal, Decimal]] = [
    ("Spin $0.25", Decimal("0"), Decimal("0"), Decimal("0.25")),
    ("Spin $1", Decimal("0"), Decimal("0"), Decimal("1")),
    ("Spin $3", Decimal("0"), Decimal("0"), Decimal("3")),
    ("Spin $7", Decimal("0"), Decimal("0"), Decimal("7")),
    ("Spin $15", Decimal("0"), Decimal("0"), Decimal("15")),
    ("Spin $30", Decimal("0"), Decimal("0"), Decimal("30")),
    ("Spin $60", Decimal("0"), Decimal("0"), Decimal("60")),
    ("Spin $100", Decimal("0"), Decimal("0"), Decimal("100")),
]


def stake_ladder_for(game_mode: str) -> list[tuple[str, Decimal, Decimal, Decimal]]:
    """Вернуть лестницу лимитов для режима."""
    if game_mode == "mtt":
        return MTT_STAKE_LADDER
    if game_mode == "spins":
        return SPINS_STAKE_LADDER
    return CASH_STAKE_LADDER


# Совместимость со старым именем
STAKE_LADDER = CASH_STAKE_LADDER


@dataclass(frozen=True)
class BrmStrategy:
    id: str
    name: str
    description: str
    session_tip: str
    # Сколько бай-инов держать: cash / mtt / spins
    buyins: dict[str, int]
    # Стоп-лосс шота (бай-ины) или None
    stop_loss_buyins: dict[str, int] | None


# 4 стратегии БРМ (константы математики)
BRM_STRATEGIES: list[BrmStrategy] = [
    BrmStrategy(
        id="conservative",
        name="Консервативная",
        description=(
            "Минимизирует риск разорения, подходит для стабильного заработка на дистанции."
        ),
        session_tip="Держитесь основного или мягкого лимита. Выше — только при устойчивом плюсе.",
        buyins={"cash": 100, "mtt": 200, "spins": 150},
        stop_loss_buyins=None,
    ),
    BrmStrategy(
        id="standard",
        name="Стандартная",
        description=(
            "Сбалансированный подход: рост по лимитам без лишнего стресса от дисперсии."
        ),
        session_tip="Играйте основной лимит. Мягкий — при плохой форме или жёстком поле.",
        buyins={"cash": 50, "mtt": 100, "spins": 100},
        stop_loss_buyins=None,
    ),
    BrmStrategy(
        id="aggressive",
        name="Агрессивная",
        description="Быстрый рост капитала с повышенным риском даунсвинга.",
        session_tip="Основной лимит по расчёту. Выше — только после серии плюсовых сессий.",
        buyins={"cash": 30, "mtt": 50, "spins": 60},
        stop_loss_buyins=None,
    ),
    BrmStrategy(
        id="shot_taking",
        name="Шот-менеджмент",
        description=(
            "Экстремальный БРМ для перехода на лимит выше с чётким стоп-лоссом."
        ),
        session_tip="Шот короткий: при достижении стоп-лосса сразу спускайтесь — без отыгрыша.",
        buyins={"cash": 15, "mtt": 20, "spins": 25},
        stop_loss_buyins={"cash": 3, "mtt": 5, "spins": 5},
    ),
]

STRATEGY_MAP = {s.id: s for s in BRM_STRATEGIES}

# Старые id из UI/БД → актуальные
_PROFILE_ALIASES = {
    "degen": "shot_taking",
    "balanced": "standard",
    "nit": "conservative",
    "professional": "conservative",
}

GAME_MODES = ("cash", "mtt", "spins")


def resolve_profile_id(profile_id: str) -> str | None:
    if profile_id in STRATEGY_MAP:
        return profile_id
    return _PROFILE_ALIASES.get(profile_id)


def resolve_game_mode(game_mode: str | None) -> str:
    if game_mode in GAME_MODES:
        return game_mode  # type: ignore[return-value]
    return "cash"


def buyins_target_for(strategy_id: str, game_mode: str) -> int:
    """Целевое число бай-инов = стратегия × режим."""
    strategy = STRATEGY_MAP.get(resolve_profile_id(strategy_id) or "standard")
    if strategy is None:
        return 50
    mode = resolve_game_mode(game_mode)
    return strategy.buyins.get(mode, strategy.buyins["cash"])


def buyins_range_label(strategy: BrmStrategy, game_mode: str) -> str:
    mode = resolve_game_mode(game_mode)
    n = strategy.buyins[mode]
    if mode == "cash":
        # 1 бай-ин кэша = 100 бб
        return f"{n} бай-инов ({n * 100} бб)"
    return f"{n} бай-инов"


def profiles_payload(game_mode: str = "cash") -> list[dict]:
    mode = resolve_game_mode(game_mode)
    out: list[dict] = []
    for s in BRM_STRATEGIES:
        stop = s.stop_loss_buyins[mode] if s.stop_loss_buyins else None
        tip = s.session_tip
        if stop is not None:
            tip = f"{tip} Стоп-лосс: −{stop} бай-ина."
        out.append(
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "buyins_range": buyins_range_label(s, mode),
                "buyins_target": s.buyins[mode],
                "session_tip": tip,
                "stop_loss_buyins": stop,
            }
        )
    return out


def get_or_create_settings(db: Session, user_id: UUID) -> BankrollSettings:
    settings = db.get(BankrollSettings, user_id)
    if settings is None:
        settings = BankrollSettings(
            user_id=user_id,
            balance=Decimal("0"),
            currency="USD",
            risk_profile="standard",
            buyins_target=50,
            game_mode="cash",
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    # Миграция на лету: синхронизировать buyins_target с режимом
    resolved = resolve_profile_id(settings.risk_profile) or "standard"
    mode = resolve_game_mode(getattr(settings, "game_mode", None) or "cash")
    target = buyins_target_for(resolved, mode)
    dirty = False
    if settings.risk_profile != resolved:
        settings.risk_profile = resolved
        dirty = True
    if getattr(settings, "game_mode", None) != mode:
        settings.game_mode = mode
        dirty = True
    if settings.buyins_target != target:
        settings.buyins_target = target
        dirty = True
    if dirty:
        db.commit()
        db.refresh(settings)
    return settings


def recommended_buyin(balance: Decimal, buyins_target: int) -> Decimal:
    """Доступный размер бай-ина: банкролл / число бай-инов БРМ."""
    if buyins_target <= 0:
        return Decimal("0")
    return (balance / Decimal(buyins_target)).quantize(Decimal("0.01"))


def _blinds_caption(sb: Decimal, bb: Decimal, game_mode: str) -> str:
    if game_mode != "cash" or bb <= 0:
        return ""
    return f" (${sb.quantize(Decimal('0.01'))} / ${bb.quantize(Decimal('0.01'))})"


def recommend_stakes(
    balance: Decimal,
    buyins_target: int,
    game_mode: str = "cash",
) -> list[dict]:
    """Подобрать soft / primary / stretch по лестнице режима."""
    mode = resolve_game_mode(game_mode)
    ladder = stake_ladder_for(mode)
    bi = recommended_buyin(balance, buyins_target)
    if bi <= 0:
        return []

    affordable = [s for s in ladder if s[3] <= bi]
    if not affordable:
        label, _sb, bb, buyin = ladder[0]
        needed = (buyin * Decimal(buyins_target)).quantize(Decimal("0.01"))
        have_bi = (balance / buyin).quantize(Decimal("0.1")) if buyin > 0 else Decimal("0")
        return [
            {
                "label": label,
                "big_blind": float(bb),
                "buyin_100bb": float(buyin),
                "role": "primary",
                "note": (
                    f"Банкролл ниже цели стиля (~{have_bi} из {buyins_target} бай-инов на {label}). "
                    f"Для полного запаса нужно ~{needed}."
                ),
                "shortfall": True,
            }
        ]

    primary_idx = next(i for i, s in enumerate(ladder) if s[0] == affordable[-1][0])
    roles: list[tuple[int, str, str]] = []
    if primary_idx > 0:
        roles.append((primary_idx - 1, "soft", "Мягкий / запасной лимит"))
    roles.append((primary_idx, "primary", "Основной лимит по вашему БРМ"))
    if primary_idx + 1 < len(ladder):
        roles.append((primary_idx + 1, "stretch", "Шот / переход на лимит выше"))

    out: list[dict] = []
    for idx, role, note in roles:
        label, _sb, bb, buyin = ladder[idx]
        out.append(
            {
                "label": label,
                "big_blind": float(bb),
                "buyin_100bb": float(buyin),
                "role": role,
                "note": note,
            }
        )
    return out


def build_limit_verdict(
    balance: Decimal,
    buyins_target: int,
    game_mode: str,
    strategy: BrmStrategy,
) -> dict:
    """Вердикт для плашки: ok / shot / drop / shortfall / empty."""
    mode = resolve_game_mode(game_mode)
    ladder = stake_ladder_for(mode)
    stop = strategy.stop_loss_buyins[mode] if strategy.stop_loss_buyins else None

    if balance <= 0 or buyins_target <= 0:
        return {
            "status": "empty",
            "headline": "Задайте банкролл",
            "detail": "Укажите текущую сумму — система рассчитает лимит по выбранному БРМ.",
            "affordable_buyin": 0.0,
            "required_buyins": buyins_target,
            "stop_loss_buyins": stop,
        }

    # affordable = BR / N бай-инов
    affordable = recommended_buyin(balance, buyins_target)
    affordable_list = [s for s in ladder if s[3] <= affordable]

    if not affordable_list:
        label, sb, bb, buyin = ladder[0]
        need = float(buyin * Decimal(buyins_target))
        cap = _blinds_caption(sb, bb, mode)
        return {
            "status": "shortfall",
            "headline": f"Цель: {label}{cap}",
            "detail": (
                f"Банкролл ниже минимума стиля. Для {buyins_target} бай-инов на {label} "
                f"нужно ≈ ${need:.2f}."
            ),
            "affordable_buyin": float(affordable),
            "required_buyins": buyins_target,
            "stop_loss_buyins": stop,
            "recommended_label": label,
            "previous_label": None,
            "next_label": ladder[1][0] if len(ladder) > 1 else None,
        }

    primary_idx = next(i for i, s in enumerate(ladder) if s[0] == affordable_list[-1][0])
    label, sb, bb, buyin = ladder[primary_idx]
    prev_label = ladder[primary_idx - 1][0] if primary_idx > 0 else None
    next_t = ladder[primary_idx + 1] if primary_idx + 1 < len(ladder) else None
    next_label = next_t[0] if next_t else None
    cap = _blinds_caption(sb, bb, mode)
    have_on_primary = float(balance / buyin) if buyin > 0 else 0.0

    status = "ok"
    headline = f"Ваш рекомендуемый лимит: {label}{cap}"
    detail = "Ваш банкролл полностью соответствует правилам дисциплины."

    if next_t is not None:
        need_next = next_t[3] * Decimal(buyins_target)
        next_cap = _blinds_caption(next_t[1], next_t[2], mode)
        if balance >= need_next:
            status = "shot"
            headline = f"Доступен переход! Шот на {next_label}{next_cap}"
            detail = (
                f"Основной лимит по дисциплине — {label}{cap}. "
                "Банкролл уже тянет следующий уровень."
            )
        elif have_on_primary < buyins_target * 0.85 and prev_label:
            prev_sb, prev_bb = ladder[primary_idx - 1][1], ladder[primary_idx - 1][2]
            prev_cap = _blinds_caption(prev_sb, prev_bb, mode)
            status = "drop"
            headline = f"Внимание: спуститесь на {prev_label}{prev_cap}"
            detail = (
                f"Запас ниже комфортного ({have_on_primary:.0f} из {buyins_target} "
                f"бай-инов на {label})."
            )

    if stop is not None:
        detail = f"{detail} Стоп-лосс шота: −{stop} бай-ина — затем обязательный спуск."

    return {
        "status": status,
        "headline": headline,
        "detail": detail,
        "affordable_buyin": float(affordable),
        "required_buyins": buyins_target,
        "stop_loss_buyins": stop,
        "recommended_label": label,
        "previous_label": prev_label,
        "next_label": next_label,
    }


def stake_fit(session_bb: Decimal | float | None, stakes: list[dict]) -> str:
    """ok | soft | high | low | unknown — how session stakes fit recommendation."""
    if session_bb is None or not stakes:
        return "unknown"
    bb = float(session_bb)
    primary = next((s for s in stakes if s["role"] == "primary"), None)
    soft = next((s for s in stakes if s["role"] == "soft"), None)
    stretch = next((s for s in stakes if s["role"] == "stretch"), None)
    if primary is None:
        return "unknown"

    def near(a: float, b: float) -> bool:
        return abs(a - b) < max(0.005, b * 0.05)

    if near(bb, primary["big_blind"]):
        return "ok"
    if soft and near(bb, soft["big_blind"]):
        return "soft"
    if stretch and near(bb, stretch["big_blind"]):
        return "stretch"
    if bb > primary["big_blind"]:
        return "high"
    return "low"


def settings_payload(settings: BankrollSettings) -> dict:
    resolved = resolve_profile_id(settings.risk_profile) or settings.risk_profile
    strategy = STRATEGY_MAP.get(resolved)
    mode = resolve_game_mode(getattr(settings, "game_mode", None) or "cash")
    balance = Decimal(settings.balance)
    buyins = buyins_target_for(resolved, mode)
    buyin = recommended_buyin(balance, buyins)
    stakes = recommend_stakes(balance, buyins, mode)
    primary = next((s for s in stakes if s["role"] == "primary"), None)
    verdict = (
        build_limit_verdict(balance, buyins, mode, strategy)
        if strategy
        else {"status": "empty", "headline": "", "detail": ""}
    )
    stop = strategy.stop_loss_buyins[mode] if strategy and strategy.stop_loss_buyins else None
    tip = strategy.session_tip if strategy else ""
    if stop is not None:
        tip = f"{tip} Стоп-лосс: −{stop} бай-ина."

    return {
        "balance": float(balance),
        "currency": settings.currency,
        "game_mode": mode,
        "risk_profile": resolved,
        "risk_profile_name": strategy.name if strategy else settings.risk_profile,
        "risk_description": strategy.description if strategy else "",
        "buyins_range": buyins_range_label(strategy, mode) if strategy else "",
        "buyins_target": buyins,
        "recommended_buyin": float(buyin),
        "recommended_stakes": stakes,
        "primary_stake": primary["label"] if primary else None,
        "session_tip": tip,
        "stop_loss_buyins": stop,
        "limit_verdict": verdict,
        "goal_stake": getattr(settings, "goal_stake", None),
        "updated_at": settings.updated_at,
    }


def set_balance(
    db: Session,
    user_id: UUID,
    *,
    amount: Decimal,
    note: str | None = None,
) -> tuple[BankrollSettings, BankrollEntry]:
    if amount < 0:
        raise ValueError("Банкролл не может быть отрицательным")

    settings = get_or_create_settings(db, user_id)
    current = Decimal(settings.balance)
    new_balance = amount.quantize(Decimal("0.01"))
    delta = (new_balance - current).quantize(Decimal("0.01"))

    settings.balance = new_balance
    entry = BankrollEntry(
        user_id=user_id,
        kind="set",
        amount=delta,
        balance_after=new_balance,
        note=note or "Ручное обновление банкролла",
    )
    db.add(entry)
    db.commit()
    db.refresh(settings)
    db.refresh(entry)
    return settings, entry


def set_risk_profile(db: Session, user_id: UUID, profile_id: str) -> BankrollSettings:
    resolved = resolve_profile_id(profile_id)
    if resolved is None:
        raise ValueError("Неизвестная стратегия банкролл-менеджмента")
    settings = get_or_create_settings(db, user_id)
    mode = resolve_game_mode(getattr(settings, "game_mode", None) or "cash")
    settings.risk_profile = resolved
    settings.buyins_target = buyins_target_for(resolved, mode)
    db.commit()
    db.refresh(settings)
    return settings


def set_game_mode(db: Session, user_id: UUID, game_mode: str) -> BankrollSettings:
    if game_mode not in GAME_MODES:
        raise ValueError("Неизвестный режим игры")
    settings = get_or_create_settings(db, user_id)
    resolved = resolve_profile_id(settings.risk_profile) or "standard"
    settings.game_mode = game_mode
    settings.buyins_target = buyins_target_for(resolved, game_mode)
    db.commit()
    db.refresh(settings)
    return settings


def update_career_prefs(
    db: Session,
    user_id: UUID,
    *,
    risk_profile: str | None = None,
    game_mode: str | None = None,
    currency: str | None = None,
    goal_stake: str | None = None,
    clear_goal: bool = False,
) -> BankrollSettings:
    """Обновить профиль БРМ, режим и/или цель по лимиту."""
    settings = get_or_create_settings(db, user_id)
    if risk_profile is not None:
        resolved = resolve_profile_id(risk_profile)
        if resolved is None:
            raise ValueError("Неизвестная стратегия банкролл-менеджмента")
        settings.risk_profile = resolved
    if game_mode is not None:
        if game_mode not in GAME_MODES:
            raise ValueError("Неизвестный режим игры")
        settings.game_mode = game_mode
    if currency:
        settings.currency = currency.upper()[:8]

    resolved = resolve_profile_id(settings.risk_profile) or "standard"
    mode = resolve_game_mode(settings.game_mode)
    settings.risk_profile = resolved
    settings.game_mode = mode
    settings.buyins_target = buyins_target_for(resolved, mode)

    if clear_goal:
        settings.goal_stake = None
    elif goal_stake is not None:
        label = goal_stake.strip()
        if not label:
            settings.goal_stake = None
        else:
            ladder = stake_ladder_for(mode)
            if not any(row[0] == label for row in ladder):
                raise ValueError("Цель должна быть лимитом из лестницы текущего режима")
            settings.goal_stake = label

    # Если режим сменился и старая цель не из новой лестницы — сбросить
    current_goal = getattr(settings, "goal_stake", None)
    if current_goal:
        ladder_labels = {row[0] for row in stake_ladder_for(mode)}
        if current_goal not in ladder_labels:
            settings.goal_stake = None

    db.commit()
    db.refresh(settings)
    return settings


def list_entries(db: Session, user_id: UUID, limit: int = 50) -> list[BankrollEntry]:
    return list(
        db.scalars(
            select(BankrollEntry)
            .where(BankrollEntry.user_id == user_id)
            .order_by(BankrollEntry.created_at.desc())
            .limit(limit)
        )
    )


def _session_ids_applied_to_bankroll(db: Session, user_id: UUID) -> set[UUID]:
    rows = db.scalars(
        select(BankrollEntry.session_id).where(
            BankrollEntry.user_id == user_id,
            BankrollEntry.kind == "session",
            BankrollEntry.session_id.is_not(None),
        )
    )
    return {sid for sid in rows if sid is not None}


def _external_ids_already_in_bankroll(db: Session, user_id: UUID) -> set[str]:
    """Hand IDs whose profit was already counted in a prior session BR entry."""
    session_ids = _session_ids_applied_to_bankroll(db, user_id)
    if not session_ids:
        return set()
    return set(
        db.scalars(
            select(Hand.external_hand_id).where(
                Hand.session_id.in_(session_ids),
                Hand.external_hand_id.is_not(None),
            )
        )
    )


def apply_session_to_bankroll(
    db: Session,
    user_id: UUID,
    session_id: UUID,
) -> BankrollEntry | None:
    """Add session profit/loss to BR once. Skips duplicate sessions and hands."""
    existing = db.scalar(
        select(BankrollEntry).where(
            BankrollEntry.user_id == user_id,
            BankrollEntry.kind == "session",
            BankrollEntry.session_id == session_id,
        )
    )
    if existing is not None:
        return existing

    session = db.get(PlaySession, session_id)
    if session is None or session.user_id != user_id:
        return None

    hands = list(db.scalars(select(Hand).where(Hand.session_id == session_id)))
    hands = dedupe_hands_by_external_id(hands)
    already = _external_ids_already_in_bankroll(db, user_id)
    new_hands = [h for h in hands if h.external_hand_id and h.external_hand_id not in already]
    if not new_hands:
        return None

    profit = Decimal("0")
    for hand in new_hands:
        net, _ = resolve_hand_result(hand)
        profit += Decimal(str(net))
    profit = profit.quantize(Decimal("0.01"))

    settings = get_or_create_settings(db, user_id)
    new_balance = (Decimal(settings.balance) + profit).quantize(Decimal("0.01"))
    settings.balance = new_balance

    label = (session.label or session.source_filename or "сессия").strip()
    sign = "+" if profit > 0 else ""
    note = f"Сессия {label} · {sign}{profit}"

    entry = BankrollEntry(
        user_id=user_id,
        kind="session",
        amount=profit,
        balance_after=new_balance,
        note=note,
        session_id=session_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(settings)
    db.refresh(entry)
    return entry
