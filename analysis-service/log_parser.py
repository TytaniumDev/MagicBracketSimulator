"""
Log Pre-processor (Condenser): parses raw Forge game logs into a condensed JSON summary for the LLM.
"""
import re
from typing import Any


# Patterns to IGNORE (noise)
IGNORE_PATTERNS = [
    re.compile(r"player\s+passes\s+priority", re.IGNORECASE),
    re.compile(r"untap\s+step", re.IGNORECASE),
    re.compile(r"draw\s+step", re.IGNORECASE),
    re.compile(r"^Turn\s+\d+:\s*$", re.IGNORECASE),  # bare "Turn N:" with nothing else
]

# Draw step is KEEP when line indicates extra cards drawn (e.g. "draws 2 cards", "draw an additional")
EXTRA_DRAW_PATTERN = re.compile(
    r"draw(s)?\s+(an?\s+)?(additional|extra|\d+)\s+card|draw\s+\d+\s+card",
    re.IGNORECASE,
)

# Patterns to KEEP
LIFE_CHANGE = re.compile(
    r"life\s+(total\s+)?(change|loss|gain|to)|(\d+)\s+life|loses?\s+\d+\s+life|gains?\s+\d+\s+life",
    re.IGNORECASE,
)
SPELL_CAST_CMC = re.compile(
    r"casts?\s+.*\s+\(CMC\s*[5-9]|\d+\)|CMC\s*[5-9]|\d+|cast.*\s+\((\d{2,}|\s*[5-9]\s*)\)",
    re.IGNORECASE,
)
# Simpler: look for "cast" and a number >= 5 nearby, or "CMC 5", "CMC 6", etc.
SPELL_CAST_HIGH_CMC = re.compile(
    r"cast(s|ing)?\s+.*?(?:\(?\s*CMC\s*([5-9]|\d{2,})|\(([5-9]|\d{2,})\s*\))|CMC\s*([5-9]|\d{2,})",
    re.IGNORECASE,
)
ZONE_CHANGE = re.compile(
    r"graveyard\s*->\s*battlefield|graveyard\s+to\s+battlefield|put.*from.*graveyard.*onto.*battlefield",
    re.IGNORECASE,
)
WIN_CONDITION = re.compile(
    r"wins?\s+the\s+game|game\s+over|winner|wins\s+the\s+match",
    re.IGNORECASE,
)

# Turn extraction
TURN_LINE = re.compile(r"^Turn\s+(\d+)", re.IGNORECASE | re.MULTILINE)
# Mana produced/used (simple heuristics)
MANA_PRODUCED = re.compile(
    r"(?:adds?|produces?|tap(s|ped)?\s+for)\s+[\w\s]*mana|(\d+)\s+mana\s+produced",
    re.IGNORECASE,
)
# Cards drawn (per turn: "draws a card", "draws 2 cards")
DRAW_EVENT = re.compile(
    r"draws?\s+(?:a\s+)?card|draws?\s+(\d+)\s+cards?|draw\s+step.*draw",
    re.IGNORECASE,
)


def _should_ignore(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    for pat in IGNORE_PATTERNS:
        if pat.search(stripped):
            # Draw step: keep if extra cards drawn
            if "draw" in pat.pattern.lower() and EXTRA_DRAW_PATTERN.search(stripped):
                return False
            return True
    return False


def _classify_line(line: str) -> str | None:
    """Returns event type if line should be kept, else None."""
    if _should_ignore(line):
        return None
    if LIFE_CHANGE.search(line):
        return "life_change"
    if SPELL_CAST_HIGH_CMC.search(line) or re.search(r"cast.*\s+\((\d+)\)", line, re.I):
        # CMC in parens
        m = re.search(r"\((\d+)\)", line)
        if m and int(m.group(1)) >= 5:
            return "spell_cast_high_cmc"
        if SPELL_CAST_HIGH_CMC.search(line):
            return "spell_cast_high_cmc"
    if ZONE_CHANGE.search(line):
        return "zone_change_gy_to_bf"
    if WIN_CONDITION.search(line):
        return "win_condition"
    # Optional: keep "cast" lines for context even if CMC unknown
    if re.search(r"\bcasts?\s+", line, re.I):
        return "spell_cast"
    return None


def _turn_ranges(log: str) -> list[tuple[int, int]]:
    """Return list of (turn_number, start_offset) for each 'Turn N' in log."""
    return [(int(m.group(1)), m.start()) for m in TURN_LINE.finditer(log)]


def _mana_per_turn(log: str) -> dict[int, Any]:
    """Heuristic: count mana-related lines per turn. Returns dict turn_index -> info."""
    turn_ranges = _turn_ranges(log)
    if not turn_ranges:
        return {}
    result: dict[int, Any] = {}
    for i, (turn_num, start) in enumerate(turn_ranges):
        end = turn_ranges[i + 1][1] if i + 1 < len(turn_ranges) else len(log)
        chunk = log[start:end]
        count = len(MANA_PRODUCED.findall(chunk))
        # Also count "Tap ... for" style
        taps = len(re.findall(r"tap(s|ped)?\s+.*?\s+for", chunk, re.I))
        result[turn_num] = {"mana_events": count + taps}
    return result


def _cards_drawn_per_turn(log: str) -> dict[int, int]:
    """Count draw events per turn. Returns dict turn_number -> count."""
    turn_ranges = _turn_ranges(log)
    if not turn_ranges:
        return {}
    result: dict[int, int] = {}
    for i, (turn_num, start) in enumerate(turn_ranges):
        end = turn_ranges[i + 1][1] if i + 1 < len(turn_ranges) else len(log)
        chunk = log[start:end]
        # Regex has one group (\d+); findall returns list of group strings or full matches
        matches = re.findall(r"draws?\s+(\d+)\s+cards?", chunk, re.IGNORECASE)
        total = sum(int(m) for m in matches) if matches else 0
        # Single "draws a card" / "draw card" (no number)
        single_draws = len(re.findall(r"draws?\s+(?:a\s+)?card(?!s)", chunk, re.IGNORECASE))
        result[turn_num] = total + single_draws
    return result


def condense(raw_log: str) -> dict[str, Any]:
    """
    Parse raw Forge log and return a condensed JSON summary for the LLM.

    - Filtering: IGNORE priority pass, untap, draw step (unless extra draw); KEEP life change, spell CMC>4, zone change, win.
    - Metrics: mana per turn, cards drawn per turn.
    """
    kept_events: list[dict[str, Any]] = []
    for line in raw_log.splitlines():
        event_type = _classify_line(line)
        if event_type:
            kept_events.append({"type": event_type, "line": line.strip()[:200]})

    turn_ranges = _turn_ranges(raw_log)

    return {
        "kept_events": kept_events,
        "mana_per_turn": _mana_per_turn(raw_log),
        "cards_drawn_per_turn": _cards_drawn_per_turn(raw_log),
        "turn_count": max(turn_ranges, key=lambda t: t[0])[0] if turn_ranges else 0,
    }
