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

// Result of running a process
export interface ProcessResult {
  exitCode: number;
  duration: number;
}
