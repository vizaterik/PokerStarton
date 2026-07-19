"""Career results must not count re-uploaded / multi-table sessions twice."""

from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.hand import Hand, HandUpload, PlaySession
from app.models.user import User
from app.services.databases import attach_orphan_hand_rows, ensure_default_database
from app.services.results import build_results_report, merge_concurrent_session_rows


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _user(db: Session) -> User:
    user = User(
        id=uuid4(),
        email=f"{uuid4().hex}@t.test",
        password_hash="x",
        display_name=f"u{uuid4().hex[:8]}",
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _session_hand(
    db: Session,
    user: User,
    *,
    filename: str,
    eid: str,
    status: str,
    net: float = 1.0,
    played_at: datetime | None = None,
    played_end: datetime | None = None,
    database_id=None,
):
    start = played_at or datetime(2026, 1, 15, 12, 0, 0)
    session = PlaySession(
        id=uuid4(),
        user_id=user.id,
        database_id=database_id,
        room="ggpoker",
        label=filename,
        source_filename=filename,
        hands_count=1,
        status=status,
        started_at=start,
    )
    upload = HandUpload(
        id=uuid4(),
        user_id=user.id,
        database_id=database_id,
        session_id=session.id,
        room="ggpoker",
        original_filename=filename,
        status="analyzed",
        hands_count=1 if played_end is None else 2,
    )
    db.add_all([session, upload])
    db.flush()
    hand = Hand(
        id=uuid4(),
        upload_id=upload.id,
        session_id=session.id,
        external_hand_id=eid,
        raw_text="x",
        played_at=start,
        hero_net=net,
        hero_net_bb=net * 10,
        big_blind=0.1,
    )
    db.add(hand)
    if played_end is not None:
        hand2 = Hand(
            id=uuid4(),
            upload_id=upload.id,
            session_id=session.id,
            external_hand_id=f"{eid}-end",
            raw_text="x",
            played_at=played_end,
            hero_net=0.0,
            hero_net_bb=0.0,
            big_blind=0.1,
        )
        db.add(hand2)
    db.flush()
    return session


def test_reupload_same_hands_counts_one_session():
    db = _db()
    user = _user(db)
    _session_hand(db, user, filename="a.txt", eid="RC1", status="archived", net=2.0)
    _session_hand(db, user, filename="a.txt", eid="RC1", status="active", net=2.0)
    db.commit()

    report = build_results_report(db, user.id)
    assert report["sessions_count"] == 1
    assert len(report["sessions"]) == 1
    assert report["total_hands"] == 1
    assert report["sessions"][0]["hands_count"] == 1


def test_distinct_days_still_two_sessions():
    db = _db()
    user = _user(db)
    _session_hand(
        db,
        user,
        filename="a.txt",
        eid="RC1",
        status="active",
        net=1.0,
        played_at=datetime(2026, 1, 15, 12, 0, 0),
    )
    _session_hand(
        db,
        user,
        filename="b.txt",
        eid="RC2",
        status="active",
        net=-1.0,
        played_at=datetime(2026, 1, 16, 18, 0, 0),
    )
    db.commit()

    report = build_results_report(db, user.id)
    assert report["sessions_count"] == 2
    assert report["total_hands"] == 2


def test_archived_sittings_still_in_career_report():
    """New analysis batch archives prior sittings — career keeps the full base."""
    db = _db()
    user = _user(db)
    _session_hand(
        db,
        user,
        filename="day15.txt",
        eid="RC15",
        status="archived",
        net=2.0,
        played_at=datetime(2026, 7, 15, 17, 0, 0),
    )
    _session_hand(
        db,
        user,
        filename="day18.txt",
        eid="RC18",
        status="active",
        net=-1.0,
        played_at=datetime(2026, 7, 18, 20, 0, 0),
    )
    db.commit()

    report = build_results_report(db, user.id)
    assert report["sessions_count"] == 2
    assert report["total_hands"] == 2
    labels = {s["label"] for s in report["sessions"]}
    assert "day15.txt" in labels
    assert "day18.txt" in labels


def test_two_distinct_sittings_both_in_career_after_new_analysis():
    """New analysis batch is active-only for HUD; career keeps prior unique sitting."""
    from app.models.hand_database import HandDatabase

    db = _db()
    user = _user(db)
    hand_db = HandDatabase(id=uuid4(), user_id=user.id, name="Основная")
    db.add(hand_db)
    db.flush()
    user.active_database_id = hand_db.id

    _session_hand(
        db,
        user,
        filename="day15.txt",
        eid="DAY15-A",
        status="archived",
        net=2.0,
        played_at=datetime(2026, 7, 15, 17, 0, 0),
        database_id=hand_db.id,
    )
    _session_hand(
        db,
        user,
        filename="day18.txt",
        eid="DAY18-A",
        status="active",
        net=-1.0,
        played_at=datetime(2026, 7, 18, 20, 0, 0),
        database_id=hand_db.id,
    )
    db.commit()

    report = build_results_report(db, user.id, database_id=hand_db.id)
    assert report["total_hands"] == 2
    assert report["sessions_count"] == 2
    assert len(report["curve"]) == 2


def test_purge_reupload_dupes_keeps_distinct_career_sittings():
    from app.models.hand_database import HandDatabase
    from app.services.hand_limits import count_database_hands
    from app.services.hand_pipeline import purge_duplicate_hands_in_database

    db = _db()
    user = _user(db)
    hand_db = HandDatabase(id=uuid4(), user_id=user.id, name="Основная")
    db.add(hand_db)
    db.flush()
    user.active_database_id = hand_db.id

    _session_hand(
        db,
        user,
        filename="old.txt",
        eid="SAME-1",
        status="archived",
        net=1.0,
        played_at=datetime(2026, 7, 15, 12, 0, 0),
        database_id=hand_db.id,
    )
    _session_hand(
        db,
        user,
        filename="new.txt",
        eid="SAME-1",
        status="active",
        net=1.0,
        played_at=datetime(2026, 7, 18, 12, 0, 0),
        database_id=hand_db.id,
    )
    _session_hand(
        db,
        user,
        filename="other-day.txt",
        eid="OTHER-1",
        status="archived",
        net=2.0,
        played_at=datetime(2026, 7, 10, 12, 0, 0),
        database_id=hand_db.id,
    )
    db.commit()
    assert count_database_hands(db, hand_db.id) == 2  # unique ids

    removed = purge_duplicate_hands_in_database(db, hand_db.id)
    db.commit()
    assert removed == 1
    assert count_database_hands(db, hand_db.id) == 2

    report = build_results_report(db, user.id, database_id=hand_db.id)
    assert report["total_hands"] == 2
    assert report["sessions_count"] == 2


def test_career_report_active_database_includes_archive_and_orphans():
    """API scopes by active DB — archived + reattached orphans must still count."""
    from app.models.hand_database import HandDatabase
    from app.services.databases import ensure_default_database

    db = _db()
    user = _user(db)
    hand_db = HandDatabase(id=uuid4(), user_id=user.id, name="Основная")
    db.add(hand_db)
    db.flush()
    user.active_database_id = hand_db.id

    _session_hand(
        db,
        user,
        filename="archived.txt",
        eid="A1",
        status="archived",
        net=3.0,
        played_at=datetime(2026, 7, 15, 12, 0, 0),
        database_id=hand_db.id,
    )
    _session_hand(
        db,
        user,
        filename="active.txt",
        eid="B1",
        status="active",
        net=-1.0,
        played_at=datetime(2026, 7, 18, 12, 0, 0),
        database_id=hand_db.id,
    )
    # Legacy row without database_id — must be attached before report.
    _session_hand(
        db,
        user,
        filename="orphan.txt",
        eid="C1",
        status="archived",
        net=1.0,
        played_at=datetime(2026, 7, 10, 12, 0, 0),
        database_id=None,
    )
    db.commit()

    # Without attach, orphan is invisible when filtering by database_id.
    missing = build_results_report(db, user.id, database_id=hand_db.id)
    assert missing["total_hands"] == 2

    ensure_default_database(db, user)
    attach_orphan_hand_rows(db, user, hand_db.id)
    db.commit()

    report = build_results_report(db, user.id, database_id=hand_db.id)
    assert report["total_hands"] == 3
    assert report["sessions_count"] == 3
    assert len(report["curve"]) == 3
    labels = {s["label"] for s in report["sessions"]}
    assert labels == {"archived.txt", "active.txt", "orphan.txt"}


def test_parallel_tables_count_as_one_session():
    """Two Rush tables uploaded separately, same sitting → 1 session."""
    db = _db()
    user = _user(db)
    t0 = datetime(2026, 1, 15, 20, 0, 0)
    _session_hand(
        db,
        user,
        filename="table1.txt",
        eid="T1-1",
        status="active",
        net=5.0,
        played_at=t0,
        played_end=t0 + timedelta(hours=2),
    )
    _session_hand(
        db,
        user,
        filename="table2.txt",
        eid="T2-1",
        status="active",
        net=-2.0,
        played_at=t0 + timedelta(minutes=3),
        played_end=t0 + timedelta(hours=2, minutes=5),
    )
    db.commit()

    report = build_results_report(db, user.id)
    assert report["sessions_count"] == 1
    assert report["total_hands"] == 4
    row = report["sessions"][0]
    assert row["tables_count"] == 2
    assert row["hands_count"] == 4
    assert "стола" in row["label"]


def test_merge_helper_gap_over_threshold_keeps_separate():
    t0 = datetime(2026, 1, 15, 12, 0, 0)
    rows = [
        {
            "id": uuid4(),
            "label": "a",
            "room": "gg",
            "source_filename": "a.txt",
            "started_at": t0,
            "hands_count": 10,
            "profit_money": 1.0,
            "profit_bb": 10.0,
            "_start": t0,
            "_end": t0 + timedelta(hours=1),
        },
        {
            "id": uuid4(),
            "label": "b",
            "room": "gg",
            "source_filename": "b.txt",
            "started_at": t0 + timedelta(hours=3),
            "hands_count": 8,
            "profit_money": 2.0,
            "profit_bb": 20.0,
            "_start": t0 + timedelta(hours=3),
            "_end": t0 + timedelta(hours=4),
        },
    ]
    merged = merge_concurrent_session_rows(rows)
    assert len(merged) == 2
