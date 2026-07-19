"""Extract play-session metadata from HH filenames and hand content."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from app.parsers.pokerstars import ParsedHand

# GG20260709-2014 - RushAndCash16816719 - 0.01 - 0.02 - 6max.txt
_GG_FILE = re.compile(
    r"^GG(?P<date>\d{8})-(?P<time>\d{4})\s*-\s*(?P<table>.+?)\s*-\s*"
    r"(?P<sb>[\d.]+)\s*-\s*(?P<bb>[\d.]+)\s*-\s*(?P<max>\d+)\s*max",
    re.IGNORECASE,
)


@dataclass
class SessionMeta:
    room: str
    label: str
    table_name: str | None
    small_blind: Decimal | None
    big_blind: Decimal | None
    max_seats: int | None
    started_at: datetime | None
    ended_at: datetime | None
    source_filename: str


def detect_room(text: str, filename: str = "") -> str:
    head = text[:4000]
    name = filename.lower()
    if "pokerstars" in head.lower() or name.startswith("ps") or "pokerstars" in name:
        return "pokerstars"
    if (
        "poker hand #" in head.lower()
        or "rushandcash" in head.lower()
        or "ggpoker" in name
        or name.startswith("gg")
    ):
        return "ggpoker"
    return "pokerstars"


def _parse_gg_filename(filename: str) -> dict | None:
    stem = Path(filename).stem
    m = _GG_FILE.match(stem.strip())
    if not m:
        return None
    date_s = m.group("date")
    time_s = m.group("time")
    try:
        started = datetime(
            int(date_s[0:4]),
            int(date_s[4:6]),
            int(date_s[6:8]),
            int(time_s[0:2]),
            int(time_s[2:4]),
        )
    except ValueError:
        started = None
    return {
        "table_name": m.group("table").strip(),
        "small_blind": Decimal(m.group("sb")),
        "big_blind": Decimal(m.group("bb")),
        "max_seats": int(m.group("max")),
        "started_at": started,
    }


def _format_stakes(sb: Decimal | None, bb: Decimal | None) -> str:
    if sb is None or bb is None:
        return ""
    return f"${sb}/${bb}"


def _format_day(dt: datetime | None) -> str:
    if dt is None:
        return ""
    months = (
        "янв",
        "фев",
        "мар",
        "апр",
        "мая",
        "июн",
        "июл",
        "авг",
        "сен",
        "окт",
        "ноя",
        "дек",
    )
    return f"{dt.day} {months[dt.month - 1]} {dt.year}"


def build_session_meta(
    filename: str,
    text: str,
    hands: list[ParsedHand],
) -> SessionMeta:
    room = detect_room(text, filename)
    from_name = _parse_gg_filename(filename) if room == "ggpoker" or filename.upper().startswith("GG") else None

    times = [h.played_at for h in hands if h.played_at is not None]
    started = min(times) if times else None
    ended = max(times) if times else None

    table_name = None
    small_blind = None
    big_blind = None
    max_seats = None

    if from_name:
        table_name = from_name["table_name"]
        small_blind = from_name["small_blind"]
        big_blind = from_name["big_blind"]
        max_seats = from_name["max_seats"]
        if from_name["started_at"] and (started is None or from_name["started_at"] < started):
            started = from_name["started_at"]

    if hands:
        if table_name is None:
            # Prefer most common table; fall back to first.
            tables = [h.table_name for h in hands if h.table_name]
            table_name = tables[0] if tables else None
        if small_blind is None and hands[0].small_blind is not None:
            small_blind = Decimal(str(hands[0].small_blind))
        if big_blind is None and hands[0].big_blind is not None:
            big_blind = Decimal(str(hands[0].big_blind))

    stakes = _format_stakes(small_blind, big_blind)
    day = _format_day(started)
    room_label = "GG" if room == "ggpoker" else "PS"
    parts = [room_label]
    if table_name:
        parts.append(table_name)
    if stakes:
        parts.append(stakes)
    if day:
        parts.append(day)
    if max_seats:
        parts.append(f"{max_seats}-max")
    label = " · ".join(parts) if len(parts) > 1 else Path(filename).stem

    return SessionMeta(
        room=room,
        label=label,
        table_name=table_name,
        small_blind=small_blind,
        big_blind=big_blind,
        max_seats=max_seats,
        started_at=started,
        ended_at=ended,
        source_filename=filename,
    )
