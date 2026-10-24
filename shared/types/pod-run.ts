// ---------------------------------------------------------------------------
// Pod run — one selection of more than 4 decks, queued as every 4-deck pod.
// GET /api/pod-runs, GET /api/pod-runs/:id
// ---------------------------------------------------------------------------

/** Most decks a single pod run may include. C(10, 4) = 210 pods. */
export const MAX_POD_RUN_DECKS = 10;

export interface PodRunSummary {
  id: string;
  /** Every deck in the run, in the order they were selected. */
  deckNames: string[];
  /** Number of pods (jobs) queued for the run. */
  podCount: number;
  /** Games per pod. */
  simulations: number;
  createdAt: string;
}

export interface PodRunResponse extends PodRunSummary {
  deckIds: string[];
  /** One job per pod, in the order they were queued. */
  jobIds: string[];
}
