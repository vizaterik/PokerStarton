"""Persist a PC-built analysis report + compact hands (no HH text / re-parse)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis_snapshot import AnalysisSnapshot
from app.models.hand import Hand, HandAction, HandUpload, PlaySession
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.analysis_snapshot import (
    AnalysisSnapshotRead,
    AnalysisSnapshotResponse,
    AnalysisSnapshotUpload,
    CompactAction,
    CompactHand,
)
from app.services import bankroll as bankroll_svc
from app.services import databases as db_svc
from app.services import subscription as sub_svc
from app.services.hand_limits import (
    assert_analysis_batch_size,
    assert_database_capacity,
    count_database_hands,
)
from app.services.hand_pipeline import archive_user_active_sessions


def _active_or_latest_session(
    db: Session,
    *,
    user_id: UUID,
    database_id: UUID,
) -> PlaySession | None:
    active = db.scalars(
        select(PlaySession)
        .where(
            PlaySession.user_id == user_id,
            PlaySession.database_id == database_id,
            PlaySession.status == "active",
        )
        .order_by(PlaySession.created_at.desc())
    ).first()
    if active is not None:
        return active
    return db.scalars(
        select(PlaySession)
        .where(
            PlaySession.user_id == user_id,
            PlaySession.database_id == database_id,
        )
        .order_by(PlaySession.created_at.desc())
    ).first()


def _new_external_count(
    db: Session,
    *,
    database_id: UUID,
    candidate_ids: list[str],
) -> int:
    """How many of candidate_ids are not yet in this hand database."""
    if not candidate_ids:
        return 0
    known: set[str] = set()
    # Chunk IN queries for large sessions
    STEP = 800
    for i in range(0, len(candidate_ids), STEP):
        chunk = candidate_ids[i : i + STEP]
        via_session = set(
            db.scalars(
                select(Hand.external_hand_id)
                .join(PlaySession, Hand.session_id == PlaySession.id)
                .where(
                    PlaySession.database_id == database_id,
                    Hand.external_hand_id.in_(chunk),
                )
            )
        )
        known |= via_session
    return sum(1 for eid in candidate_ids if eid not in known)


def _known_in_database(
    db: Session,
    *,
    database_id: UUID,
    candidate_ids: list[str],
) -> set[str]:
    if not candidate_ids:
        return set()
    known: set[str] = set()
    STEP = 800
    for i in range(0, len(candidate_ids), STEP):
        chunk = candidate_ids[i : i + STEP]
        known |= set(
            db.scalars(
                select(Hand.external_hand_id)
                .join(PlaySession, Hand.session_id == PlaySession.id)
                .where(
                    PlaySession.database_id == database_id,
                    Hand.external_hand_id.in_(chunk),
                )
            )
        )
    return known


def _dec(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _trainer_actions(row: CompactHand) -> list[CompactAction]:
    """Keep preflop through hero's decision (enough for Trainer)."""
    acts = list(row.actions or [])
    if not acts:
        # Minimal shell so grading still works when client sent only hero action.
        if row.hero_preflop_action and row.hero_name:
            return [
                CompactAction(
                    street="preflop",
                    action_order=0,
                    player_name=row.hero_name,
                    is_hero=True,
                    action=row.hero_preflop_action,
                    amount=None,
                )
            ]
        return []
    out: list[CompactAction] = []
    for a in acts:
        if (a.street or "").lower() != "preflop":
            break
        out.append(a)
        if a.is_hero and (a.action or "").lower() in {"raise", "call", "fold"}:
            break
    return out


def _persist_compact(
    db: Session,
    upload: HandUpload,
    session_id: UUID,
    row: CompactHand,
) -> Hand:
    raw = (row.raw_text or "").strip()
    hand = Hand(
        upload_id=upload.id,
        session_id=session_id,
        external_hand_id=row.external_hand_id.strip()[:64],
        played_at=_aware(row.played_at),
        table_name=row.table_name,
        small_blind=_dec(row.small_blind),
        big_blind=_dec(row.big_blind),
        hero_name=row.hero_name,
        hero_position=row.hero_position,
        hero_hand=row.hero_hand[:4] if row.hero_hand else None,
        hero_hand_code=row.hero_hand_code[:3] if row.hero_hand_code else None,
        detected_spot=row.detected_spot,
        villain_position=row.villain_position,
        stack_bb=_dec(row.stack_bb),
        hero_net=_dec(row.hero_net),
        hero_net_bb=_dec(row.hero_net_bb),
        went_to_showdown=bool(row.went_to_showdown),
        hero_net_wsd=_dec(row.hero_net_wsd),
        hero_net_wsd_bb=_dec(row.hero_net_wsd_bb),
        hero_net_wwsd=_dec(row.hero_net_wwsd),
        hero_net_wwsd_bb=_dec(row.hero_net_wwsd_bb),
        raw_text=raw,
    )
    db.add(hand)
    db.flush()
    for action in _trainer_actions(row):
        db.add(
            HandAction(
                hand_id=hand.id,
                street=(action.street or "preflop")[:16],
                action_order=int(action.action_order),
                player_name=(action.player_name or "Hero")[:100],
                is_hero=bool(action.is_hero),
                action=(action.action or "fold")[:32],
                amount=_dec(action.amount),
            )
        )
    return hand


