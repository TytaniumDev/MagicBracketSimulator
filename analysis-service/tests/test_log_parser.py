"""Unit tests for the log condenser (log_parser)."""
from log_parser import condense


def test_condense_ignores_noise():
    raw = """
Turn 1: Player A
Player passes priority.
Untap step.
Draw step.
Turn 2: Player B
Player passes priority.
"""
    out = condense(raw)
    assert "kept_events" in out
    # No life change, cast, zone change, or win - so kept_events may be empty or minimal
    assert "turn_count" in out
    assert out["turn_count"] == 2


def test_condense_keeps_life_change():
    raw = """
Turn 1: Player A plays Mountain.
Life total changes: Player B 40 -> 38.
Turn 2: Player B plays Island.
Player loses 2 life.
"""
    out = condense(raw)
    assert any(
        e.get("type") == "life_change" for e in out["kept_events"]
    ), "Life change lines should be kept"


def test_condense_keeps_win_condition():
    raw = """
Turn 5: Player A attacks.
Player B loses the game.
Game Over. Player A wins the game.
"""
    out = condense(raw)
    assert any(
        e.get("type") == "win_condition" for e in out["kept_events"]
    ), "Win condition should be kept"


def test_condense_keeps_zone_change():
    raw = """
Turn 4: Player A casts Reanimate (CMC 1). Put target from graveyard onto battlefield.
Zone change: Graveyard -> Battlefield.
"""
    out = condense(raw)
    assert any(
        e.get("type") in ("zone_change_gy_to_bf", "spell_cast", "spell_cast_high_cmc")
        for e in out["kept_events"]
    ), "Relevant cast or zone change should be kept"


def test_condense_metrics_shape():
    raw = """
Turn 1: Player A plays Mountain. Tap Mountain for R. Adds 1 mana.
Turn 2: Player B plays Island. Draws a card.
Turn 3: Player A casts Sol Ring (CMC 2). Tap for 2 mana.
"""
    out = condense(raw)
    assert "mana_per_turn" in out
    assert "cards_drawn_per_turn" in out
    assert isinstance(out["mana_per_turn"], dict)
    assert isinstance(out["cards_drawn_per_turn"], dict)
    assert out["turn_count"] >= 1


def test_condense_empty_log():
    out = condense("")
    assert out["kept_events"] == []
    assert out["turn_count"] == 0
    assert out["mana_per_turn"] == {}
    assert out["cards_drawn_per_turn"] == {}
