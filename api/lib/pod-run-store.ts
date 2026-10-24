/**
 * Pod run store interface — persists pod runs so they can be found again.
 * Implemented by pod-run-store-sqlite.ts (LOCAL) and pod-run-store-firestore.ts (GCP).
 */

export interface PodRun {
  id: string;
  deckIds: string[];
  deckNames: string[];
  jobIds: string[];
  simulations: number;
  createdBy: string;
  createdAt: Date;
  idempotencyKey?: string;
}

export type CreatePodRunData = Omit<PodRun, 'id' | 'createdAt'>;

export interface PodRunStore {
  /**
   * Save a pod run. With an idempotency key that was already used, returns
   * the run saved under it instead of creating another.
   */
  createPodRun(data: CreatePodRunData): Promise<PodRun>;

  getPodRun(id: string): Promise<PodRun | null>;

  /** Most recent runs first. */
  listPodRuns(limit: number): Promise<PodRun[]>;

  /** Runs that include the given job, most recent first. */
  listPodRunsForJob(jobId: string): Promise<PodRun[]>;
}
