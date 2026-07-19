"""Parse uploaded HH files and compare hero preflop decisions to strategy."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hand import Deviation, Hand, HandAction, HandUpload, PlaySession
from app.models.strategy import StrategyCell, StrategySpot
from app.parsers.pokerstars import ParsedHand, parse_pokerstars
from app.services.deviation import is_deviation, pick_expected_action
from app.services.session_meta import build_session_meta
from app.services.strategy_match import load_spot_maps, resolve_cell_freqs


def _dec(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _find_spot(
    db: Session,
    strategy_id: UUID,
    spot_key: str | None,
    hero_position: str | None,
    villain_position: str | None = None,
) -> StrategySpot | None:
    """Prefer a villain-specific chart, then fall back to the generic one."""
    if not spot_key or not hero_position:
        return None
    hero = hero_position.upper()
    villain = villain_position.upper() if villain_position else None
    if villain:
        exact = db.scalar(
            select(StrategySpot).where(
                StrategySpot.strategy_id == strategy_id,
                StrategySpot.spot_key == spot_key,
                StrategySpot.hero_position == hero,
                StrategySpot.villain_position == villain,
            )
        )
        if exact is not None:
            return exact
    return db.scalar(
        select(StrategySpot).where(
            StrategySpot.strategy_id == strategy_id,
            StrategySpot.spot_key == spot_key,
            StrategySpot.hero_position == hero,
            StrategySpot.villain_position.is_(None),
        )
    )


def _find_cell(db: Session, spot_id: UUID, hand_code: str) -> StrategyCell | None:
    return db.scalar(
        select(StrategyCell).where(
            StrategyCell.spot_id == spot_id,
            StrategyCell.hand_code == hand_code,
        )
    )


def _persist_hand(
    db: Session,
    upload: HandUpload,
    parsed: ParsedHand,
    session_id: UUID | None,
) -> Hand:
    hand = Hand(
        upload_id=upload.id,
        session_id=session_id,
        external_hand_id=parsed.external_hand_id,
        played_at=parsed.played_at,
        table_name=parsed.table_name,
        small_blind=_dec(parsed.small_blind),
        big_blind=_dec(parsed.big_blind),
        hero_name=parsed.hero_name,
        hero_position=parsed.hero_position,
        hero_hand=parsed.hero_hand,
        hero_hand_code=parsed.hero_hand_code,
        detected_spot=parsed.detected_spot,
        villain_position=parsed.villain_position,
        stack_bb=_dec(parsed.stack_bb),
        hero_net=_dec(parsed.hero_net),
        hero_net_bb=_dec(parsed.hero_net_bb),
        went_to_showdown=parsed.went_to_showdown,
        hero_net_wsd=_dec(parsed.hero_net_wsd),
        hero_net_wsd_bb=_dec(parsed.hero_net_wsd_bb),
        hero_net_wwsd=_dec(parsed.hero_net_wwsd),
        hero_net_wwsd_bb=_dec(parsed.hero_net_wwsd_bb),
        raw_text=parsed.raw_text,
    )
    db.add(hand)
    db.flush()
    for action in parsed.actions:
        db.add(
            HandAction(
                hand_id=hand.id,
                street=action.street,
                action_order=action.action_order,
                player_name=action.player_name,
                is_hero=action.is_hero,
                action=action.action,
                amount=_dec(action.amount),
            )
        )
    return hand


def _analyze_hand(
    db: Session,
    upload: HandUpload,
    hand: Hand,
    parsed: ParsedHand,
) -> Deviation | None:
    if upload.strategy_id is None:
        return None
    if not parsed.hero_preflop_action or not parsed.hero_hand_code or not parsed.detected_spot:
        return None
    if not parsed.hero_position:
        return None

    spot_by_key, cell_by_key = load_spot_maps(db, upload.strategy_id)
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key=parsed.detected_spot,
        hero_position=parsed.hero_position,
        villain_position=parsed.villain_position,
        hand_code=parsed.hero_hand_code,
    )
    if resolved is None:
        return None

    spot, raise_f, call_f, fold_f = resolved
    actual = parsed.hero_preflop_action
    expected = pick_expected_action(raise_f, call_f, fold_f)
    freqs = {"raise": raise_f, "call": call_f, "fold": fold_f}
    actual_freq = freqs.get(actual, Decimal("0"))
    expected_freq = freqs[expected]

    if not is_deviation(actual, raise_f, call_f, fold_f):
        return None

    severity = abs(expected_freq - actual_freq)
    deviation = Deviation(
        hand_id=hand.id,
        user_id=upload.user_id,
        strategy_id=upload.strategy_id,
        spot_id=spot.id,
        hand_code=parsed.hero_hand_code,
        actual_action=actual,
        expected_action=expected,
        actual_freq=actual_freq,
        expected_freq=expected_freq,
        severity=severity,
    )
    db.add(deviation)
    return deviation


def archive_user_active_sessions(
    db: Session,
    *,
    user_id: UUID,
    keep_session_ids: set[UUID] | None = None,
    database_id: UUID | None = None,
) -> int:
    """Archive previous active sessions. Rows stay in DB; analysis uses only active."""
    q = select(PlaySession).where(
        PlaySession.user_id == user_id,
        PlaySession.status == "active",
    )
    if database_id is not None:
        q = q.where(PlaySession.database_id == database_id)
    if keep_session_ids:
        q = q.where(PlaySession.id.not_in(keep_session_ids))
    sessions = list(db.scalars(q))
    for session in sessions:
        session.status = "archived"
    if sessions:
        db.flush()
    return len(sessions)


def clear_strategy_sessions(
    db: Session,
    *,
    user_id: UUID,
    strategy_id: UUID | None = None,
    keep_session_ids: set[UUID] | None = None,
) -> int:
    """Archive previous active sessions for the user (history kept in DB)."""
    del strategy_id  # sessions are user-owned; strategy only selects charts
    return archive_user_active_sessions(
        db, user_id=user_id, keep_session_ids=keep_session_ids
    )


def archive_other_sessions(
    db: Session,
    *,
    user_id: UUID,
    strategy_id: UUID | None = None,
    keep_session_id: UUID | None = None,
) -> int:
    """Backward-compatible alias for archive_user_active_sessions."""
    keep = {keep_session_id} if keep_session_id is not None else None
    return archive_user_active_sessions(db, user_id=user_id, keep_session_ids=keep)


def _upsert_session(
    db: Session,
    upload: HandUpload,
    text: str,
    parsed_hands: list[ParsedHand],
) -> PlaySession:
    """Create/update session as active. Batch upload archives prior batch beforehand."""
    meta = build_session_meta(upload.original_filename, text, parsed_hands)
    upload.room = meta.room

    session: PlaySession | None = None
    if upload.session_id:
        session = db.get(PlaySession, upload.session_id)

    if session is None:
        session = PlaySession(
            user_id=upload.user_id,
            database_id=upload.database_id,
            strategy_id=upload.strategy_id,
            room=meta.room,
            label=meta.label,
            source_filename=meta.source_filename,
            table_name=meta.table_name,
            small_blind=meta.small_blind,
            big_blind=meta.big_blind,
            max_seats=meta.max_seats,
            started_at=meta.started_at,
            ended_at=meta.ended_at,
            hands_count=len(parsed_hands),
            status="active",
        )
        db.add(session)
        db.flush()
        upload.session_id = session.id
    else:
        session.strategy_id = upload.strategy_id
        if upload.database_id is not None:
            session.database_id = upload.database_id
        session.room = meta.room
        session.label = meta.label
        session.source_filename = meta.source_filename
        session.table_name = meta.table_name
        session.small_blind = meta.small_blind
        session.big_blind = meta.big_blind
        session.max_seats = meta.max_seats
        session.started_at = meta.started_at
        session.ended_at = meta.ended_at
        session.hands_count = len(parsed_hands)
        session.status = "active"

    return session


def purge_duplicate_hands_in_database(db: Session, database_id: UUID) -> int:
    """Keep one Hand per external_hand_id in a database (prefer active session).

    Re-uploads archive prior sittings and insert the same HH again. Career report
    already dedupes for charts; this removes the extra rows so the profile limit
    and session list match unique hands stored in the base.
    Distinct sittings (different hand ids) stay — including archived ones.
    """
    sessions = list(
        db.scalars(select(PlaySession).where(PlaySession.database_id == database_id))
    )
    if not sessions:
        return 0
    status_by_session = {s.id: (s.status or "active") for s in sessions}
    session_ids = [s.id for s in sessions]
    hands = list(
        db.scalars(select(Hand).where(Hand.session_id.in_(session_ids)))
    )
    if not hands:
        return 0

    best: dict[str, Hand] = {}
    for hand in hands:
        key = (hand.external_hand_id or "").strip()
        if not key:
            continue
        prev = best.get(key)
        if prev is None:
            best[key] = hand
            continue
        prev_active = status_by_session.get(prev.session_id) == "active"
        cur_active = status_by_session.get(hand.session_id) == "active"
        if cur_active and not prev_active:
            best[key] = hand

    keep_ids = {h.id for h in best.values()}
    removed = 0
    for hand in hands:
        key = (hand.external_hand_id or "").strip()
        if key and hand.id not in keep_ids:
            db.delete(hand)
            removed += 1

    if not removed:
        return 0

    db.flush()
    # Refresh session counts; drop empty archived sittings (pure re-upload ghosts).
    for session in list(
        db.scalars(select(PlaySession).where(PlaySession.database_id == database_id))
    ):
        n = int(
            db.scalar(
                select(func.count()).select_from(Hand).where(Hand.session_id == session.id)
            )
            or 0
        )
        session.hands_count = n
        if n == 0 and (session.status or "") == "archived":
            for upload in list(
                db.scalars(select(HandUpload).where(HandUpload.session_id == session.id))
            ):
                if upload.storage_path:
                    try:
                        Path(upload.storage_path).unlink(missing_ok=True)
                    except OSError:
                        pass
                db.delete(upload)
            db.delete(session)
    db.flush()
    return removed


def purge_orphaned_hand_history(db: Session, user_id: UUID) -> int:
    """Remove stray HH after strategy delete — never touch hand-database career data.

    Sessions/uploads with a database_id belong to the career base and must stay
    (archived batches are still part of the report).
    """
    uploads = list(
        db.scalars(
            select(HandUpload).where(
                HandUpload.user_id == user_id,
                HandUpload.strategy_id.is_(None),
                HandUpload.database_id.is_(None),
            )
        )
    )
    for upload in uploads:
        if upload.storage_path:
            try:
                Path(upload.storage_path).unlink(missing_ok=True)
            except OSError:
                pass
        db.delete(upload)

    sessions = list(
        db.scalars(
            select(PlaySession).where(
                PlaySession.user_id == user_id,
                PlaySession.strategy_id.is_(None),
                PlaySession.database_id.is_(None),
            )
        )
    )
    for session in sessions:
        db.delete(session)

    if uploads or sessions:
        db.flush()
    return len(uploads) + len(sessions)


def _known_external_ids(
    db: Session,
    user_id: UUID,
    candidate_ids: list[str],
    *,
    strategy_id: UUID | None = None,
    database_id: UUID | None = None,
) -> set[str]:
    """Hand IDs already in the user's active session batch (within-batch dedupe)."""
    del strategy_id
    if not candidate_ids:
        return set()
    q = (
        select(Hand.external_hand_id)
        .join(PlaySession, Hand.session_id == PlaySession.id)
        .where(
            PlaySession.user_id == user_id,
            PlaySession.status == "active",
            Hand.external_hand_id.in_(candidate_ids),
        )
    )
    if database_id is not None:
        q = q.where(PlaySession.database_id == database_id)
    return set(db.scalars(q))


