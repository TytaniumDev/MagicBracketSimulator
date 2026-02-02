"""
Bracket Analysis Service API: POST /analyze uses Gemini to judge bracket (1-5) for all 4 decks.

The service now expects a slim payload with decklists and game outcomes for all 4 decks.
It returns bracket ratings for each deck.
"""
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load .env from the application directory so GEMINI_API_KEY etc. are set without extra terminal boilerplate
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from judge_agent import analyze as judge_analyze, build_prompt_for_preview

app = FastAPI(
    title="Bracket Analysis Service",
    description="Uses Gemini to judge power bracket (1-5) for all 4 decks from decklists and game outcomes.",
)


class DeckInfo(BaseModel):
    """Deck info with name and optional decklist."""
    name: str = Field(..., description="Deck name")
    decklist: str | None = Field(default=None, description="Deck list content (.dck format)")


class DeckOutcome(BaseModel):
    """Per-deck game outcome statistics."""
    wins: int = Field(..., description="Number of games won")
    winning_turns: list[int] = Field(default_factory=list, description="Turn numbers when this deck won")
    turns_lost_on: list[int] = Field(default_factory=list, description="Turn numbers when this deck lost")


class AnalyzeRequest(BaseModel):
    """New slim payload: all 4 decks with decklists and outcomes."""
    decks: list[DeckInfo] = Field(..., description="All 4 decks with names and decklists")
    total_games: int = Field(..., description="Total number of games played")
    outcomes: dict[str, DeckOutcome] = Field(..., description="Per-deck outcome statistics")


class DeckBracketResult(BaseModel):
    """Bracket result for a single deck."""
    deck_name: str = Field(..., description="Name of the deck")
    bracket: int = Field(..., ge=1, le=5, description="Power bracket 1-5")
    confidence: str = Field(..., description="High, Medium, or Low")
    reasoning: str = Field(..., description="Why this bracket")
    weaknesses: str = Field(default="", description="Deck weaknesses")


class AnalyzeResponse(BaseModel):
    """Bracket results for all 4 decks."""
    results: list[DeckBracketResult] = Field(..., description="Bracket results for each deck")


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Call the Judge (Gemini) to assign bracket ratings for all 4 decks.
    
    Accepts the new slim payload with decklists and game outcomes.
    Returns bracket ratings for each of the 4 decks.
    """
    # Convert request to dict format for judge_analyze
    decks_data = [{"name": d.name, "decklist": d.decklist} for d in request.decks]
    outcomes_data = {
        name: {
            "wins": o.wins,
            "winning_turns": o.winning_turns,
            "turns_lost_on": o.turns_lost_on,
        }
        for name, o in request.outcomes.items()
    }

    try:
        results = judge_analyze(
            decks=decks_data,
            total_games=request.total_games,
            outcomes=outcomes_data,
        )
    except ValueError as e:
        if "GEMINI_API_KEY" in str(e):
            raise HTTPException(
                status_code=503,
                detail="Analysis service is not configured (missing API key).",
            ) from e
        raise HTTPException(status_code=502, detail=f"Invalid analysis response: {e}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Analysis service error: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analysis service error: {e}") from e

    # Convert results to response format
    return AnalyzeResponse(
        results=[
            DeckBracketResult(
                deck_name=r["deck_name"],
                bracket=r["bracket"],
                confidence=r["confidence"],
                reasoning=r["reasoning"],
                weaknesses=r.get("weaknesses", ""),
            )
            for r in results
        ]
    )


class PromptPreviewResponse(BaseModel):
    """Exact prompts that would be sent to Gemini (for debugging/preview)."""
    system_prompt: str = Field(..., description="System instruction sent to Gemini")
    user_prompt: str = Field(..., description="User message content sent to Gemini")


@app.post("/analyze/preview", response_model=PromptPreviewResponse)
def analyze_preview(request: AnalyzeRequest) -> PromptPreviewResponse:
    """
    Build and return the exact prompts that would be sent to Gemini for this payload.
    Does not call Gemini. Use this to preview what the model will receive.
    """
    decks_data = [{"name": d.name, "decklist": d.decklist} for d in request.decks]
    outcomes_data = {
        name: {
            "wins": o.wins,
            "winning_turns": o.winning_turns,
            "turns_lost_on": o.turns_lost_on,
        }
        for name, o in request.outcomes.items()
    }
    result = build_prompt_for_preview(decks_data, request.total_games, outcomes_data)
    return PromptPreviewResponse(
        system_prompt=result["system_prompt"],
        user_prompt=result["user_prompt"],
    )


@app.get("/health")
def health() -> dict:
    """Health check for deployment."""
    return {"status": "ok", "gemini_configured": bool(os.environ.get("GEMINI_API_KEY"))}
