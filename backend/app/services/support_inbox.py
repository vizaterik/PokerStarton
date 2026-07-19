"""Stub inbox for support tickets — console log + JSONL file."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4

logger = logging.getLogger(__name__)

_LOCK = Lock()
_MEMORY: list[dict] = []
_STORE = Path(__file__).resolve().parents[2] / "data" / "support_tickets.jsonl"


def save_ticket(
    *,
    poker_nick: str,
    email: str,
    topic: str,
    message: str,
) -> dict:
    ticket = {
        "id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "poker_nick": poker_nick.strip(),
        "email": email.strip().lower(),
        "topic": topic.strip(),
        "message": message.strip(),
    }

    with _LOCK:
        _MEMORY.append(ticket)
        _STORE.parent.mkdir(parents=True, exist_ok=True)
        with _STORE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(ticket, ensure_ascii=False) + "\n")

    logger.info(
        "[Support] ticket=%s nick=%s email=%s topic=%s",
        ticket["id"],
        ticket["poker_nick"],
        ticket["email"],
        ticket["topic"],
    )
    print(
        f"[PokerStraton Support] {ticket['id']} | {ticket['email']} | {ticket['topic']}\n"
        f"  nick: {ticket['poker_nick']}\n"
        f"  msg: {ticket['message'][:500]}",
        flush=True,
    )
    return ticket


def recent_tickets(limit: int = 50) -> list[dict]:
    with _LOCK:
        return list(_MEMORY[-limit:])