def process_upload(db: Session, upload_id: UUID) -> HandUpload:
    upload = db.get(HandUpload, upload_id)
    if upload is None:
        raise ValueError("Upload not found")

    upload.status = "parsing"
    upload.error_message = None
    db.commit()

    try:
        if not upload.storage_path:
            raise ValueError("Файл загрузки не найден")
        path = Path(upload.storage_path)
        if not path.exists():
            raise ValueError("Файл загрузки отсутствует на диске")
        text = path.read_text(encoding="utf-8", errors="replace")
        parsed_hands = parse_pokerstars(text)

        # Clear previous results if reprocessing
        existing = list(db.scalars(select(Hand).where(Hand.upload_id == upload.id)))
        for hand in existing:
            db.delete(hand)
        db.flush()

        candidate_ids = [p.external_hand_id for p in parsed_hands]
        # Only skip hands already imported earlier in *this* upload batch.
        already = _known_external_ids(
            db,
            upload.user_id,
            candidate_ids,
            strategy_id=upload.strategy_id,
            database_id=upload.database_id,
        )

        seen_in_file: set[str] = set()
        new_hands: list[ParsedHand] = []
        duplicates_skipped = 0
        for parsed in parsed_hands:
            eid = parsed.external_hand_id
            if eid in already or eid in seen_in_file:
                duplicates_skipped += 1
                continue
            seen_in_file.add(eid)
            new_hands.append(parsed)

        session = _upsert_session(db, upload, text, new_hands)
        db.commit()

        analyzed = 0
        errors = 0
        # Commit in chunks so SQLite write-lock is not held for the whole file
        # (otherwise /auth/me and navigation freeze while upload runs).
        CHUNK = 40
        for i, parsed in enumerate(new_hands, start=1):
            hand = _persist_hand(db, upload, parsed, session.id)
            if _analyze_hand(db, upload, hand, parsed) is not None:
                errors += 1
            if parsed.hero_preflop_action and parsed.detected_spot:
                analyzed += 1
            if i % CHUNK == 0:
                db.commit()

        upload.hands_count = len(new_hands)
        upload.status = "analyzed" if upload.strategy_id else "parsed"
        upload.processed_at = datetime.now(timezone.utc)
        upload.error_message = None
        # Incremental HUD aggregates (VPIP/PFR/3BET cases & opportunities).
        from app.services.hud_aggregate import apply_session_to_aggregates
        from app.services.databases import attach_orphan_hand_rows

        apply_session_to_aggregates(db, session)
        if upload.database_id is not None:
            attach_orphan_hand_rows(db, upload.user, upload.database_id)
        db.commit()
        db.refresh(upload)
        upload._analyzed_count = analyzed  # type: ignore[attr-defined]
        upload._error_count = errors  # type: ignore[attr-defined]
        upload._duplicates_skipped = duplicates_skipped  # type: ignore[attr-defined]
        return upload
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        upload = db.get(HandUpload, upload_id)
        if upload is not None:
            upload.status = "failed"
            upload.error_message = str(exc)[:500]
            db.commit()
            db.refresh(upload)
            return upload
        raise


