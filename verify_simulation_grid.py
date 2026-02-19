from playwright.sync_api import sync_playwright
import json
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Mock Job API
    job_data = {
        "id": "123",
        "name": "Test Job",
        "deckNames": ["Deck A", "Deck B"],
        "status": "COMPLETED",
        "simulations": 100,
        "createdAt": "2023-01-01T00:00:00Z",
        "gamesCompleted": 100,
        "workers": {"online": 1, "idle": 0, "busy": 1},
        "resultJson": {
            "results": [
                {"deck_name": "Deck A", "bracket": 1, "confidence": "High", "reasoning": "Good deck"},
                {"deck_name": "Deck B", "bracket": 2, "confidence": "Low", "reasoning": "Bad deck"}
            ]
        }
    }

    simulations_list = []
    for i in range(100):
        simulations_list.append({
            "index": i,
            "simId": f"sim-{i}",
            "state": "COMPLETED",
            "workerId": "worker-1",
            "workerName": "Worker 1",
            "durationMs": 1000,
            "winner": "Deck A" if i % 2 == 0 else "Deck B",
            "winningTurn": 5
        })

    simulations_data = {
        "simulations": simulations_list
    }

    color_identity_data = {
        "Deck A": ["W", "U"],
        "Deck B": ["R", "G"]
    }

    # Intercept requests
    # Note: frontend uses relative paths if on same origin, or absolute if configured.
    # We'll intercept glob patterns.

    page.route("**/api/jobs/123", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(job_data)
    ))

    # Mock simulations endpoint
    page.route("**/api/jobs/123/simulations", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(simulations_data)
    ))

    page.route("**/api/deck-color-identity*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(color_identity_data)
    ))

    # Mock logs
    page.route("**/api/jobs/123/logs/structured", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"games": [], "deckNames": ["Deck A", "Deck B"]})
    ))

    page.route("**/api/jobs/123/logs/analyze-payload", lambda route: route.fulfill(status=404))

    # Mock SSE to fail immediately? Or just ignore it.
    page.route("**/api/jobs/123/stream", lambda route: route.abort())

    print("Navigating to Job Status Page...")
    # Using the dev server URL
    page.goto("http://localhost:5173/jobs/123")

    print("Waiting for grid (can take > 5s due to fallback)...")
    # Wait for at least one completed simulation cell
    try:
        page.wait_for_selector(".bg-emerald-500", timeout=10000)
    except:
        print("Timeout waiting for selector. Taking screenshot anyway.")

    print("Taking screenshot...")
    page.screenshot(path="verification_simulation_grid.png", full_page=True)

    browser.close()

with sync_playwright() as p:
    run(p)
