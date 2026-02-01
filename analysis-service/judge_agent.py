"""
Judge Agent: uses Gemini (google-genai SDK) to assign a power bracket (1-5) from condensed game logs and rubric.
"""
import json
import os
from pathlib import Path

from google import genai
from google.genai import types

# Model: Gemini 3 Flash by default; override with GEMINI_MODEL (e.g. gemini-3-pro-preview) for Pro.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
RUBRIC_PATH = Path(__file__).resolve().parent / "rubric.md"

SYSTEM_PROMPT = """You are a Magic: The Gathering Commander Rules Committee Judge. Analyze the provided game summary and assign a power bracket (1-5) with clear reasoning. Use only the rubric provided. Consider:
1. Speed: Effective turn count for win attempt.
2. Reliability: Variance between games.
3. Interaction: Did the deck stop opponents or just race?

Respond with a single JSON object only, no markdown or extra text, with these exact keys:
- "bracket": integer 1-5
- "confidence": "High" or "Medium" or "Low"
- "reasoning": string explaining why this bracket
- "weaknesses": string describing deck weaknesses (e.g. "No interaction for enchantments.")
"""


def _load_rubric() -> str:
    if not RUBRIC_PATH.exists():
        return ""
    return RUBRIC_PATH.read_text(encoding="utf-8")


def _build_user_prompt(
    hero_deck_name: str,
    opponent_decks: list[str],
    condensed_logs: list[dict],
    rubric_text: str,
) -> str:
    parts = [
        "## Rubric\n",
        rubric_text or "(No rubric file found.)",
        "\n\n## Hero deck (to be judged)\n",
        hero_deck_name,
        "\n\n## Opponent decks (context)\n",
        ", ".join(opponent_decks),
        "\n\n## Condensed game logs (one per game)\n",
        json.dumps(condensed_logs, indent=2),
        "\n\nAssign a bracket (1-5) and respond with JSON only.",
    ]
    return "".join(parts)


def analyze(
    hero_deck_name: str,
    opponent_decks: list[str],
    condensed_logs: list[dict],
) -> dict:
    """
    Call Gemini to judge the deck. Returns dict with bracket, confidence, reasoning, weaknesses.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")

    rubric_text = _load_rubric()
    user_prompt = _build_user_prompt(
        hero_deck_name, opponent_decks, condensed_logs, rubric_text
    )

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

    result = json.loads(text)
    for key in ("bracket", "confidence", "reasoning", "weaknesses"):
        if key not in result:
            raise ValueError(f"Gemini response missing key: {key}")
    result["bracket"] = int(result["bracket"])
    if result["bracket"] not in range(1, 6):
        raise ValueError(f"Invalid bracket: {result['bracket']}")
    return result
