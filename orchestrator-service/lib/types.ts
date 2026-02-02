export type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

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
  decks: DeckSlot[]; // Always length 4
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
