"""In-process cache for heavy analysis/results payloads.

Frontend also caches in localStorage; this invalidates server-side entries
when the active hand database changes (switch / clear / delete / upload).
"""

from __future__ import annotations

from threading import Lock
from typing import Any
from uuid import UUID

_lock = Lock()
_store: dict[str, Any] = {}


def _user_prefix(user_id: UUID) -> str:
    return f"u:{user_id}:"


def get(key: str) -> Any | None:
    with _lock:
        return _store.get(key)


def set(key: str, value: Any) -> None:
    with _lock:
        _store[key] = value


def invalidate_user(user_id: UUID) -> int:
    """Drop all cached entries for a user. Returns how many keys were removed."""
    prefix = _user_prefix(user_id)
    with _lock:
        keys = [k for k in _store if k.startswith(prefix)]
        for k in keys:
            del _store[k]
        return len(keys)


def clear() -> None:
    with _lock:
        _store.clear()
