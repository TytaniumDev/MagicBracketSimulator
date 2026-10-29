/**
 * Pod run store interface — persists pod runs so they can be found again.
 * Implemented by pod-run-store-sqlite.ts (LOCAL) and pod-run-store-firestore.ts (GCP).
 *
 * A run keeps its standings: per-deck totals copied up from each job once
 * (see pod-run-standings.ts). Each job records the run it belongs to, so
 * aggregation can find it.
 */
import type { PodRunTotals } from '@shared/types/pod-run';

export interface PodRun {
  id: string;
  deckIds: string[];
  deckNames: string[];
  jobIds: string[];
  simulations: number;
  createdBy: string;
  createdAt: Date;
  idempotencyKey?: string;
  standings: PodRunTotals;
  /** Jobs whose results are in `standings`. */
  podsWithResults: number;
}

export type CreatePodRunData = Omit<PodRun, 'id' | 'createdAt' | 'standings' | 'podsWithResults'>;

export interface PodRunStore {
  /**
   * Save a pod run, record it on each of its jobs, and total the jobs that
   * already have results. A job already in another run stays in that one.
   * With an idempotency key that was already used, returns the run saved
   * under it instead of creating another.
   */
  createPodRun(data: CreatePodRunData): Promise<PodRun>;

  getPodRun(id: string): Promise<PodRun | null>;

  /** Most recent runs first. */
  listPodRuns(limit: number): Promise<PodRun[]>;

  /** Runs that include the given job, most recent first. */
  listPodRunsForJob(jobId: string): Promise<PodRun[]>;

  /**
   * Add a job's results to its run's standings. Returns false when the job
   * is in no run, has no results yet, or was already added.
   */
  applyJob(jobId: string): Promise<boolean>;
}
