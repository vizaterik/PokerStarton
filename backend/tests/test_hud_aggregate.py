"""Incremental HUD aggregates: UPSERT after session parse + fast report."""

from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.hand import Hand, HandAction, HandUpload, PlaySession
from app.models.hand_database import HandDatabase
from app.models.player_stats import HudAggregationCredit, PlayerStatsAggregated
from app.models.user import User
from app.services.hud_aggregate import (
    apply_session_to_aggregates,
    build_aggregated_hud_report,
)


def _db() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _user_db(db: Session):
    user = User(
        id=uuid4(),
        email=f"{uuid4().hex}@t.test",
        password_hash="x",
        display_name=f"u{uuid4().hex[:8]}",
        email_verified=True,
    )
    hand_db = HandDatabase(id=uuid4(), user_id=user.id, name="Main")
    db.add_all([user, hand_db])
    db.flush()
    user.active_database_id = hand_db.id
    db.flush()
    return user, hand_db


def _hand_with_action(
    db: Session,
    session: PlaySession,
    *,
    eid: str,
    position: str,
    action: str = "raise",
):
    upload = HandUpload(
        id=uuid4(),
        user_id=session.user_id,
        database_id=session.database_id,
        session_id=session.id,
        room="ggpoker",
        original_filename="t.txt",
        status="parsed",
        hands_count=1,
    )
    db.add(upload)
    db.flush()
    hand = Hand(
        id=uuid4(),
        upload_id=upload.id,
        session_id=session.id,
        external_hand_id=eid,
        hero_position=position,
        hero_name="Hero",
        raw_text="*** HOLE CARDS ***\n",
        played_at=datetime(2026, 7, 18, 12, 0, 0),
    )
    db.add(hand)
    db.flush()
    db.add(
        HandAction(
            id=uuid4(),
            hand_id=hand.id,
            street="preflop",
            action_order=0,
            player_name="Hero",
            is_hero=True,
            action=action,
            amount=Decimal("0.05") if action == "raise" else None,
        )
    )
    db.flush()
    return hand


def test_apply_session_increments_and_is_idempotent():
    db = _db()
    user, hand_db = _user_db(db)
    session = PlaySession(
        id=uuid4(),
        user_id=user.id,
        database_id=hand_db.id,
        room="ggpoker",
        label="RushAndCash",
        source_filename="GG20260718-RushAndCash.txt",
        hands_count=2,
        status="active",
        started_at=datetime(2026, 7, 18, 12, 0, 0),
    )
    db.add(session)
    db.flush()
    _hand_with_action(db, session, eid="H1", position="BTN", action="raise")
    _hand_with_action(db, session, eid="H2", position="BTN", action="fold")
    db.commit()

    assert apply_session_to_aggregates(db, session) is True
    db.commit()
    assert apply_session_to_aggregates(db, session) is False

    all_row = db.scalar(
        select(PlayerStatsAggregated).where(
            PlayerStatsAggregated.user_id == user.id,
            PlayerStatsAggregated.position == "ALL",
        )
    )
    assert all_row is not None
    assert all_row.hands_count == 2
    assert all_row.vpip_opportunities == 2
    assert all_row.vpip_cases == 1
    assert all_row.pfr_cases == 1
    assert all_row.game_type == "cash"

    report = build_aggregated_hud_report(db, user.id, database_id=hand_db.id)
    assert report.hands == 2
    vpip = next(s for s in report.stats if s.key == "vpip")
    assert vpip.cases == 1
    assert vpip.opportunities == 2
    assert vpip.value == 50.0


def test_second_session_adds_not_overwrites():
    db = _db()
    user, hand_db = _user_db(db)

    def make_session(eid: str) -> PlaySession:
        session = PlaySession(
            id=uuid4(),
            user_id=user.id,
            database_id=hand_db.id,
            room="ggpoker",
            label="cash",
            source_filename="x.txt",
            hands_count=1,
            status="active",
        )
        db.add(session)
        db.flush()
        _hand_with_action(db, session, eid=eid, position="BB", action="raise")
        return session

    s1 = make_session("A")
    s2 = make_session("B")
    db.commit()
    apply_session_to_aggregates(db, s1)
    apply_session_to_aggregates(db, s2)
    db.commit()

    all_row = db.scalar(
        select(PlayerStatsAggregated).where(
            PlayerStatsAggregated.position == "ALL",
            PlayerStatsAggregated.user_id == user.id,
        )
    )
    assert all_row is not None
    assert all_row.hands_count == 2
    assert all_row.vpip_cases == 2
    assert db.get(HudAggregationCredit, s1.id) is not None
    assert db.get(HudAggregationCredit, s2.id) is not None
