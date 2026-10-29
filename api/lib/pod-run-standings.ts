/**
 * Which of a job's results count toward its pod run's standings.
 *
 * Each pod run keeps running per-deck totals (see addPodResults in
 * @shared/types/pod-run), copied up from each of its jobs once: when the
 * run is saved for jobs already finished, and by aggregation for the rest.
 */
import type { JobResults } from '@shared/types/job';
import type { PodSeat } from '@shared/types/pod-run';

export interface FinishedPod {
  seats: PodSeat[];
  results: JobResults;
}

interface PodJob {
  decks?: { name: string }[];
  deckIds?: string[];
  results?: JobResults | null;
}

/**
 * The job's seats and results, or null until it has results. Seats are
 * keyed by deck id, or by name for jobs without deck ids.
 */
export function finishedPod(job: PodJob): FinishedPod | null {
  const decks = job.decks ?? [];
  if (!job.results || job.results.gamesPlayed <= 0 || decks.length === 0) return null;
  const byId = job.deckIds?.length === decks.length;
  return {
    seats: decks.map((d, i) => ({ key: byId ? job.deckIds![i] : d.name, name: d.name })),
    results: job.results,
  };
}
