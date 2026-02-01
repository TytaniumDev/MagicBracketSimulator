# Bracket Analysis Service

The **Judge** service: takes raw Forge simulation output, condenses it, and uses Gemini to determine the Power Level Bracket (1–5) of a deck with explainable reasoning (why a deck is in a given bracket and what weaknesses it has).

See [PRD.md](PRD.md) for full specifications.

## Purpose

- **Context efficiency**: Condenses logs before sending to the LLM (no 10MB dumps).
- **Outcome focused**: Judged on results (turn won, resilience), not just card list.
- **Explainability**: Response includes `reasoning` and `weaknesses`.

## Setup

- **Python**: 3.11+
- **Install**: `uv sync` (or `pip install -e ".[dev]"` for tests). Uses the **google-genai** SDK (Gemini Developer API).
- **Config**: Put `GEMINI_API_KEY=your_key` in a `.env` file in this directory; the app loads it automatically (no terminal boilerplate). Optional: `GEMINI_MODEL` (default `gemini-3-flash-preview`; use e.g. `gemini-3-pro-preview` for Pro).

## Run

```bash
uv run uvicorn main:app --reload
```

## API

- **`POST /analyze`**  
  - **Request body**  
    - `hero_deck_name` (string): deck being judged  
    - `opponent_decks` (list of strings): opponent deck names (context)  
    - `game_logs` (list of strings): one raw log string per game  
  - **Response**  
    - `bracket` (int 1–5), `confidence`, `reasoning`, `weaknesses`

Example:

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "hero_deck_name": "Ashling, the Pilgrim",
    "opponent_decks": ["Urza, Lord High Artificer", "The Ur-Dragon", "Lathril, Blade of the Elves"],
    "game_logs": ["Turn 1: Player A plays Mountain...", "Turn 1: Player B plays Island..."]
  }'
```

- **`GET /health`**  
  Health check for deployment; reports `gemini_configured` (whether `GEMINI_API_KEY` is set).

## Where things live

- **Rubric**: [rubric.md](rubric.md) — bracket definitions (1–5) injected into the Judge prompt.
- **Condenser rules**: [log_parser.py](log_parser.py) — IGNORE/KEEP patterns and metrics (mana per turn, cards drawn per turn).
