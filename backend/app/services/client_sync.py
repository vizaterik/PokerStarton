"""Persist hands already parsed on the user's PC — no server-side HH parse."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.hand import Deviation, HandUpload, PlaySession
from app.models.strategy import Strategy
from app.models.user import User
from app.parsers.pokerstars import ParsedAction, ParsedHand
from app.schemas.client_sync import ClientHandsSyncRequest, ClientHandsSyncResponse, SyncedHand
from app.services import bankroll as bankroll_svc
from app.services import databases as db_svc
from app.services import subscription as sub_svc
from app.services.databases import attach_orphan_hand_rows
from app.services.hand_limits import assert_analysis_batch_size, assert_database_capacity
from app.services.hand_pipeline import (
    _known_external_ids,
    _persist_hand,
    archive_user_active_sessions,
)
from app.services.deviation import is_deviation, pick_expected_action
from app.services.hud_aggregate import apply_session_to_aggregates
from app.services.strategy_match import load_spot_maps, resolve_cell_freqs


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _to_parsed(row: SyncedHand) -> ParsedHand:
    return ParsedHand(
        external_hand_id=row.external_hand_id.strip()[:64],
        raw_text=row.raw_text.strip(),
        played_at=_aware(row.played_at),
        table_name=row.table_name,
        small_blind=row.small_blind,
        big_blind=row.big_blind,
        hero_name=row.hero_name,
        hero_position=row.hero_position,
        hero_hand=row.hero_hand[:4] if row.hero_hand else None,
        hero_hand_code=(row.hero_hand_code[:3] if row.hero_hand_code else None),
        detected_spot=row.detected_spot,
        villain_position=row.villain_position,
        stack_bb=row.stack_bb,
        hero_preflop_action=row.hero_preflop_action,
        hero_net=row.hero_net,
        hero_net_bb=row.hero_net_bb,
        went_to_showdown=bool(row.went_to_showdown),
        hero_net_wsd=row.hero_net_wsd,
        hero_net_wsd_bb=row.hero_net_wsd_bb,
        hero_net_wwsd=row.hero_net_wwsd,
        hero_net_wwsd_bb=row.hero_net_wwsd_bb,
        actions=[
            ParsedAction(
                street=a.street,
                action_order=a.action_order,
                player_name=a.player_name,
                is_hero=a.is_hero,
                action=a.action,
                amount=a.amount,
            )
            for a in row.actions
        ],
    )


def _analyze_with_maps(
    db: Session,
    upload: HandUpload,
    hand,
    parsed: ParsedHand,
    spot_by_key,
    cell_by_key,
) -> None:
    if upload.strategy_id is None:
        return
    if not parsed.hero_preflop_action or not parsed.hero_hand_code or not parsed.detected_spot:
        return
    if not parsed.hero_position:
        return

    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key=parsed.detected_spot,
        hero_position=parsed.hero_position,
        villain_position=parsed.villain_position,
        hand_code=parsed.hero_hand_code,
    )
    if resolved is None:
        return

    spot, raise_f, call_f, fold_f = resolved
    actual = parsed.hero_preflop_action
    expected = pick_expected_action(raise_f, call_f, fold_f)
    freqs = {"raise": raise_f, "call": call_f, "fold": fold_f}
    actual_freq = freqs.get(actual, Decimal("0"))
    expected_freq = freqs[expected]

    if not is_deviation(actual, raise_f, call_f, fold_f):
        return

    db.add(
        Deviation(
            hand_id=hand.id,
            user_id=upload.user_id,
            strategy_id=upload.strategy_id,
            spot_id=spot.id,
            hand_code=parsed.hero_hand_code,
            actual_action=actual,
            expected_action=expected,
            actual_freq=actual_freq,
            expected_freq=expected_freq,
            severity=abs(expected_freq - actual_freq),
        )
    )


def sync_client_hands(
    db: Session,
    user: User,
    payload: ClientHandsSyncRequest,
) -> ClientHandsSyncResponse:
    """Insert pre-parsed hands into the active profile database."""
    n = len(payload.hands)
    assert_analysis_batch_size(n)
    sub_svc.assert_can_analyze_hands(user, n)

    strategy = db.get(Strategy, payload.strategy_id)
    if strategy is None or strategy.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Плейбук не найден")

    active_db = db_svc.get_active_database(db, user)
    assert_database_capacity(db, database_id=active_db.id, additional_hands=n)

    label = (payload.label or "Локальный импорт").strip()[:300] or "Локальный импорт"
    source = (payload.source_filename or "local-import.txt").strip()[:512]
    room = (payload.room or "pokerstars")[:64]

    session: PlaySession | None = None
    upload: HandUpload | None = None

    if payload.session_id is not None:
        session = db.get(PlaySession, payload.session_id)
        if (
            session is None
            or session.user_id != user.id
            or session.database_id != active_db.id
            or session.status != "active"
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Сессия для продолжения синхронизации не найдена",
            )
        upload = next(
            (u for u in session.uploads if u.strategy_id == payload.strategy_id),
            None,
        )
        if upload is None:
            upload = HandUpload(
                user_id=user.id,
                database_id=active_db.id,
                strategy_id=payload.strategy_id,
                session_id=session.id,
                room=room,
                original_filename=source,
                storage_path=None,
                status="pending",
                hands_count=0,
            )
            db.add(upload)
            db.flush()
    else:
        archive_user_active_sessions(db, user_id=user.id, database_id=active_db.id)
        db.commit()

        session = PlaySession(
            user_id=user.id,
            database_id=active_db.id,
            strategy_id=payload.strategy_id,
            room=room,
            label=label,
            source_filename=source,
            table_name=None,
            small_blind=None,
            big_blind=None,
            max_seats=None,
            started_at=None,
            ended_at=None,
            hands_count=0,
            status="active",
        )
        db.add(session)
        db.flush()

        upload = HandUpload(
            user_id=user.id,
            database_id=active_db.id,
            strategy_id=payload.strategy_id,
            session_id=session.id,
            room=room,
            original_filename=source,
            storage_path=None,
            status="pending",
            hands_count=0,
        )
        db.add(upload)
        db.flush()

    assert session is not None and upload is not None

    parsed_all = [_to_parsed(h) for h in payload.hands]
    candidate_ids = [p.external_hand_id for p in parsed_all]
    already = _known_external_ids(
        db,
        user.id,
        candidate_ids,
        strategy_id=payload.strategy_id,
        database_id=active_db.id,
    )

    seen: set[str] = set()
    new_hands: list[ParsedHand] = []
    duplicates = 0
    for parsed in parsed_all:
        eid = parsed.external_hand_id
        if not eid or eid in already or eid in seen:
            duplicates += 1
            continue
        seen.add(eid)
        new_hands.append(parsed)

    spot_by_key, cell_by_key = ({}, {})
    if upload.strategy_id is not None and new_hands:
        spot_by_key, cell_by_key = load_spot_maps(db, upload.strategy_id)

    CHUNK = 40
    for i, parsed in enumerate(new_hands, start=1):
        hand = _persist_hand(db, upload, parsed, session.id)
        _analyze_with_maps(db, upload, hand, parsed, spot_by_key, cell_by_key)
        if i % CHUNK == 0:
            db.commit()

    upload.hands_count = int(upload.hands_count or 0) + len(new_hands)
    session.hands_count = int(session.hands_count or 0) + len(new_hands)

    times = [p.played_at for p in new_hands if p.played_at is not None]
    if times:
        started = min(times)
        ended = max(times)
        sess_start = _aware(session.started_at)
        sess_end = _aware(session.ended_at)
        if sess_start is None or started < sess_start:
            session.started_at = started
        if sess_end is None or ended > sess_end:
            session.ended_at = ended
    if session.table_name is None:
        session.table_name = next((p.table_name for p in new_hands if p.table_name), None)
    if session.small_blind is None:
        sb = next((p.small_blind for p in new_hands if p.small_blind is not None), None)
        if sb is not None:
            session.small_blind = Decimal(str(sb))
    if session.big_blind is None:
        bb = next((p.big_blind for p in new_hands if p.big_blind is not None), None)
        if bb is not None:
            session.big_blind = Decimal(str(bb))

    if payload.finalize:
        upload.status = "analyzed"
        upload.processed_at = datetime.now(timezone.utc)
        apply_session_to_aggregates(db, session)
        attach_orphan_hand_rows(db, user, active_db.id)
        if new_hands:
            db.refresh(user)
            sub_svc.ensure_month_quota(user)
            sub_svc.consume_analyzed_hands(user, len(new_hands))
        db.commit()
        bankroll_svc.apply_session_to_bankroll(db, user.id, session.id)
        db.commit()
    else:
        upload.status = "parsing"
        if new_hands:
            db.refresh(user)
            sub_svc.ensure_month_quota(user)
            sub_svc.consume_analyzed_hands(user, len(new_hands))
        db.commit()

    return ClientHandsSyncResponse(
        session_id=session.id,
        upload_id=upload.id,
        database_id=active_db.id,
        hands_saved=len(new_hands),
        duplicates_skipped=duplicates,
        label=session.label,
    )
