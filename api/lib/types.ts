export type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

// -----------------------------------------------------------------------------
// Per-Simulation Tracking Types
// -----------------------------------------------------------------------------

/** Lifecycle state for an individual simulation within a job. */
export type SimulationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Status tracking for a single simulation within a job.
 * In GCP mode these live in a Firestore subcollection: jobs/{jobId}/simulations/{simId}.
 * In local mode they live in the `simulations` SQLite table.
 */
export interface SimulationStatus {
  /** Unique ID for this simulation within the job (e.g., "sim_001") */
  simId: string;
  /** 0-based index within the job */
  index: number;
  /** Current state */
  state: SimulationState;
  /** Which worker is running this simulation */
  workerId?: string;
  /** Human-readable worker name */
  workerName?: string;
  /** When the simulation started (ISO string) */
  startedAt?: string;
  /** When the simulation finished (ISO string) */
  completedAt?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Error message if FAILED */
  errorMessage?: string;
  /** Winner of this game (if completed) */
  winner?: string;
  /** Turn the game ended on */
  winningTurn?: number;
}

// -----------------------------------------------------------------------------
// Condenser Types (from forge-log-analyzer)
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
 * This is what gets sent to the AI for bracket analysis.
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

/**
 * Single deck's bracket result from AI analysis.
 */
export interface DeckBracketResult {
  deck_name: string;
  bracket: number;
  confidence: string;
  reasoning: string;
  weaknesses?: string;
}

/**
 * Analysis results for all 4 decks.
 */
export interface AnalysisResult {
  results: DeckBracketResult[];
}

export interface DeckSlot {
  name: string;
  dck: string;
}

export interface Job {
  id: string;
  decks: DeckSlot[]; // Always length 4 (for backward compat; may be empty when deckIds used)
  deckIds?: string[]; // Length 4 when set; worker uses cache + deck API when present
  status: JobStatus;
  resultJson?: AnalysisResult;
  simulations: number;
  parallelism?: number;
  createdAt: Date;
  errorMessage?: string;
  gamesCompleted?: number;
  startedAt?: Date;
  completedAt?: Date;
  dockerRunDurationsMs?: number[];
  workerId?: string;
  workerName?: string;
  claimedAt?: Date;
  retryCount?: number;
}

// -----------------------------------------------------------------------------
// Worker Fleet Types
// -----------------------------------------------------------------------------

export interface WorkerInfo {
  workerId: string;
  workerName: string;
  status: 'idle' | 'busy';
  currentJobId?: string;
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  lastHeartbeat: string; // ISO timestamp
  version?: string;
}

export interface CreateJobRequest {
  deckIds: string[]; // Length 4: each is a precon id or saved deck filename
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
}

export const SIMULATIONS_MIN = 1;
export const SIMULATIONS_MAX = 100;
export const PARALLELISM_MIN = 1;
export const PARALLELISM_MAX = 16;

export interface Precon {
  id: string;
  name: string;
  filename: string;
  primaryCommander: string;
}
