"""Subscription plan catalogue and limits (mock billing)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


UNLIMITED = -1


@dataclass(frozen=True, slots=True)
class PlanDef:
    id: str
    name: str
    tagline: str
    price_usd: int
    price_rub: int
    max_strategies: int  # -1 = unlimited
    max_hands_per_month: int  # -1 = unlimited
    features: tuple[str, ...]
    highlights: tuple[str, ...]
    is_hit: bool = False


PLANS: dict[str, PlanDef] = {
    "starter": PlanDef(
        id="starter",
        name="STARTER",
        tagline="Микролимиты · NL2 – NL10",
        price_usd=15,
        price_rub=1500,
        max_strategies=3,
        max_hands_per_month=20_000,
        features=("preflop_basic",),
        highlights=(
            "До 3 кастомных стратегий",
            "Анализ до 20 000 раздач в месяц",
            "Базовый префлоп-анализ (ошибки первого действия)",
        ),
    ),
    "regular": PlanDef(
        id="regular",
        name="REGULAR",
        tagline="Средние лимиты · NL25 – NL100",
        price_usd=45,
        price_rub=4500,
        max_strategies=15,
        max_hands_per_month=100_000,
        features=("preflop_basic", "preflop_full", "error_dynamics"),
        highlights=(
            "До 15 кастомных стратегий",
            "Анализ до 100 000 раздач в месяц",
            "Полный анализ (префлоп + базовый постфлоп)",
            "График динамики ошибок за месяц",
        ),
        is_hit=True,
    ),
    "high_stakes": PlanDef(
        id="high_stakes",
        name="HIGH STAKES",
        tagline="Хайроллеры · NL200+ / MTT",
        price_usd=119,
        price_rub=11_000,
        max_strategies=UNLIMITED,
        max_hands_per_month=UNLIMITED,
        features=(
            "preflop_basic",
            "preflop_full",
            "error_dynamics",
            "priority_queue",
            "deep_filters",
        ),
        highlights=(
            "Безлимит стратегий и раздач",
            "Приоритетная очередь обработки логов",
            "Глубокая фильтрация ошибок по позициям и сайзингам",
        ),
    ),
    "team": PlanDef(
        id="team",
        name="TEAM / IN-GAME FUND",
        tagline="Покерные школы и бэкинг",
        price_usd=299,
        price_rub=29_000,
        max_strategies=UNLIMITED,
        max_hands_per_month=UNLIMITED,
        features=(
            "preflop_basic",
            "preflop_full",
            "error_dynamics",
            "priority_queue",
            "deep_filters",
            "team_admin",
        ),
        highlights=(
            "Стратегии фонда для учеников",
            "Панель тренера: дисциплина до 30 учеников",
            "Безлимит стратегий и раздач",
        ),
    ),
}

DEFAULT_PLAN_ID = "starter"


def get_plan(plan_id: str | None) -> PlanDef:
    if plan_id and plan_id in PLANS:
        return PLANS[plan_id]
    return PLANS[DEFAULT_PLAN_ID]


def plan_to_dict(plan: PlanDef) -> dict[str, Any]:
    return {
        "id": plan.id,
        "name": plan.name,
        "tagline": plan.tagline,
        "price_usd": plan.price_usd,
        "price_rub": plan.price_rub,
        "max_strategies": None if plan.max_strategies == UNLIMITED else plan.max_strategies,
        "max_hands_per_month": None if plan.max_hands_per_month == UNLIMITED else plan.max_hands_per_month,
        "features": list(plan.features),
        "highlights": list(plan.highlights),
        "is_hit": plan.is_hit,
        "unlimited_strategies": plan.max_strategies == UNLIMITED,
        "unlimited_hands": plan.max_hands_per_month == UNLIMITED,
    }


def list_plans() -> list[dict[str, Any]]:
    return [plan_to_dict(p) for p in PLANS.values()]
