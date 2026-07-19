import asyncio
from datetime import datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.hand import Deviation, Hand, HandUpload, PlaySession
from app.models.strategy import Strategy
from app.models.user import User
from app.schemas.analysis_snapshot import (
    AnalysisSnapshotRead,
    AnalysisSnapshotResponse,
    AnalysisSnapshotUpload,
)
from app.schemas.client_sync import ClientHandsSyncRequest, ClientHandsSyncResponse
from app.schemas.hand import (
    BatchUploadReport,
    DeviationRead,
    HandRead,
    HandUploadRead,
    PlaySessionRead,
    ResultsReport,
    UploadReport,
)
from app.services import bankroll as bankroll_svc
from app.services import compute_cache
from app.services import databases as db_svc
from app.services import subscription as sub_svc
from app.services.analysis_snapshot import get_latest_snapshot, upload_analysis_snapshot
from app.services.client_sync import sync_client_hands
from app.services.hand_limits import (
    assert_analysis_batch_size,
    assert_database_capacity,
)
from app.services.hand_pipeline import (
    archive_user_active_sessions,
    process_upload,
    purge_orphaned_hand_history,
    session_report,
    session_reports,
    upload_report,
)
from app.services.results import build_results_report
from app.services import hand_replay as hand_replay_svc
from app.schemas.analysis import StatHandsResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _ensure_upload_dir() -> Path:
    path = Path(settings.upload_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _estimate_hand_blocks(content: bytes) -> int:
    """Rough count of HH blocks before full parse (PokerStars/GG style)."""
    text = content.decode("utf-8", errors="ignore")
    # PokerStars / most rooms start hands with "PokerStars Hand #" or "Hand #"
    markers = (
        text.count("PokerStars Hand #")
        + text.count("Poker Hand #")
        + text.count("Hand History for Game")
        + text.count("***** Hand History")
    )
    if markers > 0:
        return markers
    # Fallback: blank-line separated chunks
    chunks = [c for c in text.replace("\r\n", "\n").split("\n\n") if c.strip()]
    return max(len(chunks), 1)


async def _store_and_process(
    db: Session,
    *,
    user: User,
    strategy_id: UUID,
    file: UploadFile,
    content: bytes | None = None,
) -> UploadReport:
    """Parse the uploaded file and persist its hands for analysis."""
    upload_dir = _ensure_upload_dir()
    safe_name = Path(file.filename or "hands.txt").name
    raw = content if content is not None else await file.read()
    if not raw.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Пустой файл: {safe_name}")

    # Refresh user from DB for quota fields
    db.refresh(user)
    estimate = _estimate_hand_blocks(raw)
    sub_svc.assert_can_analyze_hands(user, estimate)

    stored_name = f"{uuid4()}_{safe_name}"
    storage_path = upload_dir / stored_name
    storage_path.write_bytes(raw)

    active_db = db_svc.get_active_database(db, user)
    upload = HandUpload(
        user_id=user.id,
        database_id=active_db.id,
        strategy_id=strategy_id,
        room="pokerstars",
        original_filename=safe_name,
        storage_path=str(storage_path),
        status="pending",
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    processed = process_upload(db, upload.id)
    report = upload_report(db, processed)
    new_hands = int(report.get("hands_count") or 0)
    if new_hands:
        db.refresh(user)
        sub_svc.ensure_month_quota(user)
        sub_svc.consume_analyzed_hands(user, new_hands)
        db.commit()
    return UploadReport(**report)


def _process_upload_batch_sync(
    *,
    user_id: UUID,
    strategy_id: UUID,
    database_id: UUID,
    files: list[tuple[str, bytes]],
) -> tuple[list[UploadReport], list[PlaySessionRead]]:
    """Heavy parse/persist off the asyncio event loop (own DB session)."""
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError("User not found")
        upload_dir = _ensure_upload_dir()
        reports: list[UploadReport] = []
        for safe_name, raw in files:
            estimate = _estimate_hand_blocks(raw)
            sub_svc.assert_can_analyze_hands(user, estimate)
            stored_name = f"{uuid4()}_{safe_name}"
            storage_path = upload_dir / stored_name
            storage_path.write_bytes(raw)
            upload = HandUpload(
                user_id=user.id,
                database_id=database_id,
                strategy_id=strategy_id,
                room="pokerstars",
                original_filename=safe_name,
                storage_path=str(storage_path),
                status="pending",
            )
            db.add(upload)
            db.commit()
            db.refresh(upload)
            processed = process_upload(db, upload.id)
            report = UploadReport(**upload_report(db, processed))
            new_hands = int(report.hands_count or 0)
            if new_hands:
                db.refresh(user)
                sub_svc.ensure_month_quota(user)
                sub_svc.consume_analyzed_hands(user, new_hands)
                db.commit()
            reports.append(report)

        seen_sessions: set[UUID] = set()
        for report in reports:
            if not report.session_id or report.session_id in seen_sessions:
                continue
            seen_sessions.add(report.session_id)
            bankroll_svc.apply_session_to_bankroll(db, user_id, report.session_id)

        sessions: list[PlaySessionRead] = []
        for report in reports:
            if report.session_id:
                session = db.get(PlaySession, report.session_id)
                if session is not None:
                    sessions.append(PlaySessionRead(**session_report(db, session)))
        return reports, sessions
    finally:
        db.close()


@router.get("", response_model=list[HandUploadRead])
def list_uploads(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[HandUpload]:
    active_id = db_svc.get_active_database_id(db, current_user)
    db.commit()
    return list(
        db.scalars(
            select(HandUpload)
            .where(
                HandUpload.user_id == current_user.id,
                HandUpload.database_id == active_id,
            )
            .order_by(HandUpload.uploaded_at.desc())
        )
    )


@router.get("/results", response_model=ResultsReport)
def get_results(
    session_id: UUID | None = None,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResultsReport:
    """Career report + schedule: all hands in the active profile hand database.

    Includes archived sittings (previous analysis batches). Not limited to the
    latest active analysis batch — that filter is only for /analysis HUD.

    All-time report is precomputed on analysis upload and stored on the hand DB.
    """
    from app.services.results import refresh_and_store_career_report

    # Resolves active DB, attaches orphans, purges re-upload duplicate hand rows.
    active = db_svc.get_active_database(db, current_user)
    active_id = active.id
    db.commit()
    # Frontend filters periods client-side from all-time; cache that payload.
    cache_key = (
        f"u:{current_user.id}:results:db:{active_id}"
        f":s:{session_id or '-'}"
        f":from:{date_from.isoformat() if date_from else ''}"
        f":to:{date_to.isoformat() if date_to else ''}"
    )
    cached = compute_cache.get(cache_key)
    if cached is not None:
        return ResultsReport(**cached)

    # Prefer stored career JSON (no hand scan) for the default all-time view.
    if session_id is None and date_from is None and date_to is None:
        db.refresh(active)
        if isinstance(active.career_report, dict):
            compute_cache.set(cache_key, active.career_report)
            return ResultsReport(**active.career_report)
        payload = refresh_and_store_career_report(db, current_user.id, active_id)
        db.commit()
        compute_cache.set(cache_key, payload)
        return ResultsReport(**payload)

    payload = build_results_report(
        db,
        current_user.id,
        session_id=session_id,
        date_from=date_from,
        date_to=date_to,
        database_id=active_id,
    )
    compute_cache.set(cache_key, payload)
    return ResultsReport(**payload)


@router.get("/results/hu-hands", response_model=StatHandsResponse)
def get_results_hu_pot_hands(
    pot_kind: str = Query(..., min_length=1),
    matchup: str = Query(..., min_length=1),
    session_id: UUID | None = None,
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = 150,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatHandsResponse:
    """Replay hands for one HU pot branch in the career results report."""
    active_id = db_svc.get_active_database_id(db, current_user)
    db.commit()
    try:
        return hand_replay_svc.list_results_hu_pot_hands(
            db,
            current_user.id,
            pot_kind,
            matchup,
            session_id=session_id,
            date_from=date_from,
            date_to=date_to,
            database_id=active_id,
            limit=max(1, min(limit, 300)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/sessions", response_model=list[PlaySessionRead])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PlaySessionRead]:
    active_id = db_svc.get_active_database_id(db, current_user)
    db.commit()
    sessions = list(
        db.scalars(
            select(PlaySession)
            .where(
                PlaySession.user_id == current_user.id,
                PlaySession.database_id == active_id,
            )
            .order_by(PlaySession.started_at.desc().nulls_last(), PlaySession.created_at.desc())
        )
    )
    return [
        PlaySessionRead(**row)
        for row in session_reports(db, sessions)
    ]


@router.get("/sessions/{session_id}", response_model=PlaySessionRead)
def get_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlaySessionRead:
    session = db.get(PlaySession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сессия не найдена")
    return PlaySessionRead(**session_report(db, session))


@router.get("/sessions/{session_id}/deviations", response_model=list[DeviationRead])
def list_session_deviations(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Deviation]:
    session = db.get(PlaySession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сессия не найдена")
    return list(
        db.scalars(
            select(Deviation)
            .join(Hand, Deviation.hand_id == Hand.id)
            .where(Hand.session_id == session_id, Deviation.user_id == current_user.id)
        )
    )


def _client_hands_sync(
    *,
    user_id: UUID,
    payload: ClientHandsSyncRequest,
) -> ClientHandsSyncResponse:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError("User not found")
        return sync_client_hands(db, user, payload)
    finally:
        db.close()


def _snapshot_upload_sync(
    *,
    user_id: UUID,
    payload: AnalysisSnapshotUpload,
) -> AnalysisSnapshotResponse:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError("User not found")
        return upload_analysis_snapshot(db, user, payload)
    finally:
        db.close()


@router.post("/analysis-snapshot", response_model=AnalysisSnapshotResponse)
async def post_analysis_snapshot(
    payload: AnalysisSnapshotUpload,
    current_user: User = Depends(get_current_user),
) -> AnalysisSnapshotResponse:
    """Store PC analysis report + compact hands (no HH text, no server re-parse)."""
    user_id = current_user.id
    try:
        return await asyncio.to_thread(_snapshot_upload_sync, user_id=user_id, payload=payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка загрузки отчёта: {exc}",
        ) from exc


@router.get("/analysis-snapshot", response_model=AnalysisSnapshotRead)
def read_analysis_snapshot(
    strategy_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalysisSnapshotRead:
    """Latest analysis snapshot for the active session in the active hand DB."""
    snap = get_latest_snapshot(db, current_user, strategy_id=strategy_id)
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Снимок анализа не найден")
    return snap


@router.post("/client-hands", response_model=ClientHandsSyncResponse)
async def sync_client_parsed_hands(
    payload: ClientHandsSyncRequest,
    current_user: User = Depends(get_current_user),
) -> ClientHandsSyncResponse:
    """Store PC-parsed hands in the active hand DB (no server HH parse)."""
    user_id = current_user.id
    try:
        return await asyncio.to_thread(_client_hands_sync, user_id=user_id, payload=payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка загрузки в базу: {exc}",
        ) from exc


@router.post("", response_model=BatchUploadReport, status_code=status.HTTP_201_CREATED)
async def create_upload(
    strategy_id: UUID = Form(...),
    files: list[UploadFile] | None = File(default=None),
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BatchUploadReport:
    strategy = db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Стратегия не найдена")

    # Drop HH left after strategy deletes so the same files can be imported again.
    if purge_orphaned_hand_history(db, current_user.id):
        db.commit()

    batch: list[UploadFile] = []
    if files:
        batch.extend(files)
    if file is not None:
        batch.append(file)
    # Deduplicate by identity if both sent the same handle
    seen: set[int] = set()
    unique: list[UploadFile] = []
    for item in batch:
        key = id(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    if not unique:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите хотя бы один файл")

    # Read all files first — enforce per-analysis and database capacity limits.
    prepared: list[tuple[UploadFile, bytes, int]] = []
    total_estimate = 0
    for item in unique:
        raw = await item.read()
        if not raw.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Пустой файл: {Path(item.filename or 'hands.txt').name}",
            )
        estimate = _estimate_hand_blocks(raw)
        prepared.append((item, raw, estimate))
        total_estimate += estimate

    assert_analysis_batch_size(total_estimate)

    active_db = db_svc.get_active_database(db, current_user)
    assert_database_capacity(
        db,
        database_id=active_db.id,
        additional_hands=total_estimate,
    )

    # One active session batch per database. Previous batch stays archived.
    archive_user_active_sessions(
        db, user_id=current_user.id, database_id=active_db.id
    )
    db.commit()

    file_payload = [
        (Path(item.filename or "hands.txt").name, raw) for item, raw, _est in prepared
    ]
    user_id = current_user.id
    database_id = active_db.id
    # Release request session before heavy work so other API calls (login/me) can proceed.
    db.close()

    try:
        reports, sessions = await asyncio.to_thread(
            _process_upload_batch_sync,
            user_id=user_id,
            strategy_id=strategy_id,
            database_id=database_id,
            files=file_payload,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)[:400],
        ) from exc

    return BatchUploadReport(
        uploads=reports,
        sessions=sessions,
        files_count=len(reports),
        total_hands=sum(r.hands_count for r in reports),
        total_duplicates_skipped=sum(r.duplicates_skipped for r in reports),
        total_deviations=sum(r.deviations_count for r in reports),
        total_correct=sum(r.correct_count for r in reports),
    )


@router.get("/{upload_id}", response_model=HandUploadRead)
def get_upload(
    upload_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HandUpload:
    upload = db.get(HandUpload, upload_id)
    if upload is None or upload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    return upload


@router.get("/{upload_id}/report", response_model=UploadReport)
def get_upload_report(
    upload_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UploadReport:
    upload = db.get(HandUpload, upload_id)
    if upload is None or upload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    return UploadReport(**upload_report(db, upload))


@router.get("/{upload_id}/hands", response_model=list[HandRead])
def list_hands(
    upload_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Hand]:
    upload = db.get(HandUpload, upload_id)
    if upload is None or upload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    return list(db.scalars(select(Hand).where(Hand.upload_id == upload_id)))


@router.get("/{upload_id}/deviations", response_model=list[DeviationRead])
def list_deviations(
    upload_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Deviation]:
    upload = db.get(HandUpload, upload_id)
    if upload is None or upload.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    return list(
        db.scalars(
            select(Deviation)
            .join(Hand, Deviation.hand_id == Hand.id)
            .where(Hand.upload_id == upload_id, Deviation.user_id == current_user.id)
        )
    )