def upload_report(db: Session, upload: HandUpload) -> dict:
    with_decision = int(
        db.scalar(
            select(func.count())
            .select_from(Hand)
            .where(
                Hand.upload_id == upload.id,
                Hand.detected_spot.is_not(None),
                Hand.hero_hand_code.is_not(None),
            )
        )
        or 0
    )
    deviations_count = int(
        db.scalar(
            select(func.count())
            .select_from(Deviation)
            .join(Hand, Deviation.hand_id == Hand.id)
            .where(Hand.upload_id == upload.id)
        )
        or 0
    )
    session = db.get(PlaySession, upload.session_id) if upload.session_id else None
    duplicates_skipped = int(getattr(upload, "_duplicates_skipped", 0) or 0)
    restored = bool(getattr(upload, "_restored", False))
    return {
        "upload_id": upload.id,
        "session_id": upload.session_id,
        "session_label": session.label if session else None,
        "status": upload.status,
        "hands_count": upload.hands_count,
        "duplicates_skipped": duplicates_skipped,
        "hands_with_decision": with_decision,
        "deviations_count": deviations_count,
        "correct_count": max(0, with_decision - deviations_count),
        "error_message": upload.error_message,
        "strategy_id": upload.strategy_id,
        "original_filename": upload.original_filename,
        "room": upload.room,
        "restored": restored,
    }


