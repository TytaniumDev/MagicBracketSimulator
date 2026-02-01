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
  opponents: string[];
  createdAt: Date;
  errorMessage?: string;
}

export interface CreateJobRequest {
  deckUrl?: string;
  deckText?: string;
  opponentMode: 'random' | 'specific';
  opponentIds?: string[];
  simulations: number;
  idempotencyKey?: string;
}

export interface Precon {
  id: string;
  name: string;
  filename: string;
  primaryCommander: string;
}
