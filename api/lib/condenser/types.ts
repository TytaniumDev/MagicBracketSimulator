/**
 * =============================================================================
 * Forge Log Analyzer - Type Definitions
 * =============================================================================
 *
 * This file defines all TypeScript types used throughout the Log Analyzer service.
 * These types represent:
 *   - Raw game logs from Forge simulations
 *   - Condensed game summaries
 *   - Structured per-deck/turn data for frontend visualization
 *
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Event Types
// -----------------------------------------------------------------------------

/**
 * Categories of events we extract from Forge logs.
 * Each type represents a significant game action worth keeping for analysis.
 */
export type EventType =
  | 'life_change'           // Player life total changed (damage, life gain)
  | 'spell_cast'            // Any spell cast (tracked for activity)
  | 'spell_cast_high_cmc'   // High mana value spell (CMC >= 5) - indicates power level
  | 'land_played'           // Land was played (tracked for mana development)
  | 'zone_change_gy_to_bf'  // Graveyard to battlefield - reanimation, recursion
  | 'win_condition'         // Game ending event (player wins/loses)
  | 'commander_cast'        // Commander was cast (important for Commander format)
  | 'combat'                // Combat-related action
  | 'draw_extra';           // Extra card draw beyond normal draw step

/**
 * A single event extracted from the game log.
 * Contains the event type, raw line, and optional metadata.
 */
export interface GameEvent {
  /** The category of this event */
  type: EventType;
  /** The original log line (truncated to 200 chars for sanity) */
  line: string;
  /** Turn number when this event occurred (if determinable) */
  turn?: number;
  /** Which player performed this action (if determinable) */
  player?: string;
}

// -----------------------------------------------------------------------------
// Condensed Game Summary
// -----------------------------------------------------------------------------

/**
 * Mana information for a single turn.
 * Helps the AI understand ramp and mana development.
 */
export interface TurnManaInfo {
  /** Number of mana-producing events detected this turn */
  manaEvents: number;
}

/**
 * A condensed summary of a single game.
 *
 * Reduces a multi-KB raw log down to essential information:
 *   - Significant events (life changes, big spells, wins)
 *   - Pacing metrics (mana per turn, cards drawn per turn)
 *   - Game length (turn count)
 */
export interface CondensedGame {
  /** Significant events that passed our filters */
  keptEvents: GameEvent[];

  /** Mana production/usage per turn (key = turn number) */
  manaPerTurn: Record<number, TurnManaInfo>;

  /** Cards drawn per turn (key = turn number) */
  cardsDrawnPerTurn: Record<number, number>;

  /** Total number of turns in the game */
  turnCount: number;

  /** Who won the game (if determinable from logs) */
  winner?: string;

  /** What turn the game ended on (if determinable) */
  winningTurn?: number;
}

// -----------------------------------------------------------------------------
// Structured Game Data (for Frontend Visualization)
// -----------------------------------------------------------------------------

/**
 * A single action performed by a deck during a turn.
 */
export interface DeckAction {
  /** The raw log line */
  line: string;
  /** Classified event type (if it matched a pattern) */
  eventType?: EventType;
}

/**
 * All actions for a single deck during a single turn.
 */
export interface DeckTurnActions {
  /** The turn number */
  turnNumber: number;
  /** All actions this deck took during this turn */
  actions: DeckAction[];
}

/**
 * Complete action history for a single deck across all turns.
 */
export interface DeckHistory {
  /** The deck/player identifier (e.g., "Player A", "Hero", or deck name) */
  deckLabel: string;
  /** Actions organized by turn */
  turns: DeckTurnActions[];
}

/**
 * Structured representation of a game for frontend visualization.
 * Organizes the log by turn and by deck so the UI can show
 * "what each deck did on turn N" in a 4-column layout.
 */
export interface StructuredGame {
  /** Total turns in the game */
  totalTurns: number;

  /** All player/deck identifiers found in the log */
  players: string[];

  /**
   * Turn-by-turn breakdown.
   * Each entry is a turn with segments for each player who acted.
   */
  turns: {
    turnNumber: number;
    segments: {
      playerId: string;
      lines: string[];
    }[];
  }[];

  /** Per-deck history for the 4-deck visualization */
  decks: DeckHistory[];

  /**
   * Life totals per turn per player.
   * Key is game turn number, value is map of player name to life total at end of that turn.
   * Commander format starts at 40 life.
   */
  lifePerTurn?: Record<number, Record<string, number>>;

  /** Who won the game (if determinable from logs) */
  winner?: string;

  /** What turn (round) the game ended on (if determinable) */
  winningTurn?: number;
}

// -----------------------------------------------------------------------------
// API Request/Response Types
// -----------------------------------------------------------------------------

/**
 * Request body for ingesting raw logs.
 */
export interface IngestLogsRequest {
  /** Array of raw game log strings (one per game) */
  gameLogs: string[];
  /** Optional: deck names for labeling (all 4 decks) */
  deckNames?: string[];
  /** Optional: deck lists (.dck content) for all 4 decks, same order as deckNames */
  deckLists?: string[];
}

/**
 * Response for raw logs endpoint.
 */
export interface RawLogsResponse {
  /** The raw game logs as originally received */
  gameLogs: string[];
}

/**
 * Response for condensed logs endpoint.
 */
export interface CondensedLogsResponse {
  /** Condensed summary for each game */
  condensed: CondensedGame[];
}

/**
 * Response for structured logs endpoint.
 */
export interface StructuredLogsResponse {
  /** Structured data for each game */
  games: StructuredGame[];
  /** Deck names if provided during ingest */
  deckNames?: string[];
}

// -----------------------------------------------------------------------------
// Internal Storage Types
// -----------------------------------------------------------------------------

/**
 * Data stored for a job's logs.
 */
export interface StoredJobLogs {
  /** Raw game logs */
  gameLogs: string[];
  /** Deck names (all 4 decks) */
  deckNames?: string[];
  /** Deck lists (.dck content) for all 4 decks */
  deckLists?: string[];
  /** When the logs were ingested */
  ingestedAt: string;
  /** Pre-computed condensed logs (computed on first access or ingest) */
  condensed?: CondensedGame[];
  /** Pre-computed structured logs */
  structured?: StructuredGame[];
}