def _session_report_dict(
    session: PlaySession,
    *,
    with_decision: int,
    deviations_count: int,
    upload: HandUpload | None,
) -> dict:
    return {
        "id": session.id,
        "user_id": session.user_id,
        "strategy_id": session.strategy_id,
        "upload_id": upload.id if upload else None,
        "room": session.room,
        "label": session.label,
        "source_filename": session.source_filename,
        "table_name": session.table_name,
        "small_blind": session.small_blind,
        "big_blind": session.big_blind,
        "max_seats": session.max_seats,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "hands_count": session.hands_count,
        "hands_with_decision": with_decision,
        "deviations_count": deviations_count,
        "correct_count": max(0, with_decision - deviations_count),
        "created_at": session.created_at,
        "status": session.status or "active",
        "upload_status": upload.status if upload else "parsed",
    }


def session_report(db: Session, session: PlaySession) -> dict:
    """Cheap session summary — SQL counts only, never loads hand bodies / raw_text."""
    with_decision = int(
        db.scalar(
            select(func.count())
            .select_from(Hand)
            .where(
                Hand.session_id == session.id,
                Hand.detected_spot.is_not(None),
                Hand.hero_hand_code.is_not(None),
            )
        )
        or 0
    )
    deviations_count = int(
        db.scalar(
            select(func.count())
            .select_from(Deviation)
            .join(Hand, Deviation.hand_id == Hand.id)
            .where(Hand.session_id == session.id)
        )
        or 0
    )
    upload = db.scalar(select(HandUpload).where(HandUpload.session_id == session.id).limit(1))
    return _session_report_dict(
        session,
        with_decision=with_decision,
        deviations_count=deviations_count,
        upload=upload,
    )


