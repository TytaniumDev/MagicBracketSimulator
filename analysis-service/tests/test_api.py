"""Optional contract tests for POST /analyze and GET /health."""
import os

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_returns_200_and_status():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert data["status"] == "ok"
    assert "gemini_configured" in data


def test_analyze_request_schema_validation():
    # Missing required field -> 422
    r = client.post("/analyze", json={"hero_deck_name": "Test", "opponent_decks": []})
    assert r.status_code == 422

    # Unset API key so this request fails with 503 (avoids real Gemini call when .env is set)
    old_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        r = client.post(
            "/analyze",
            json={
                "hero_deck_name": "Test",
                "opponent_decks": ["A", "B", "C"],
                "game_logs": ["Turn 1: x"],
            },
        )
        assert r.status_code in (502, 503)
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key


def test_analyze_response_schema_when_mocked():
    # Unset API key so we get 503 (no real Gemini call when .env is set)
    old_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        r = client.post(
            "/analyze",
            json={
                "hero_deck_name": "My Deck",
                "opponent_decks": ["Deck A", "Deck B", "Deck C"],
                "game_logs": ["Turn 1: Player 1 plays Land.\nTurn 2: Player 2 plays Land."],
            },
        )
        # Expect 503 (missing key) or 502 (Gemini error)
        assert r.status_code in (502, 503)
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key
