"""Deviation / mix matching."""

from decimal import Decimal
from uuid import uuid4

from app.services.deviation import is_deviation, pick_expected_action
from app.services.strategy_match import resolve_cell_freqs
from app.models.strategy import StrategySpot


def test_raise_when_chart_is_call_is_ok():
    """AQs call on chart, hero raises — not an error."""
    assert not is_deviation("raise", Decimal("0"), Decimal("1"), Decimal("0"))
    assert not is_deviation("call", Decimal("0"), Decimal("1"), Decimal("0"))


def test_call_when_chart_is_raise_is_ok():
    assert not is_deviation("call", Decimal("1"), Decimal("0"), Decimal("0"))
    assert not is_deviation("raise", Decimal("1"), Decimal("0"), Decimal("0"))


def test_raise_mix_is_not_deviation():
    assert not is_deviation("raise", Decimal("0.20"), Decimal("0"), Decimal("0.80"))
    assert not is_deviation("fold", Decimal("0.20"), Decimal("0"), Decimal("0.80"))


def test_play_pure_fold_is_deviation():
    assert is_deviation("raise", Decimal("0"), Decimal("0"), Decimal("1"))
    assert is_deviation("call", Decimal("0"), Decimal("0"), Decimal("1"))
    assert not is_deviation("fold", Decimal("0"), Decimal("0"), Decimal("1"))


def test_fold_pure_raise_is_deviation():
    assert is_deviation("fold", Decimal("1"), Decimal("0"), Decimal("0"))


def test_empty_iso_does_not_use_rfi_parent():
    """Constructor has no painted iso — hand is not scored against rfi."""
    sid = uuid4()
    iso = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="iso",
        hero_position="BTN",
        villain_position=None,
        sort_order=0,
    )
    rfi = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="rfi",
        hero_position="BTN",
        villain_position=None,
        sort_order=1,
    )
    spot_by_key = {
        ("iso", "BTN", None): iso,
        ("rfi", "BTN", None): rfi,
    }

    class Cell:
        def __init__(self, r, c, f):
            self.raise_freq = r
            self.call_freq = c
            self.fold_freq = f

    cell_by_key = {(rfi.id, "AKs"): Cell(Decimal("1"), Decimal("0"), Decimal("0"))}
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key="iso",
        hero_position="BTN",
        villain_position=None,
        hand_code="AKs",
    )
    assert resolved is None


def test_painted_miss_is_fold_not_parent():
    sid = uuid4()
    iso = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="iso",
        hero_position="BTN",
        villain_position=None,
        sort_order=0,
    )
    rfi = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="rfi",
        hero_position="BTN",
        villain_position=None,
        sort_order=1,
    )
    spot_by_key = {
        ("iso", "BTN", None): iso,
        ("rfi", "BTN", None): rfi,
    }

    class Cell:
        def __init__(self, r, c, f):
            self.raise_freq = r
            self.call_freq = c
            self.fold_freq = f

    cell_by_key = {
        (iso.id, "AA"): Cell(Decimal("1"), Decimal("0"), Decimal("0")),
        (rfi.id, "AKs"): Cell(Decimal("1"), Decimal("0"), Decimal("0")),
    }
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key="iso",
        hero_position="BTN",
        villain_position=None,
        hand_code="AKs",
    )
    assert resolved is not None
    spot, r, c, f = resolved
    assert spot.id == iso.id
    assert is_deviation("raise", r, c, f)


def test_pick_expected_raise():
    assert pick_expected_action(Decimal("1"), Decimal("0"), Decimal("0")) == "raise"


def test_fold_only_iso_is_not_scored():
    """Unpainted/all-fold iso is skipped — no silent score against rfi."""
    sid = uuid4()
    iso = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="iso",
        hero_position="MP",
        villain_position=None,
        sort_order=0,
    )
    rfi = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="rfi",
        hero_position="MP",
        villain_position=None,
        sort_order=1,
    )
    spot_by_key = {
        ("iso", "MP", None): iso,
        ("rfi", "MP", None): rfi,
    }

    class Cell:
        def __init__(self, r, c, f):
            self.raise_freq = r
            self.call_freq = c
            self.fold_freq = f

    cell_by_key = {
        (iso.id, "AA"): Cell(Decimal("0"), Decimal("0"), Decimal("1")),
        (rfi.id, "AKs"): Cell(Decimal("1"), Decimal("0"), Decimal("0")),
    }
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key="iso",
        hero_position="MP",
        villain_position=None,
        hand_code="AKs",
    )
    assert resolved is None


def test_hj_aliases_to_mp_chart():
    sid = uuid4()
    rfi = StrategySpot(
        id=uuid4(),
        strategy_id=sid,
        spot_key="rfi",
        hero_position="MP",
        villain_position=None,
        sort_order=0,
    )
    spot_by_key = {("rfi", "MP", None): rfi}

    class Cell:
        def __init__(self, r, c, f):
            self.raise_freq = r
            self.call_freq = c
            self.fold_freq = f

    cell_by_key = {(rfi.id, "AQs"): Cell(Decimal("0"), Decimal("1"), Decimal("0"))}
    resolved = resolve_cell_freqs(
        spot_by_key,
        cell_by_key,
        spot_key="rfi",
        hero_position="HJ",
        villain_position=None,
        hand_code="AQs",
    )
    assert resolved is not None
    assert resolved[0].id == rfi.id
    assert not is_deviation("raise", resolved[1], resolved[2], resolved[3])
