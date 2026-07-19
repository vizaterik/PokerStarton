"""Bankroll updates from uploaded sessions without double-counting hands."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.bankroll import BankrollEntry, BankrollSettings
from app.models.hand import Hand, HandUpload, PlaySession
from app.models.user import User
from app.services.bankroll import apply_session_to_bankroll, get_or_create_settings


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


def _session_with_hands(
    db: Session,
    user: User,
    *,
    label: str,
    hands: list[tuple[str, str]],
) -> PlaySession:
    """hands: list of (external_id, raw_text stub with known net via stored hero_net)."""
    session = PlaySession(
        id=uuid4(),
        user_id=user.id,
        room="ggpoker",
        label=label,
        source_filename=f"{label}.txt",
        hands_count=len(hands),
        status="active",
    )
    upload = HandUpload(
        id=uuid4(),
        user_id=user.id,
        session_id=session.id,
        room="ggpoker",
        original_filename=f"{label}.txt",
        status="analyzed",
        hands_count=len(hands),
    )
    db.add_all([session, upload])
    db.flush()
    for eid, net in hands:
        db.add(
            Hand(
                id=uuid4(),
                upload_id=upload.id,
                session_id=session.id,
                external_hand_id=eid,
                hero_net=Decimal(net),
                hero_net_bb=Decimal(net),
                raw_text="",  # force resolve_hand_result to use stored hero_net
            )
        )
    db.flush()
    return session


def test_apply_session_updates_balance_and_history():
    db = _db()
    user = _user(db)
    get_or_create_settings(db, user.id)
    settings = db.get(BankrollSettings, user.id)
    assert settings is not None
    settings.balance = Decimal("100.00")
    db.commit()

    sess = _session_with_hands(
        db, user, label="NL50 table", hands=[("H1", "5.50"), ("H2", "-2.00")]
    )
    entry = apply_session_to_bankroll(db, user.id, sess.id)
    assert entry is not None
    assert entry.kind == "session"
    assert entry.amount == Decimal("3.50")
    assert entry.balance_after == Decimal("103.50")
    assert "Сессия" in (entry.note or "")
    assert "+3.50" in (entry.note or "")

    db.refresh(settings)
    assert settings.balance == Decimal("103.50")


def test_same_session_not_applied_twice():
    db = _db()
    user = _user(db)
    get_or_create_settings(db, user.id)
    sess = _session_with_hands(db, user, label="A", hands=[("H1", "10")])
    first = apply_session_to_bankroll(db, user.id, sess.id)
    second = apply_session_to_bankroll(db, user.id, sess.id)
    assert first is not None
    assert second is not None
    assert first.id == second.id
    n = db.scalar(
        select(func.count())
        .select_from(BankrollEntry)
        .where(BankrollEntry.user_id == user.id, BankrollEntry.kind == "session")
    )
    assert n == 1


def test_reupload_same_hands_does_not_double_count():
    db = _db()
    user = _user(db)
    get_or_create_settings(db, user.id)
    settings = db.get(BankrollSettings, user.id)
    assert settings is not None
    settings.balance = Decimal("50")
    db.commit()

    old = _session_with_hands(db, user, label="old", hands=[("H1", "8"), ("H2", "-3")])
    apply_session_to_bankroll(db, user.id, old.id)
    db.refresh(settings)
    assert settings.balance == Decimal("55")

    # Re-upload creates a new session row with the same hand IDs.
    fresh = _session_with_hands(db, user, label="fresh", hands=[("H1", "8"), ("H2", "-3")])
    skipped = apply_session_to_bankroll(db, user.id, fresh.id)
    assert skipped is None
    db.refresh(settings)
    assert settings.balance == Decimal("55")


def test_partial_overlap_only_counts_new_hands():
    db = _db()
    user = _user(db)
    get_or_create_settings(db, user.id)
    settings = db.get(BankrollSettings, user.id)
    assert settings is not None
    settings.balance = Decimal("0")
    db.commit()

    a = _session_with_hands(db, user, label="a", hands=[("H1", "10")])
    apply_session_to_bankroll(db, user.id, a.id)

    b = _session_with_hands(db, user, label="b", hands=[("H1", "10"), ("H2", "4")])
    entry = apply_session_to_bankroll(db, user.id, b.id)
    assert entry is not None
    assert entry.amount == Decimal("4.00")
    db.refresh(settings)
    assert settings.balance == Decimal("14.00")
