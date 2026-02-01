# Forge Log Analyzer

A dedicated service for parsing, condensing, and structuring Forge game logs.

## Purpose

This service sits between the Orchestrator (which runs Forge simulations) and the Analysis Service (which uses AI to judge deck power level). Its responsibilities:

1. **Store** raw game logs from Forge simulations
2. **Condense** logs by filtering noise and extracting significant events
3. **Structure** logs by turn and deck for frontend visualization
4. **Forward** condensed logs to the Analysis Service for AI analysis

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (with hot reload)
npm run dev

# Or start production server
npm start
```

The service runs on port 3001 by default.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs/:jobId/logs` | Ingest raw logs for a job (pre-computes all data) |
| `GET` | `/jobs/:jobId/logs/raw` | Get raw logs |
| `GET` | `/jobs/:jobId/logs/condensed` | Get condensed logs (for AI) |
| `GET` | `/jobs/:jobId/logs/structured` | Get structured logs (for 4-deck view) |
| `GET` | `/jobs/:jobId/logs/analyze-payload` | Get pre-computed payload for Analysis Service |
| `POST` | `/jobs/:jobId/analyze` | Forward pre-computed payload to Analysis Service |
| `GET` | `/health` | Health check |

### Ingest Logs

```bash
POST /jobs/abc123/logs
Content-Type: application/json

{
  "gameLogs": ["Turn 1: Player A\n...", "Turn 1: Player A\n..."],
  "deckNames": ["Hero Deck", "Opponent 1", "Opponent 2", "Opponent 3"]
}
```

### Get Raw Logs

```bash
GET /jobs/abc123/logs/raw

Response:
{
  "gameLogs": ["Turn 1: Player A\n...", "..."]
}
```

### Get Condensed Logs

```bash
GET /jobs/abc123/logs/condensed

Response:
{
  "condensed": [
    {
      "keptEvents": [
        { "type": "spell_cast", "line": "Player A casts Sol Ring." },
        { "type": "life_change", "line": "Player B loses 5 life." }
      ],
      "manaPerTurn": { "1": { "manaEvents": 2 }, "2": { "manaEvents": 5 } },
      "cardsDrawnPerTurn": { "1": 0, "2": 1 },
      "turnCount": 7,
      "winner": "Player A",
      "winningTurn": 7
    }
  ]
}
```

### Get Structured Logs (for 4-deck visualization)

```bash
GET /jobs/abc123/logs/structured

Response:
{
  "games": [
    {
      "totalTurns": 7,
      "players": ["Player A", "Player B", "Player C", "Player D"],
      "turns": [
        {
          "turnNumber": 1,
          "segments": [
            { "playerId": "Player A", "lines": ["Player A plays Forest.", "..."] },
            { "playerId": "Player B", "lines": ["Player B plays Island.", "..."] }
          ]
        }
      ],
      "decks": [
        {
          "deckLabel": "Hero Deck",
          "turns": [
            { "turnNumber": 1, "actions": [{ "line": "...", "eventType": "spell_cast" }] }
          ]
        }
      ]
    }
  ],
  "deckNames": ["Hero Deck", "Opponent 1", "Opponent 2", "Opponent 3"]
}
```

### Get Analyze Payload

Returns the exact JSON payload that will be sent to Gemini. This is pre-computed during log ingest and can be inspected before triggering analysis.

```bash
GET /jobs/abc123/logs/analyze-payload

Response:
{
  "hero_deck_name": "Doran Big Butts",
  "opponent_decks": ["Opponent 1", "Opponent 2", "Opponent 3"],
  "condensed_logs": [
    {
      "kept_events": [...],
      "mana_per_turn": {...},
      "cards_drawn_per_turn": {...},
      "turn_count": 7,
      "winner": "Player A"
    }
  ]
}
```

### Run Analysis

Forwards the pre-computed payload to the Analysis Service (Gemini). No additional computation is performed.

```bash
POST /jobs/abc123/analyze
Content-Type: application/json

{}  # Body is optional - uses pre-computed payload

Response:
{
  "bracket": 3,
  "confidence": "High",
  "reasoning": "Consistently threatened lethal on turns 6-7...",
  "weaknesses": "Limited interaction for enchantments."
}
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `ANALYSIS_SERVICE_URL` | `http://localhost:8000` | Analysis Service URL |
| `DATA_DIR` | `./data` | Directory for storing logs |

## Storage Format

Logs are stored as raw text files for easy debugging of Forge and this app:

- `data/<jobId>/game_001.txt`, `game_002.txt`, … — one plain-text file per game
- `data/<jobId>/meta.json` — deck names, ingest timestamp, pre-computed condensed/structured/analyzePayload data

All processing (condensing, structuring, Analysis Service payload) is performed at ingest time, so subsequent reads and analysis requests use cached data only.

## Architecture

```
src/
├── server.ts          # Express HTTP server
├── store.ts           # File-based storage layer
├── types.ts           # TypeScript type definitions
└── condenser/         # Log condensing pipeline
    ├── index.ts       # Main entry point
    ├── patterns.ts    # Regex patterns with documentation
    ├── filter.ts      # Noise filtering
    ├── classify.ts    # Event classification
    ├── turns.ts       # Turn extraction & metrics
    └── structured.ts  # Per-deck/turn structuring
```

## Condensing Pipeline

The condensing pipeline transforms raw Forge logs into structured summaries:

1. **Filter**: Remove noise (priority passes, phase markers, empty lines)
2. **Classify**: Categorize significant lines (life changes, spells, wins)
3. **Extract Metrics**: Calculate mana/draw per turn
4. **Structure**: Organize by turn and deck

Each step is in its own file with detailed comments explaining the logic.

## Event Types

| Type | Description |
|------|-------------|
| `life_change` | Life total changed (damage, life gain) |
| `spell_cast` | Any spell cast |
| `spell_cast_high_cmc` | High mana value spell (CMC >= 5) |
| `zone_change_gy_to_bf` | Graveyard to battlefield (reanimation) |
| `win_condition` | Game ending event |
| `commander_cast` | Commander cast |
| `combat` | Combat-related action |
| `draw_extra` | Extra card draw |

## Development

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit
```
