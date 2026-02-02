"""
Judge Agent: uses Gemini (google-genai SDK) to assign power brackets (1-5) for all 4 decks.

Takes decklists and game outcomes, returns bracket ratings for each deck.
"""
import json
import os
from pathlib import Path

from google import genai
from google.genai import types

# Model: Gemini 3 Flash by default; override with GEMINI_MODEL (e.g. gemini-3-pro-preview) for Pro.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
RUBRIC_PATH = Path(__file__).resolve().parent / "rubric.md"

SYSTEM_PROMPT = """You are a Magic: The Gathering Commander Rules Committee Judge. 

Analyze the provided decklists and game outcomes for ALL 4 DECKS and assign a power bracket (1-5) to EACH deck.

Use the rubric provided to determine brackets based on:
1. **Speed**: The turn numbers when each deck wins. Earlier wins = higher bracket.
2. **Consistency**: Win rate and variance in winning turns.
3. **Card Quality**: Game Changers, tutors, fast mana, and power cards in the decklist.

The Commander Brackets system uses these turn expectations:
- Bracket 1 (Exhibition): Expect to play 9+ turns before win/loss
- Bracket 2 (Core): Expect to play 8+ turns before win/loss  
- Bracket 3 (Upgraded): Expect to play 6+ turns before win/loss
- Bracket 4 (Optimized): Expect to play 4+ turns before win/loss
- Bracket 5 (cEDH): Game could end on any turn

Respond with a JSON object containing a "results" array with EXACTLY 4 entries (one per deck), each with:
- "deck_name": string (must match the deck name provided)
- "bracket": integer 1-5
- "confidence": "High" or "Medium" or "Low"
- "reasoning": string explaining why this bracket based on wins, turn speed, and decklist
- "weaknesses": string describing deck weaknesses

Example response format:
{
  "results": [
    {"deck_name": "Deck A", "bracket": 3, "confidence": "High", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck B", "bracket": 2, "confidence": "Medium", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck C", "bracket": 3, "confidence": "High", "reasoning": "...", "weaknesses": "..."},
    {"deck_name": "Deck D", "bracket": 4, "confidence": "Low", "reasoning": "...", "weaknesses": "..."}
  ]
}

Respond with JSON only, no markdown or extra text.
"""


def _load_rubric() -> str:
    if not RUBRIC_PATH.exists():
        return ""
    return RUBRIC_PATH.read_text(encoding="utf-8")


def build_prompt_for_preview(
    decks: list[dict],
    total_games: int,
    outcomes: dict[str, dict],
) -> dict:
    """
    Build the exact system and user prompts that would be sent to Gemini.
    Returns {"system_prompt": str, "user_prompt": str} for preview/debugging.
    """
    rubric_text = _load_rubric()
    user_prompt = _build_user_prompt(decks, total_games, outcomes, rubric_text)
    return {
        "system_prompt": SYSTEM_PROMPT,
        "user_prompt": user_prompt,
    }


def _build_user_prompt(
    decks: list[dict],
    total_games: int,
    outcomes: dict[str, dict],
    rubric_text: str,
) -> str:
    """Build the user prompt with all 4 decklists and their outcomes."""
    parts = [
        "## Bracket Rubric\n\n",
        rubric_text or "(No rubric file found.)",
        f"\n\n## Game Summary\n\nTotal games played: {total_games}\n\n",
    ]

    # Add each deck's info
    for i, deck in enumerate(decks):
        deck_name = deck.get("name", f"Deck {i+1}")
        decklist = deck.get("decklist", "(No decklist provided)")
        outcome = outcomes.get(deck_name, {"wins": 0, "winning_turns": [], "turns_lost_on": []})
        
        wins = outcome.get("wins", 0)
        winning_turns = outcome.get("winning_turns", [])
        turns_lost_on = outcome.get("turns_lost_on", [])
        
        parts.append(f"### Deck {i+1}: {deck_name}\n\n")
        parts.append(f"**Performance:**\n")
        parts.append(f"- Wins: {wins} / {total_games}\n")
        if winning_turns:
            avg_win_turn = sum(winning_turns) / len(winning_turns)
            parts.append(f"- Winning turns: {winning_turns} (avg: {avg_win_turn:.1f})\n")
        else:
            parts.append(f"- Winning turns: none\n")
        if turns_lost_on:
            avg_loss_turn = sum(turns_lost_on) / len(turns_lost_on)
            parts.append(f"- Turns lost on: {turns_lost_on} (avg: {avg_loss_turn:.1f})\n")
        
        parts.append(f"\n**Decklist:**\n```\n{decklist}\n```\n\n")

    parts.append("\nAssign a bracket (1-5) to EACH of the 4 decks and respond with JSON only.")
    
    return "".join(parts)


def analyze(
    decks: list[dict],
    total_games: int,
    outcomes: dict[str, dict],
) -> list[dict]:
    """
    Call Gemini to judge all 4 decks. Returns list of dicts, each with:
    deck_name, bracket, confidence, reasoning, weaknesses.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")

    rubric_text = _load_rubric()
    user_prompt = _build_user_prompt(decks, total_games, outcomes, rubric_text)

    with genai.Client(api_key=api_key) as client:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
            ),
        )

    if not response.text:
        raise RuntimeError("Gemini returned empty response")

    text = response.text.strip()
    # Allow for markdown code fence
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    parsed = json.loads(text)
    
    # Handle both formats: {"results": [...]} or just [...]
    if isinstance(parsed, dict) and "results" in parsed:
        results = parsed["results"]
    elif isinstance(parsed, list):
        results = parsed
    else:
        raise ValueError(f"Unexpected response format: {type(parsed)}")
    
    if not isinstance(results, list):
        raise ValueError(f"Expected results to be a list, got {type(results)}")
    
    # Validate each result
    validated_results = []
    for r in results:
        for key in ("deck_name", "bracket", "confidence", "reasoning"):
            if key not in r:
                raise ValueError(f"Gemini result missing key: {key}")
        
        bracket = int(r["bracket"])
        if bracket not in range(1, 6):
            raise ValueError(f"Invalid bracket: {bracket}")
        
        validated_results.append({
            "deck_name": r["deck_name"],
            "bracket": bracket,
            "confidence": r["confidence"],
            "reasoning": r["reasoning"],
            "weaknesses": r.get("weaknesses", ""),
        })
    
    return validated_results
