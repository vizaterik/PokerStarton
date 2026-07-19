"""Deviation detection vs strategy chart mixes."""

from decimal import Decimal

_EPS = Decimal("0.005")


def pick_expected_action(raise_freq: Decimal, call_freq: Decimal, fold_freq: Decimal) -> str:
    freqs = {"raise": raise_freq, "call": call_freq, "fold": fold_freq}
    return max(freqs, key=freqs.get)


def is_in_play_range(
    raise_freq: Decimal,
    call_freq: Decimal,
    threshold: Decimal = _EPS,
) -> bool:
    """Hand is playable on the chart (any raise or call frequency)."""
    return raise_freq >= threshold or call_freq >= threshold


def is_deviation(
    actual_action: str,
    raise_freq: Decimal,
    call_freq: Decimal,
    fold_freq: Decimal,
    threshold: Decimal = _EPS,
) -> bool:
    """True when the played action is wrong vs the chart.

    Rule: if the chart has raise OR call for the hand, both raise and call
    are correct (e.g. chart 100% call, hero raises — not an error).
    Fold is only an error when the chart has no fold mix (must play).
    Playing (raise/call) a pure-fold hand is an error.
    """
    in_range = is_in_play_range(raise_freq, call_freq, threshold)

    if actual_action in ("raise", "call"):
        return not in_range

    if actual_action == "fold":
        # Folding is fine when fold is in the mix; error only if must always play
        return fold_freq < threshold

    return True
