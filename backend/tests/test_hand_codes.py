import pytest

from app.services.hand_codes import cards_to_hand_code, normalize_hand_code


def test_normalize_pair():
    assert normalize_hand_code("aa") == "AA"


def test_normalize_suited():
    assert normalize_hand_code("aks") == "AKs"
    assert normalize_hand_code("kas") == "AKs"


def test_normalize_offsuit():
    assert normalize_hand_code("ako") == "AKo"


def test_cards_to_code():
    assert cards_to_hand_code("Ah", "Kd") == "AKo"
    assert cards_to_hand_code("Ah", "As") == "AA"
    assert cards_to_hand_code("7c", "2c") == "72s"


def test_invalid_code():
    with pytest.raises(ValueError):
        normalize_hand_code("XX")
