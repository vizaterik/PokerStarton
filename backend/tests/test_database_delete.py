"""Hand-database clear / delete must not hang on ORM cascades."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.analysis_snapshot import AnalysisSnapshot
from app.models.hand import Hand, HandUpload, PlaySession
from app.models.hand_database import HandDatabase
from app.models.user import User
from app.services.databases import clear_database, delete_database, ensure_default_database
from app.services.hand_limits import count_database_hands


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _user(db: Session) -> User:
    user = User(
        email=f"{uuid4().hex}@t.test",
        password_hash="x",
        email_verified=True,
        accepted_terms=True,
    )
    db.add(user)
    db.flush()
    return user


def test_delete_second_database_removes_row():
    db = _session()
    user = _user(db)
    main = ensure_default_database(db, user)
    other = HandDatabase(user_id=user.id, name="MTT")
    db.add(other)
    db.flush()

    session = PlaySession(
        user_id=user.id,
        database_id=other.id,
        label="s",
        source_filename="a.txt",
        hands_count=1,
    )
    db.add(session)
    db.flush()
    upload = HandUpload(
        user_id=user.id,
        database_id=other.id,
        session_id=session.id,
        original_filename="a.txt",
        status="analyzed",
        hands_count=1,
    )
    db.add(upload)
    db.flush()
    db.add(
        Hand(
            upload_id=upload.id,
            session_id=session.id,
            external_hand_id="1",
            raw_text="",
            hero_net=1,
            hero_net_bb=1,
        )
    )
    db.add(
        AnalysisSnapshot(
            user_id=user.id,
            database_id=other.id,
            session_id=session.id,
            payload={"source": "test"},
        )
    )
    db.commit()

    result = delete_database(db, user, other.id)
    db.commit()
    assert result["deleted"] is True
    assert db.get(HandDatabase, other.id) is None
    assert db.get(HandDatabase, main.id) is not None
    assert db.scalar(select(Hand).limit(1)) is None


def test_delete_sole_database_resets_instead_of_error():
    db = _session()
    user = _user(db)
    main = ensure_default_database(db, user)
    main.name = "Cash"
    db.flush()

    session = PlaySession(
        user_id=user.id,
        database_id=main.id,
        label="s",
        source_filename="a.txt",
        hands_count=1,
    )
    db.add(session)
    db.flush()
    upload = HandUpload(
        user_id=user.id,
        database_id=main.id,
        session_id=session.id,
        original_filename="a.txt",
        status="analyzed",
        hands_count=1,
    )
    db.add(upload)
    db.flush()
    db.add(
        Hand(
            upload_id=upload.id,
            session_id=session.id,
            external_hand_id="1",
            raw_text="",
        )
    )
    db.commit()

    result = delete_database(db, user, main.id)
    db.commit()
    assert result["deleted"] is False
    assert result["reset"] is True
    still = db.get(HandDatabase, main.id)
    assert still is not None
    assert still.name == "Основная"
    assert still.career_report is None
    assert count_database_hands(db, main.id) == 0


def test_clear_database_wipes_snapshot_and_hands():
    db = _session()
    user = _user(db)
    main = ensure_default_database(db, user)
    session = PlaySession(
        user_id=user.id,
        database_id=main.id,
        label="s",
        source_filename="a.txt",
        hands_count=1,
    )
    db.add(session)
    db.flush()
    upload = HandUpload(
        user_id=user.id,
        database_id=main.id,
        session_id=session.id,
        original_filename="a.txt",
        status="analyzed",
        hands_count=1,
    )
    db.add(upload)
    db.flush()
    db.add(
        Hand(
            upload_id=upload.id,
            session_id=session.id,
            external_hand_id="1",
            raw_text="",
        )
    )
    db.add(
        AnalysisSnapshot(
            user_id=user.id,
            database_id=main.id,
            session_id=session.id,
            payload={"x": 1},
        )
    )
    db.commit()

    clear_database(db, user, main.id)
    db.commit()
    assert db.scalar(select(PlaySession).limit(1)) is None
    assert db.scalar(select(AnalysisSnapshot).limit(1)) is None
    assert db.get(HandDatabase, main.id) is not None
