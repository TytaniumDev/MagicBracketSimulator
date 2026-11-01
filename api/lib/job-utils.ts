import { GAMES_PER_CONTAINER, type Job } from './types';

/**
 * Detect whether a RUNNING job is stuck: all sims are done but
 * Firestore status was never flipped to COMPLETED (aggregation failed),
 * or the needsAggregation flag is still set (aggregation crashed mid-flight).
 */
export function isJobStuck(job: Pick<Job, 'status' | 'completedSimCount' | 'totalSimCount' | 'needsAggregation'>): boolean {
  if (job.needsAggregation) return true;
  return (
    job.status === 'RUNNING' &&
    job.completedSimCount != null &&
    job.totalSimCount != null &&
    job.completedSimCount >= job.totalSimCount &&
    job.totalSimCount > 0
  );
}

/**
 * Games a finished sim reports: one per winner it names. A game that ended
 * without a winner (a draw or Forge's per-game time limit) isn't counted
 * here; aggregation sets the job's final count from the logs.
 */
export function reportedGameCount(report: { winner?: string; winners?: string[] }): number {
  if (report.winners) return report.winners.length;
  return report.winner ? 1 : 0;
}

/**
 * How many games a job's logs are short of what its completed sims should
 * have played. Non-zero means a worker played fewer games per sim than the
 * API planned, or a sim's log never made it to storage.
 */
export function missingGames(completedSims: number, gamesFound: number): number {
  return Math.max(0, completedSims * GAMES_PER_CONTAINER - gamesFound);
}
