export type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

export interface AnalysisResult {
  bracket: number;
  confidence: string;
  reasoning: string;
  weaknesses?: string;
}

export interface Job {
  id: string;
  deckName: string;
  deckDck: string;
  status: JobStatus;
  resultJson?: AnalysisResult;
  simulations: number;
  parallelism?: number;
  opponents: string[];
  createdAt: Date;
  errorMessage?: string;
  gamesCompleted?: number;
}

export interface CreateJobRequest {
  deckUrl?: string;
  deckText?: string;
  deckId?: string; // Saved deck filename (e.g., "doran-big-butts.dck")
  opponentMode: 'random' | 'specific';
  opponentIds?: string[];
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
}

export const SIMULATIONS_MIN = 1;
export const SIMULATIONS_MAX = 100;
export const PARALLELISM_MIN = 1;
export const PARALLELISM_MAX = 8;

export interface Precon {
  id: string;
  name: string;
  filename: string;
  primaryCommander: string;
}
