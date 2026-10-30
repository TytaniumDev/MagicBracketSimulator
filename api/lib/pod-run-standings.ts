/**
 * Which of a job's results count toward its pod run's standings.
 *
 * Each pod run keeps running per-deck totals (see addPodResults in
 * @shared/types/pod-run), copied up from each of its jobs once: when the
 * run is saved for jobs already finished, and by aggregation for the rest.
 */
import type { JobResults, JobSeat } from '@shared/types/job';

export interface FinishedPod {
  seats: JobSeat[];
  results: JobResults;
}

/** The job's seats and results, or null until it has results. */
export function finishedPod(job: { seats?: JobSeat[]; results?: JobResults | null }): FinishedPod | null {
  const seats = job.seats ?? [];
  if (!job.results || job.results.gamesPlayed <= 0 || seats.length === 0) return null;
  return { seats, results: job.results };
}
