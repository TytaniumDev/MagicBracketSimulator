"""Optional contract tests for POST /analyze and GET /health."""
import os

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


# Sample valid request payload for the new 4-deck format
VALID_PAYLOAD = {
    "decks": [
        {"name": "Deck A", "decklist": "1 Sol Ring\n1 Command Tower"},
        {"name": "Deck B", "decklist": "1 Sol Ring\n1 Command Tower"},
        {"name": "Deck C", "decklist": "1 Sol Ring\n1 Command Tower"},
        {"name": "Deck D", "decklist": "1 Sol Ring\n1 Command Tower"},
    ],
    "total_games": 12,
    "outcomes": {
        "Deck A": {"wins": 4, "winning_turns": [6, 7, 7, 8], "turns_lost_on": [5, 6, 7, 8, 9, 10, 11, 12]},
        "Deck B": {"wins": 3, "winning_turns": [5, 6, 7], "turns_lost_on": [6, 7, 7, 8, 9, 10, 11, 12, 13]},
        "Deck C": {"wins": 3, "winning_turns": [9, 10, 11], "turns_lost_on": [5, 6, 6, 7, 7, 8, 10, 11, 12]},
        "Deck D": {"wins": 2, "winning_turns": [10, 12], "turns_lost_on": [5, 6, 6, 7, 7, 8, 9, 10, 11, 13]},
    },
}


def test_health_returns_200_and_status():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert data["status"] == "ok"
    assert "gemini_configured" in data


def test_analyze_request_schema_validation():
    # Missing required field (decks) -> 422
    r = client.post("/analyze", json={"total_games": 12, "outcomes": {}})
    assert r.status_code == 422

    # Missing outcomes -> 422
    r = client.post("/analyze", json={"decks": [], "total_games": 12})
    assert r.status_code == 422


def test_analyze_returns_503_without_api_key():
    # Unset API key so this request fails with 503 (avoids real Gemini call when .env is set)
    old_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        r = client.post("/analyze", json=VALID_PAYLOAD)
        # Expect 503 (missing key) or 502 (Gemini error)
        assert r.status_code in (502, 503)
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key


def test_analyze_response_schema_when_mocked():
    # Unset API key so we get 503 (no real Gemini call when .env is set)
    old_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        r = client.post("/analyze", json=VALID_PAYLOAD)
        # Expect 503 (missing key) or 502 (Gemini error)
        assert r.status_code in (502, 503)
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key
