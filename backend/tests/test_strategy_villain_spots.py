"""Villain-specific charts: exact match preferred, generic fallback."""

from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.strategy import Strategy, StrategySpot
from app.models.user import User
from app.services.strategy_match import load_spot_maps, resolve_spot


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
    strategy = Strategy(id=uuid4(), user_id=user.id, name="S", is_default=False)
    db.add_all([user, strategy])
    db.flush()
    return user, strategy


def test_resolve_prefers_villain_specific():
    db = _db()
    _, strategy = _seed(db)
    generic = StrategySpot(
        id=uuid4(),
        strategy_id=strategy.id,
        spot_key="vs_open",
        hero_position="BB",
        villain_position=None,
        label="vs Open · BB",
        sort_order=0,
    )
    vs_btn = StrategySpot(
        id=uuid4(),
        strategy_id=strategy.id,
        spot_key="vs_open",
        hero_position="BB",
        villain_position="BTN",
        label="vs Open · BB vs BTN",
        sort_order=1,
    )
    db.add_all([generic, vs_btn])
    db.commit()

    spot_by_key, _ = load_spot_maps(db, strategy.id)
    assert resolve_spot(spot_by_key, "vs_open", "BB", "BTN").id == vs_btn.id
    assert resolve_spot(spot_by_key, "vs_open", "BB", "CO").id == generic.id
    assert resolve_spot(spot_by_key, "vs_open", "BB", None).id == generic.id


def test_resolve_without_generic_returns_none_for_other_villain():
    db = _db()
    _, strategy = _seed(db)
    vs_btn = StrategySpot(
        id=uuid4(),
        strategy_id=strategy.id,
        spot_key="vs_open",
        hero_position="BB",
        villain_position="BTN",
        label="vs Open · BB vs BTN",
        sort_order=0,
    )
    db.add(vs_btn)
    db.commit()
    spot_by_key, _ = load_spot_maps(db, strategy.id)
    assert resolve_spot(spot_by_key, "vs_open", "BB", "BTN").id == vs_btn.id
    assert resolve_spot(spot_by_key, "vs_open", "BB", "CO") is None
