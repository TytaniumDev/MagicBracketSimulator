"""
Bracket Analysis Service API: POST /analyze uses Gemini to judge bracket (1-5).

The service now expects pre-condensed logs from the Log Analyzer service.
For backward compatibility, it also supports raw game_logs (will condense them).
"""
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load .env from the application directory so GEMINI_API_KEY etc. are set without extra terminal boilerplate
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from judge_agent import analyze as judge_analyze
from log_parser import condense

app = FastAPI(
    title="Bracket Analysis Service",
    description="Uses Gemini to judge deck power bracket (1-5) from condensed game logs.",
)


class AnalyzeRequest(BaseModel):
    hero_deck_name: str = Field(..., description="Name of the deck being judged")
    opponent_decks: list[str] = Field(..., description="Names of opponent decks (context)")
    # Primary: Accept pre-condensed logs from the Log Analyzer
    condensed_logs: list[dict[str, Any]] | None = Field(
        default=None,
        description="Pre-condensed game logs (from Log Analyzer). Preferred input."
    )
    # Backward compatibility: Accept raw logs and condense them here
    game_logs: list[str] | None = Field(
        default=None,
        description="Raw log strings (deprecated - use condensed_logs instead)"
    )


class AnalyzeResponse(BaseModel):
    bracket: int = Field(..., ge=1, le=5, description="Power bracket 1-5")
    confidence: str = Field(..., description="High, Medium, or Low")
    reasoning: str = Field(..., description="Why this bracket")
    weaknesses: str = Field(..., description="Deck weaknesses")


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Call the Judge (Gemini) to assign bracket with reasoning.
    
    Accepts either:
    - condensed_logs: Pre-condensed logs from the Log Analyzer (preferred)
    - game_logs: Raw logs that will be condensed here (backward compatibility)
    """
    # Determine which input to use
    if request.condensed_logs is not None:
        # Use pre-condensed logs directly (new flow via Log Analyzer)
        condensed = request.condensed_logs
    elif request.game_logs is not None:
        # Backward compatibility: condense raw logs here
        try:
            condensed = [condense(log) for log in request.game_logs]
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail="Log condensation failed. Please check game_logs format.",
            ) from e
    else:
        raise HTTPException(
            status_code=400,
            detail="Either condensed_logs or game_logs must be provided.",
        )

    try:
        result = judge_analyze(
            hero_deck_name=request.hero_deck_name,
            opponent_decks=request.opponent_decks,
            condensed_logs=condensed,
        )
    except ValueError as e:
        if "GEMINI_API_KEY" in str(e):
            raise HTTPException(
                status_code=503,
                detail="Analysis service is not configured (missing API key).",
            ) from e
        raise HTTPException(status_code=502, detail="Invalid analysis response.") from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail="Analysis service error.") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail="Analysis service error.") from e

    return AnalyzeResponse(
        bracket=result["bracket"],
        confidence=result["confidence"],
        reasoning=result["reasoning"],
        weaknesses=result["weaknesses"],
    )


@app.get("/health")
def health() -> dict:
    """Health check for deployment."""
    return {"status": "ok", "gemini_configured": bool(os.environ.get("GEMINI_API_KEY"))}
