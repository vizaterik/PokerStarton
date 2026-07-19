from app.services.session_meta import build_session_meta, detect_room


def test_detect_gg_room():
    text = "Poker Hand #RC123: Hold'em No Limit ($0.01/$0.02) - 2026/07/10 00:32:47\n"
    assert detect_room(text, "GG20260709-2014 - RushAndCash16816719 - 0.01 - 0.02 - 6max.txt") == "ggpoker"


def test_gg_filename_session_label():
    filename = "GG20260709-2014 - RushAndCash16816719 - 0.01 - 0.02 - 6max.txt"
    text = "Poker Hand #RC1: Hold'em No Limit ($0.01/$0.02) - 2026/07/09 20:14:00\n"
    meta = build_session_meta(filename, text, [])
    assert meta.room == "ggpoker"
    assert meta.table_name == "RushAndCash16816719"
    assert str(meta.small_blind) == "0.01"
    assert str(meta.big_blind) == "0.02"
    assert meta.max_seats == 6
    assert meta.started_at is not None
    assert meta.started_at.year == 2026
    assert "RushAndCash16816719" in meta.label
    assert "$0.01/$0.02" in meta.label
