"""Deduplicate hands by room hand id so the same HH is never counted twice."""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from app.models.hand import Hand


def dedupe_hands_by_external_id(hands: list[Hand]) -> list[Hand]:
    """Keep the first occurrence of each external_hand_id (caller order)."""
    seen: set[str] = set()
    out: list[Hand] = []
    for hand in hands:
        key = hand.external_hand_id
        if key in seen:
            continue
        seen.add(key)
        out.append(hand)
    return out


def prefer_active_then_dedupe(
    hands: list[Hand],
    session_status: Mapping[UUID, str],
) -> list[Hand]:
    """Dedupe by external_hand_id, keeping the copy from an active session when possible.

    Re-uploads archive old sessions and insert the same hands again. Without this,
    both session rows appear in career charts (one with profit, one as a ghost).
    """

    def sort_key(hand: Hand) -> tuple[int, object, object]:
        sid = hand.session_id
        status = session_status.get(sid, "") if sid is not None else ""
        # Active first (0), then archived/other (1).
        status_rank = 0 if status == "active" else 1
        played = hand.played_at or 0
        return (status_rank, played, hand.id)

    ordered = sorted(hands, key=sort_key)
    return dedupe_hands_by_external_id(ordered)
