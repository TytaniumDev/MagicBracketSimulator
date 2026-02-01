# Product Requirement Document: Bracket Analysis Service

## 1. Overview
The **Bracket Analysis Service** is the "Judge". It takes the raw, verbose output from the Forge simulation and uses an LLM (Gemini) to determine the Power Level Bracket (1-5) of the user's deck based on performance metrics and heuristics.

## 2. Goals
-   **Context Efficiency**: Do not feed 10MB of text logs to an LLM. Condense first.
-   **Outcome Focused**: Judge based on *results* (Turn won, resilience), not just card list.
-   **Explainability**: Output must explain *why* a deck is Bracket 3 (e.g., "Consistent turn 5 win attempts").

## 3. Specifications

### 3.1 Tech Stack
-   **Language**: Python 3.11+
-   **Framework**: FastAPI (for the API)
-   **LLM Interface**: `google-generativeai` (Gemini SDK)

### 3.2 API Specifications
-   **Endpoint**: `POST /analyze`
-   **Request Body**:
    ```json
    {
      "hero_deck_name": "Ashling, the Pilgrim",
      "opponent_decks": ["Urza, Lord High Artificer", "The Ur-Dragon", "Lathril, Blade of the Elves"],
      "game_logs": [
        "Turn 1: Player A plays Mountain...",
        "Turn 1: Player B plays Island..."
      ]
    }
    ```
-   **Response Body**:
    ```json
    {
      "bracket": 3,
      "confidence": "High",
      "reasoning": "Consistently threatened lethal on turns 6-7. Recovered from wipe in Game 2.",
      "weaknesses": "No interaction for enchantments."
    }
    ```

### 3.3 Log Pre-processor (The "Condenser")
A Python module that parses raw Forge logs using Regex/String matching.
-   **Input**: Raw string log from the request.
-   **Output**: Condensed JSON summary for the LLM.
-   **Filtering Rules**:
    -   `IGNORE`: "Player passes priority", "Untap step", "Draw step" (unless extra cards drawn).
    -   `KEEP`: "Life total changes", "Spell Cast > CMC 4", "Zone Change (Graveyard -> Battlefield)", "Win Condition met".
-   **Metrics**: Calculate "Mana per turn", "Cards drawn per turn".

### 3.4 The Judge Agent (Gemini)
-   **Model**: Gemini 1.5 Flash (for speed/cost) or Pro (for reasoning).
-   **System Prompt**: "You are a Magic: The Gathering Commander Rules Committee Judge. Analyze this game summary..."
-   **Input**:
    -   User Decklist (Names only).
    -   Condensed Game Logs (from Pre-processor).
    -   Opponent Deck Names (Context).
    -   **Rubric**: Injected into the prompt from a local `rubric.md` file.
-   **Analysis Steps**:
    1.  **Speed**: Effective Turn count for win attempt.
    2.  **Reliability**: Variance between the 5 games.
    3.  **Interaction**: Did the deck stop opponents or just race?

## 4. Bracket Rubric (Official Beta Guidance)
-   **Bracket 1 (Exhibition)**: Turn 9+ wins. Prioritizes theme and flavor over power.
-   **Bracket 2 (Core)**: Turn 8+ wins. Unoptimized, straightforward, and social.
-   **Bracket 3 (Upgraded)**: Turn 6+ wins. Powered up with strong synergy and effective disruption.
-   **Bracket 4 (Optimized)**: Turn 4+ wins. Lethal, consistent, and fast; features high-efficiency disruption and tutors.
-   **Bracket 5 (cEDH)**: Any turn wins. Meticulously designed for the competitive metagame.

## 5. Work Plan
1.  **Setup**: Initialize FastAPI project with `uv` or `poetry`.
2.  **Log Parser**: Build `log_parser.py` with regex-based parsing to implementation "The Condenser". Unit test with example Forge logs.
3.  **Prompt Engineering**: Create `judge_agent.py` and `rubric.md`. Test prompts manually.
4.  **API Layer**: Implement `main.py` with the `/analyze` endpoint integrating the Parser and Agent.
