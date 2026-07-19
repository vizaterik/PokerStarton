"""Subscription usage, quota reset, and limit checks."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.strategy import Strategy
from app.models.user import User
from app.services.subscription_plans import (
    DEFAULT_PLAN_ID,
    PLANS,
    UNLIMITED,
    get_plan,
    list_plans,
    plan_to_dict,
)

# Временно: подписка скрыта в UI, лимиты тарифов не применяются.
SUBSCRIPTION_LIMITS_ENABLED = False


def _month_key(now: datetime | None = None) -> str:
    dt = now or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m")


def ensure_month_quota(user: User) -> None:
    """Reset monthly hand counter when the calendar month changes."""
    key = _month_key()
    if user.hands_quota_month != key:
        user.hands_quota_month = key
        user.hands_analyzed_month = 0


def ensure_user_plan(user: User) -> None:
    if not user.plan_id:
        user.plan_id = DEFAULT_PLAN_ID
    if user.plan_started_at is None:
        user.plan_started_at = datetime.now(timezone.utc)
    ensure_month_quota(user)


def strategy_count(db: Session, user_id) -> int:
    return int(
        db.scalar(select(func.count()).select_from(Strategy).where(Strategy.user_id == user_id)) or 0
    )


def assert_can_create_strategy(db: Session, user: User) -> None:
    if not SUBSCRIPTION_LIMITS_ENABLED:
        return
    ensure_user_plan(user)
    plan = get_plan(user.plan_id)
    if plan.max_strategies == UNLIMITED:
        return
    current = strategy_count(db, user.id)
    if current >= plan.max_strategies:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Лимит тарифа {plan.name}: {plan.max_strategies} стратегий. "
                "Смени тариф в профиле."
            ),
        )


def assert_can_analyze_hands(user: User, additional: int) -> None:
    if not SUBSCRIPTION_LIMITS_ENABLED:
        return
    ensure_user_plan(user)
    plan = get_plan(user.plan_id)
    if plan.max_hands_per_month == UNLIMITED:
        return
    used = int(user.hands_analyzed_month or 0)
    if used + additional > plan.max_hands_per_month:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Лимит тарифа {plan.name}: {plan.max_hands_per_month:,} раздач в месяц "
                f"(использовано {used:,}). Смени тариф в профиле."
            ).replace(",", " "),
        )


def consume_analyzed_hands(user: User, count: int) -> None:
    if count <= 0:
        return
    ensure_user_plan(user)
    plan = get_plan(user.plan_id)
    if plan.max_hands_per_month == UNLIMITED:
        # Still track usage for display
        user.hands_analyzed_month = int(user.hands_analyzed_month or 0) + count
        return
    user.hands_analyzed_month = int(user.hands_analyzed_month or 0) + count


def select_plan(user: User, plan_id: str) -> None:
    key = (plan_id or "").strip().lower()
    if key not in PLANS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Неизвестный тариф")
    user.plan_id = key
    user.plan_started_at = datetime.now(timezone.utc)


def build_subscription_payload(db: Session, user: User) -> dict:
    ensure_user_plan(user)
    plan = get_plan(user.plan_id)
    strategies = strategy_count(db, user.id)
    hands_used = int(user.hands_analyzed_month or 0)
    # Пока лимиты выключены — в payload всегда безлимит
    unlimited = not SUBSCRIPTION_LIMITS_ENABLED
    return {
        "plan": plan_to_dict(plan),
        "plan_started_at": user.plan_started_at,
        "usage": {
            "strategies": strategies,
            "strategies_limit": None
            if unlimited or plan.max_strategies == UNLIMITED
            else plan.max_strategies,
            "hands_month": hands_used,
            "hands_month_limit": None
            if unlimited or plan.max_hands_per_month == UNLIMITED
            else plan.max_hands_per_month,
            "quota_month": user.hands_quota_month or _month_key(),
        },
        "plans": list_plans(),
        "features": list(plan.features),
    }
