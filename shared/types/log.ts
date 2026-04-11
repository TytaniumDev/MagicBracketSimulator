/**
 * Shared types for game log analysis data.
 *
 * These types represent the JSON shapes returned by the log endpoints
 * (/api/jobs/:id/logs/condensed, /api/jobs/:id/logs/structured) and
 * consumed by the frontend for visualization.
 */

// ---------------------------------------------------------------------------
// Event classification
// ---------------------------------------------------------------------------

export type EventType =
  | 'life_change'
  | 'spell_cast'
  | 'spell_cast_high_cmc'
  | 'land_played'
  | 'zone_change_gy_to_bf'
  | 'win_condition'
  | 'commander_cast'
  | 'combat'
  | 'draw_extra';

// ---------------------------------------------------------------------------
// Condensed game (for AI bracket analysis)
// ---------------------------------------------------------------------------

export interface GameEvent {
  type: EventType;
  line: string;
  turn?: number;
  player?: string;
}

export interface TurnManaInfo {
  manaEvents: number;
}

export interface DeckTurnInfo {
  turnsTaken: number;
  lastSegment: number;
}

export interface CondensedGame {
  keptEvents: GameEvent[];
  manaPerTurn: Record<number, TurnManaInfo>;
  cardsDrawnPerTurn: Record<number, number>;
  turnCount: number;
  winner?: string;
  winningTurn?: number;
  perDeckTurns?: Record<string, DeckTurnInfo>;
}

// ---------------------------------------------------------------------------
// Structured game (for frontend 4-deck visualization)
// ---------------------------------------------------------------------------

export interface DeckAction {
  line: string;
  eventType?: EventType;
}

export interface DeckTurnActions {
  turnNumber: number;
  actions: DeckAction[];
}

export interface DeckHistory {
  deckLabel: string;
  turns: DeckTurnActions[];
}

export interface StructuredGame {
  totalTurns: number;
  players: string[];
  turns: {
    turnNumber: number;
    segments: {
      playerId: string;
      lines: string[];
    }[];
  }[];
  decks: DeckHistory[];
  lifePerTurn?: Record<number, Record<string, number>>;
  perDeckTurns?: Record<string, DeckTurnInfo>;
  winner?: string;
  winningTurn?: number;
}
