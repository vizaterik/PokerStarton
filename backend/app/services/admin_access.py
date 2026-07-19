"""Hardcoded admin allowlist — only this account can access admin APIs."""

from __future__ import annotations

from app.models.user import User

ADMIN_EMAIL = "yanev.alexander.ru@gmail.com"
ADMIN_NICKNAME = "MrFrigmut"


def is_admin_user(user: User | None) -> bool:
    if user is None:
        return False
    email = (user.email or "").strip().lower()
    nick = (user.display_name or "").strip()
    return email == ADMIN_EMAIL.lower() and nick == ADMIN_NICKNAME
