"""Active session is user-owned; strategy only selects charts for recalculation."""

from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.hand import Hand, HandUpload, PlaySession
from app.models.strategy import Strategy
from app.models.user import User
from app.services.hand_pipeline import archive_user_active_sessions
from app.services.hud_stats import load_strategy_hands


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _seed(db: Session):
    user = User(
        id=uuid4(),
        email=f"{uuid4().hex}@t.test",
        password_hash="x",
        display_name=f"u{uuid4().hex[:8]}",
        email_verified=True,
    )
    strategy = Strategy(id=uuid4(), user_id=user.id, name="Test", is_default=False)
    db.add_all([user, strategy])
    db.flush()
    return user, strategy


def _session_with_hand(
    db: Session,
    user: User,
    strategy: Strategy | None,
    *,
    filename: str,
    eid: str,
    status: str = "active",
):
    session = PlaySession(
        id=uuid4(),
        user_id=user.id,
        strategy_id=strategy.id if strategy else None,
        room="ggpoker",
        label=filename,
        source_filename=filename,
        hands_count=1,
        status=status,
    )
    upload = HandUpload(
        id=uuid4(),
        user_id=user.id,
        strategy_id=strategy.id if strategy else None,
        session_id=session.id,
        room="ggpoker",
        original_filename=filename,
        status="analyzed",
        hands_count=1,
    )
    db.add_all([session, upload])
    db.flush()
    hand = Hand(
        id=uuid4(),
        upload_id=upload.id,
        session_id=session.id,
        external_hand_id=eid,
        raw_text="x",
    )
    db.add(hand)
    db.flush()
    return session, hand


def test_archive_keeps_rows_in_db():
    db = _db()
    user, strategy = _seed(db)
    a, _ = _session_with_hand(db, user, strategy, filename="a.txt", eid="RC1")
    b, _ = _session_with_hand(db, user, strategy, filename="b.txt", eid="RC2")
    n = archive_user_active_sessions(db, user_id=user.id, keep_session_ids={b.id})
    db.commit()
    assert n == 1
    db.refresh(a)
    db.refresh(b)
    assert a.status == "archived"
    assert b.status == "active"
    assert db.get(PlaySession, a.id) is not None


def test_analysis_uses_active_session_for_any_strategy():
    db = _db()
    user, strategy_a = _seed(db)
    strategy_b = Strategy(id=uuid4(), user_id=user.id, name="B", is_default=False)
    db.add(strategy_b)
    db.flush()
    _session_with_hand(db, user, strategy_a, filename="session.txt", eid="RC100")
    db.commit()

    # Same hands whether we ask for strategy A or B.
    hands_a = load_strategy_hands(db, user.id, strategy_a.id)
    hands_b = load_strategy_hands(db, user.id, strategy_b.id)
    assert {h.external_hand_id for h in hands_a} == {"RC100"}
    assert {h.external_hand_id for h in hands_b} == {"RC100"}


def test_new_upload_archives_previous_active_batch():
    db = _db()
    user, strategy = _seed(db)
    old, _ = _session_with_hand(db, user, strategy, filename="old.txt", eid="RC100")
    archive_user_active_sessions(db, user_id=user.id)
    fresh, _ = _session_with_hand(db, user, strategy, filename="new.txt", eid="RC200")
    db.commit()
    db.refresh(old)
    assert old.status == "archived"
    assert db.get(PlaySession, old.id) is not None
    hands = load_strategy_hands(db, user.id, strategy.id)
    assert {h.external_hand_id for h in hands} == {"RC200"}
    assert all(h.session_id == fresh.id for h in hands)


def test_purge_keeps_hand_database_career_sessions():
    """After strategy_id is cleared, sessions in a hand DB must not be wiped."""
    from app.models.hand_database import HandDatabase
    from app.services.hand_pipeline import purge_orphaned_hand_history

    db = _db()
    user, strategy = _seed(db)
    hand_db = HandDatabase(id=uuid4(), user_id=user.id, name="Career")
    db.add(hand_db)
    db.flush()
    session, _ = _session_with_hand(db, user, strategy, filename="keep.txt", eid="KEEP1")
    session.database_id = hand_db.id
    session.strategy_id = None
    for upload in session.uploads:
        upload.database_id = hand_db.id
        upload.strategy_id = None
    db.commit()

    removed = purge_orphaned_hand_history(db, user.id)
    db.commit()
    assert removed == 0
    assert db.get(PlaySession, session.id) is not None


def test_batch_keeps_multiple_sessions_active():
    db = _db()
    user, strategy = _seed(db)
    a, _ = _session_with_hand(db, user, strategy, filename="a.txt", eid="RC1")
    b, _ = _session_with_hand(db, user, strategy, filename="b.txt", eid="RC2")
    db.commit()
    hands = load_strategy_hands(db, user.id, strategy.id)
    assert {h.external_hand_id for h in hands} == {"RC1", "RC2"}
    assert {h.session_id for h in hands} == {a.id, b.id}