def upload_analysis_snapshot(
    db: Session,
    user: User,
    payload: AnalysisSnapshotUpload,
) -> AnalysisSnapshotResponse:
    """Store compact hands in profile DB.

    Supports chunked uploads: first call creates a session; later calls pass
    ``session_id``; the last call sets ``finalize=True`` to build career report.
    """
    n = len(payload.hands)
    if n == 0 and not payload.finalize:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой пакет раздач",
        )
    if n:
        assert_analysis_batch_size(n)

    # Hands belong to the active hand DB — strategy is optional metadata only.
    strategy_id = None
    if payload.strategy_id is not None:
        strategy = db.get(Strategy, payload.strategy_id)
        if strategy is not None and strategy.user_id == user.id:
            strategy_id = strategy.id

    active_db = db_svc.get_active_database(db, user)

    label = (payload.label or "Локальный анализ").strip()[:300] or "Локальный анализ"
    source = (payload.source_filename or "local-import.txt").strip()[:512]
    room = (payload.room or "pokerstars")[:64]

    # Dedupe within payload
    seen: set[str] = set()
    unique: list[CompactHand] = []
    for h in payload.hands:
        eid = h.external_hand_id.strip()[:64]
        if not eid or eid in seen:
            continue
        seen.add(eid)
        unique.append(h)

    candidate_ids = [h.external_hand_id.strip()[:64] for h in unique]
    already = _known_in_database(db, database_id=active_db.id, candidate_ids=candidate_ids)
    new_rows = [h for h in unique if h.external_hand_id.strip()[:64] not in already]
    additional = len(new_rows)
    # Quota / capacity only for truly new rows — re-sync of duplicates must not block.
    if additional:
        sub_svc.assert_can_analyze_hands(user, additional)
        assert_database_capacity(db, database_id=active_db.id, additional_hands=additional)

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
                detail="Сессия для продолжения загрузки не найдена",
            )
        upload = next(
            (
                u
                for u in session.uploads
                if (u.strategy_id == strategy_id)
                or (u.strategy_id is None and strategy_id is None)
            ),
            None,
        )
        if upload is None:
            upload = HandUpload(
                user_id=user.id,
                database_id=active_db.id,
                strategy_id=strategy_id,
                session_id=session.id,
                room=room,
                original_filename=source,
                storage_path=None,
                status="parsing",
                hands_count=0,
            )
            db.add(upload)
            db.flush()
    else:
        # All hands already in DB — keep current sitting (never archive into an empty
        # active session; that made Analysis look like 0 hands while DB still had data).
        if additional == 0:
            session = _active_or_latest_session(
                db, user_id=user.id, database_id=active_db.id
            )
            if session is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Нет раздач для синхронизации",
                )
            if session.status != "active":
                session.status = "active"
                db.flush()
            upload = next(
                (
                    u
                    for u in session.uploads
                    if (u.strategy_id == strategy_id)
                    or (u.strategy_id is None and strategy_id is None)
                ),
                None,
            )
            if upload is None:
                upload = HandUpload(
                    user_id=user.id,
                    database_id=active_db.id,
                    strategy_id=strategy_id,
                    session_id=session.id,
                    room=room,
                    original_filename=source,
                    storage_path=None,
                    status="parsing",
                    hands_count=0,
                )
                db.add(upload)
                db.flush()
        else:
            # New sitting — archive previous active batch (hands stay in DB).
            archive_user_active_sessions(db, user_id=user.id, database_id=active_db.id)
            db.commit()

            times = [_aware(h.played_at) for h in new_rows if h.played_at is not None]
            started = _aware(payload.started_at) or (min(times) if times else None)
            ended = _aware(payload.ended_at) or (max(times) if times else None)
            sb = next((h.small_blind for h in new_rows if h.small_blind is not None), None)
            bb = next((h.big_blind for h in new_rows if h.big_blind is not None), None)
            table = next((h.table_name for h in new_rows if h.table_name), None)

            session = PlaySession(
                user_id=user.id,
                database_id=active_db.id,
                strategy_id=strategy_id,
                room=room,
                label=label,
                source_filename=source,
                table_name=table,
                small_blind=_dec(sb),
                big_blind=_dec(bb),
                max_seats=None,
                started_at=started,
                ended_at=ended,
                hands_count=0,
                status="active",
            )
            db.add(session)
            db.flush()

            upload = HandUpload(
                user_id=user.id,
                database_id=active_db.id,
                strategy_id=strategy_id,
                session_id=session.id,
                room=room,
                original_filename=source,
                storage_path=None,
                status="parsing",
                hands_count=0,
            )
            db.add(upload)
            db.flush()

    assert session is not None and upload is not None

    CHUNK = 100
    for i, row in enumerate(new_rows, start=1):
        _persist_compact(db, upload, session.id, row)
        if i % CHUNK == 0:
            db.commit()

    upload.hands_count = int(upload.hands_count or 0) + len(new_rows)
    session.hands_count = int(session.hands_count or 0) + len(new_rows)

    times = [_aware(h.played_at) for h in new_rows if h.played_at is not None]
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
        session.table_name = next((h.table_name for h in new_rows if h.table_name), None)
    if session.small_blind is None:
        sb = next((h.small_blind for h in new_rows if h.small_blind is not None), None)
        if sb is not None:
            session.small_blind = _dec(sb)
    if session.big_blind is None:
        bb = next((h.big_blind for h in new_rows if h.big_blind is not None), None)
        if bb is not None:
            session.big_blind = _dec(bb)

    if new_rows:
        db.refresh(user)
        sub_svc.ensure_month_quota(user)
        sub_svc.consume_analyzed_hands(user, len(new_rows))

    snap: AnalysisSnapshot | None = None
    career = None

    if payload.finalize:
        report = dict(payload.report or {})
        report.setdefault("handTotal", int(session.hands_count or 0))
        report.setdefault("source", "pc_snapshot")

        snap = AnalysisSnapshot(
            user_id=user.id,
            database_id=active_db.id,
            strategy_id=strategy_id,
            session_id=session.id,
            payload=report,
        )
        db.add(snap)
        upload.status = "analyzed"
        upload.processed_at = datetime.now(timezone.utc)
        db.commit()

        bankroll_svc.apply_session_to_bankroll(db, user.id, session.id)
        db.commit()

        from app.services import compute_cache
        from app.services.results import refresh_and_store_career_report
        from app.services.trainer import invalidate_trainer_cache

        career = refresh_and_store_career_report(db, user.id, active_db.id)
        db.commit()

        compute_cache.invalidate_user(user.id)
        invalidate_trainer_cache()
        compute_cache.set(
            f"u:{user.id}:results:db:{active_db.id}:s:-:from::to:",
            career,
        )
    else:
        upload.status = "parsing"
        db.commit()

    return AnalysisSnapshotResponse(
        session_id=session.id,
        snapshot_id=snap.id if snap else None,
        database_id=active_db.id,
        hands_saved=len(new_rows),
        hands_total=count_database_hands(db, active_db.id),
        finalize=bool(payload.finalize),
        label=session.label,
        career_report=career,
    )


def get_latest_snapshot(
    db: Session,
    user: User,
    *,
    strategy_id: UUID | None = None,
) -> AnalysisSnapshotRead | None:
    active_db = db_svc.get_active_database(db, user)
    q = (
        select(AnalysisSnapshot)
        .where(
            AnalysisSnapshot.user_id == user.id,
            AnalysisSnapshot.database_id == active_db.id,
        )
        .order_by(AnalysisSnapshot.created_at.desc())
    )
    if strategy_id is not None:
        q = q.where(AnalysisSnapshot.strategy_id == strategy_id)
    snap = db.scalars(q.limit(1)).first()
    if snap is None:
        return None
    session = db.get(PlaySession, snap.session_id)
    return AnalysisSnapshotRead(
        snapshot_id=snap.id,
        session_id=snap.session_id,
        strategy_id=snap.strategy_id,
        database_id=snap.database_id,
        hands_count=session.hands_count if session else 0,
        label=session.label if session else "",
        source_filename=session.source_filename if session else "",
        created_at=snap.created_at,
        report=snap.payload or {},
    )
