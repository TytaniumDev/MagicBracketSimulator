/**
 * Types for the unified worker - ported from misc-runner/types/types.go
 */

// Event types for classifying game log events
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

// A single event from the game log
export interface GameEvent {
  type: EventType;
  line: string;
  turn?: number;
  player?: string;
}

// Mana information for a turn
export interface TurnManaInfo {
  manaEvents: number;
}

// Summary of a single game for AI analysis
export interface CondensedGame {
  keptEvents: GameEvent[];
  manaPerTurn: Record<number, TurnManaInfo>;
  cardsDrawnPerTurn: Record<number, number>;
  turnCount: number;
  winner?: string;
  winningTurn?: number;
}

// Deck information for analysis
export interface DeckInfo {
  name: string;
  decklist?: string;
}

// Per-deck game outcome statistics
export interface DeckOutcome {
  wins: number;
  winning_turns: number[];
  turns_lost_on: number[];
}

// Payload sent to Gemini for analysis
export interface AnalyzePayload {
  decks: DeckInfo[];
  total_games: number;
  outcomes: Record<string, DeckOutcome>;
}

// Job data from API
export interface JobData {
  id: string;
  decks?: DeckSlot[]; // Always length 4 with full .dck content
  deckNames?: string[];
  simulations: number;
  parallelism: number;
  status: string;
}

// A deck slot in a job
export interface DeckSlot {
  name: string;
  dck: string;
}

// Pub/Sub message for job creation (legacy, kept for backward compat)
export interface JobCreatedMessage {
  jobId: string;
  createdAt: string;
}

// Pub/Sub message for individual simulation tasks
export interface SimulationTaskMessage {
  type: 'simulation';
  jobId: string;
  simId: string;       // e.g. "sim_007"
  simIndex: number;    // 0-based
  totalSims: number;
}

// Result of running a process
export interface ProcessResult {
  exitCode: number;
  duration: number;
}