def session_reports(db: Session, sessions: list[PlaySession]) -> list[dict]:
    """Batch session summaries — 3 aggregate queries total instead of N×full hand loads."""
    if not sessions:
        return []
    ids = [s.id for s in sessions]

    with_decision_map = {
        row[0]: int(row[1])
        for row in db.execute(
            select(Hand.session_id, func.count())
            .where(
                Hand.session_id.in_(ids),
                Hand.detected_spot.is_not(None),
                Hand.hero_hand_code.is_not(None),
            )
            .group_by(Hand.session_id)
        ).all()
    }
    deviation_map = {
        row[0]: int(row[1])
        for row in db.execute(
            select(Hand.session_id, func.count(Deviation.id))
            .join(Deviation, Deviation.hand_id == Hand.id)
            .where(Hand.session_id.in_(ids))
            .group_by(Hand.session_id)
        ).all()
    }
    upload_by_session: dict[UUID, HandUpload] = {}
    for upload in db.scalars(select(HandUpload).where(HandUpload.session_id.in_(ids))):
        if upload.session_id is not None and upload.session_id not in upload_by_session:
            upload_by_session[upload.session_id] = upload

    return [
        _session_report_dict(
            s,
            with_decision=with_decision_map.get(s.id, 0),
            deviations_count=deviation_map.get(s.id, 0),
            upload=upload_by_session.get(s.id),
        )
        for s in sessions
    ]
