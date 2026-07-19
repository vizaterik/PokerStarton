"""Aggregate win/loss curves and session stats for the results report."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from app.models.hand import Hand, PlaySession
from app.models.hand_database import HandDatabase
from app.parsers.pokerstars import (
    compute_hero_net,
    extract_showdown_nets,
)
from app.services.hand_dedupe import prefer_active_then_dedupe

# Parallel tables (Rush / multi-table) count as one play sitting when windows
# overlap or the gap between them is at most this long.
_CONCURRENT_GAP = timedelta(minutes=45)

# Cap stored career curve size — full per-hand points OOMs SQLite/JSON + RAM.
_MAX_CAREER_CURVE_POINTS = 2500


def _downsample_curve(curve: list[dict], max_points: int = _MAX_CAREER_CURVE_POINTS) -> list[dict]:
    n = len(curve)
    if n <= max_points:
        return curve
    # Always keep first + last; sample evenly in between.
    if max_points < 3:
        return [curve[0], curve[-1]] if n > 1 else curve
    out: list[dict] = [curve[0]]
    inner = max_points - 2
    for i in range(inner):
        idx = 1 + int(round(i * (n - 2) / (inner - 1 or 1)))
        idx = min(n - 2, max(1, idx))
        if out[-1] is not curve[idx]:
            out.append(curve[idx])
    if out[-1] is not curve[-1]:
        out.append(curve[-1])
    return out

def _hand_time(hand: Hand) -> datetime | None:
    return hand.played_at


def merge_concurrent_session_rows(rows: list[dict]) -> list[dict]:
    """Merge upload rows that are the same sitting (2+ tables at once).

    Each input row needs: id, label, room, source_filename, started_at,
    hands_count, profit_money, profit_bb, _start, _end.
    """
    if not rows:
        return []

    ordered = sorted(
        rows,
        key=lambda r: (r.get("_start") or datetime.min, str(r.get("id"))),
    )
    clusters: list[dict] = []

    for row in ordered:
        start: datetime | None = row.get("_start")
        end: datetime | None = row.get("_end") or start
        if start is None:
            clusters.append({**row, "tables_count": 1})
            continue

        if clusters:
            last = clusters[-1]
            last_end: datetime | None = last.get("_end") or last.get("_start")
            if last_end is not None and start <= last_end + _CONCURRENT_GAP:
                # Same play block — accumulate.
                last["_end"] = max(last_end, end or last_end)
                last["hands_count"] = int(last["hands_count"]) + int(row["hands_count"])
                last["profit_money"] = float(last["profit_money"]) + float(row["profit_money"])
                last["profit_bb"] = float(last["profit_bb"]) + float(row["profit_bb"])
                last["tables_count"] = int(last.get("tables_count") or 1) + 1
                # Keep earliest label; note multi-table in source.
                src = last.get("source_filename") or ""
                other = row.get("source_filename") or ""
                if other and other not in src:
                    last["source_filename"] = f"{src} · {other}" if src else other
                continue

        clusters.append({**row, "tables_count": 1})

    out: list[dict] = []
    for c in clusters:
        hands_n = int(c["hands_count"])
        profit_bb = float(c["profit_bb"])
        tables = int(c.get("tables_count") or 1)
        label = c["label"]
        if tables > 1:
            label = f"{label} · {tables} стола" if tables < 5 else f"{label} · {tables} столов"
        out.append(
            {
                "id": c["id"],
                "label": label,
                "room": c["room"],
                "source_filename": c.get("source_filename") or "",
                "started_at": c.get("started_at") or c.get("_start"),
                "hands_count": hands_n,
                "profit_money": round(float(c["profit_money"]), 4),
                "profit_bb": round(profit_bb, 4),
                "winrate_bb100": round((profit_bb / hands_n * 100.0) if hands_n else 0.0, 2),
                "tables_count": tables,
            }
        )
    # Newest first (same as before: reversed chronological).
    out.sort(
        key=lambda r: (r.get("started_at") or datetime.min, str(r["id"])),
        reverse=True,
    )
    return out


def _as_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def resolve_hand_result(hand: Hand, *, prefer_stored: bool = True) -> tuple[float, float]:
    """Return (net $, net BB).

    Prefer stored columns for career reports (fast). Fall back to parsing raw_text
    only when nets are missing.
    """
    bb = _as_float(hand.big_blind)
    stored_net = _as_float(hand.hero_net)
    stored_bb = _as_float(hand.hero_net_bb)
    if prefer_stored and stored_net is not None and stored_bb is not None:
        return stored_net, stored_bb

    raw = getattr(hand, "raw_text", None) or ""
    if raw.strip():
        computed_net, computed_bb = compute_hero_net(
            raw,
            hero_name=hand.hero_name or "Hero",
            big_blind=bb,
        )
        net = computed_net if computed_net is not None else (stored_net or 0.0)
        if computed_bb is not None:
            net_bb = computed_bb
        elif stored_bb is not None:
            net_bb = stored_bb
        elif bb and bb > 0:
            net_bb = net / bb
        else:
            net_bb = 0.0
        return net, net_bb

    net = stored_net or 0.0
    net_bb = stored_bb
    if net_bb is None:
        net_bb = (net / bb) if bb and bb > 0 else 0.0
    return net, net_bb


def resolve_showdown_split(hand: Hand, *, prefer_stored: bool = True) -> tuple[float, float, float, float]:
    """Return (wsd_money, wsd_bb, wwsd_money, wwsd_bb) for H2N red/blue lines."""
    stored = (
        _as_float(hand.hero_net_wsd),
        _as_float(hand.hero_net_wsd_bb),
        _as_float(hand.hero_net_wwsd),
        _as_float(hand.hero_net_wwsd_bb),
    )
    if prefer_stored and all(v is not None for v in stored):
        return stored[0] or 0.0, stored[1] or 0.0, stored[2] or 0.0, stored[3] or 0.0

    net, net_bb = resolve_hand_result(hand, prefer_stored=prefer_stored)
    raw = getattr(hand, "raw_text", None) or ""
    if not raw.strip():
        if hand.went_to_showdown:
            return net, net_bb, 0.0, 0.0
        return 0.0, 0.0, net, net_bb

    bb = _as_float(hand.big_blind)
    went, wsd, wsd_bb, wwsd, wwsd_bb = extract_showdown_nets(
        raw,
        hero_name=hand.hero_name or "Hero",
        big_blind=bb,
        hero_net=net,
        hero_net_bb=net_bb,
    )
    if wsd is None or wwsd is None:
        if went:
            return net, net_bb, 0.0, 0.0
        return 0.0, 0.0, net, net_bb
    return (
        wsd,
        wsd_bb if wsd_bb is not None else 0.0,
        wwsd,
        wwsd_bb if wwsd_bb is not None else 0.0,
    )


def _in_period(played_at: datetime | None, date_from: datetime | None, date_to: datetime | None) -> bool:
    if played_at is None:
        return False
    # Compare naive timestamps as stored from HH files.
    ts = played_at.replace(tzinfo=None) if played_at.tzinfo else played_at
    if date_from is not None:
        start = date_from.replace(tzinfo=None) if date_from.tzinfo else date_from
        if ts < start:
            return False
    if date_to is not None:
        end = date_to.replace(tzinfo=None) if date_to.tzinfo else date_to
        if ts > end:
            return False
    return True


def build_results_report(
    db: Session,
    user_id: UUID,
    session_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    database_id: UUID | None = None,
) -> dict:
    # Career report = entire hand database: active + archived sittings.
    # Analysis-only "active" filter must not apply here.
    q = select(PlaySession).where(PlaySession.user_id == user_id)
    if database_id is not None:
        q = q.where(PlaySession.database_id == database_id)
    all_sessions = list(
        db.scalars(
            q.order_by(PlaySession.started_at.asc().nulls_last(), PlaySession.created_at.asc())
        )
    )
    session_ids_all = [s.id for s in all_sessions]
    has_any_data = False
    if session_ids_all:
        has_any_data = (
            db.scalar(select(Hand.id).where(Hand.session_id.in_(session_ids_all)).limit(1)) is not None
        )

    session_status = {s.id: (s.status or "active") for s in all_sessions}

    # One query, without raw_text — career uses stored nets (snapshot / upload).
    if not session_ids_all:
        all_hands: list[Hand] = []
    else:
        all_hands = list(
            db.scalars(
                select(Hand)
                .where(Hand.session_id.in_(session_ids_all))
                .options(
                    load_only(
                        Hand.id,
                        Hand.session_id,
                        Hand.external_hand_id,
                        Hand.played_at,
                        Hand.big_blind,
                        Hand.hero_name,
                        Hand.hero_net,
                        Hand.hero_net_bb,
                        Hand.hero_net_wsd,
                        Hand.hero_net_wsd_bb,
                        Hand.hero_net_wwsd,
                        Hand.hero_net_wwsd_bb,
                        Hand.went_to_showdown,
                    )
                )
                .order_by(Hand.played_at.asc().nulls_last(), Hand.id.asc())
            )
        )

    period_hands = prefer_active_then_dedupe(
        [h for h in all_hands if _in_period(h.played_at, date_from, date_to)],
        session_status,
    )
    # Curve may be further limited to one session; session list uses all in period.
    hands = (
        [h for h in period_hands if h.session_id == session_id]
        if session_id is not None
        else period_hands
    )
    list_hands = period_hands

    curve: list[dict] = []
    cum_bb = 0.0
    cum_money = 0.0
    cum_wsd_bb = cum_wwsd_bb = 0.0
    cum_wsd_m = cum_wwsd_m = 0.0
    wins = 0
    losses = 0
    scratches = 0

    # Precompute nets once (session rows reuse the same values).
    net_by_id: dict[UUID, tuple[float, float]] = {}

    for idx, hand in enumerate(hands, start=1):
        net, net_bb = resolve_hand_result(hand, prefer_stored=True)
        net_by_id[hand.id] = (net, net_bb)
        wsd_m, wsd_bb, wwsd_m, wwsd_bb = resolve_showdown_split(hand, prefer_stored=True)
        cum_money += net
        cum_bb += net_bb
        cum_wsd_m += wsd_m
        cum_wsd_bb += wsd_bb
        cum_wwsd_m += wwsd_m
        cum_wwsd_bb += wwsd_bb
        if net_bb > 0.001:
            wins += 1
        elif net_bb < -0.001:
            losses += 1
        else:
            scratches += 1
        curve.append(
            {
                "hand_index": idx,
                "cum_bb": round(cum_bb, 4),
                "cum_money": round(cum_money, 4),
                "cum_wwsd_bb": round(cum_wwsd_bb, 4),
                "cum_wsd_bb": round(cum_wsd_bb, 4),
                "cum_wwsd_money": round(cum_wwsd_m, 4),
                "cum_wsd_money": round(cum_wsd_m, 4),
                "hand_bb": round(net_bb, 4),
                "hand_money": round(net, 4),
                "played_at": hand.played_at.isoformat() if hand.played_at else None,
                "session_id": str(hand.session_id) if hand.session_id else None,
            }
        )

    total_hands = len(hands)
    winrate = (cum_bb / total_hands * 100.0) if total_hands else 0.0

    by_session: dict[UUID, list[Hand]] = {}
    for h in list_hands:
        by_session.setdefault(h.session_id, []).append(h)

    session_rows: list[dict] = []
    for session in all_sessions:
        s_hands = by_session.get(session.id) or []
        if not s_hands:
            continue
        s_money = 0.0
        s_bb = 0.0
        times: list[datetime] = []
        for h in s_hands:
            cached_net = net_by_id.get(h.id)
            if cached_net is None:
                cached_net = resolve_hand_result(h, prefer_stored=True)
                net_by_id[h.id] = cached_net
            n, nb = cached_net
            s_money += n
            s_bb += nb
            t = _hand_time(h)
            if t is not None:
                times.append(t)
        start = min(times) if times else session.started_at
        end = max(times) if times else session.started_at
        session_rows.append(
            {
                "id": session.id,
                "label": session.label,
                "room": session.room,
                "source_filename": session.source_filename,
                "started_at": session.started_at or start,
                "hands_count": len(s_hands),
                "profit_money": s_money,
                "profit_bb": s_bb,
                "_start": start,
                "_end": end,
            }
        )

    session_rows = merge_concurrent_session_rows(session_rows)

    return {
        "total_hands": total_hands,
        "total_profit_money": round(cum_money, 4),
        "total_profit_bb": round(cum_bb, 4),
        "winrate_bb100": round(winrate, 2),
        "wins": wins,
        "losses": losses,
        "scratches": scratches,
        "sessions_count": len(session_rows),
        "has_any_data": has_any_data,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "curve": _downsample_curve(curve),
        "sessions": session_rows,
        # HU branch tops need raw_text parse — not used on Career report UI.
        "top_losing_branches": [],
        "top_profitable_branches": [],
    }


def refresh_and_store_career_report(
    db: Session,
    user_id: UUID,
    database_id: UUID,
) -> dict:
    """Build all-time career report and persist it on the hand database."""
    from app.schemas.hand import ResultsReport

    payload = build_results_report(db, user_id, database_id=database_id)
    # JSON column + API clients need UUIDs/datetimes as strings.
    serializable = ResultsReport(**payload).model_dump(mode="json")
    row = db.get(HandDatabase, database_id)
    if row is not None:
        row.career_report = serializable
        row.career_report_at = datetime.now(timezone.utc)
        db.flush()
    return serializable
