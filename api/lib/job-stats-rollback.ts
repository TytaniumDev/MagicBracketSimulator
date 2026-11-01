/**
 * Take a deleted job back out of everything aggregation fed with it, so
 * deleting a run changes the standings it counted toward:
 *   - deck win stats and pair game counts (leaderboard, deck pages,
 *     auto-coverage), from its game index
 *   - deck card impact counters, from its card stats receipt
 *   - its pod run's standings and job list
 *
 * Each store records what it counted per job, so this is safe to run again
 * after a failure and takes back only what was added.
 */
import type { Job } from './types';
import { seatNames } from '@shared/types/job';
import { getPodRunStore } from './pod-run-store-factory';
import { getGameIndex } from './log-store';
import { removeJobFromRatings } from './trueskill-service';
import { removeJobFromCardStats } from './card-impact/service';

/** Run before the job's logs are deleted: its game index and receipt live with them. */
export async function removeJobFromStats(job: Job): Promise<void> {
  await (await getPodRunStore()).removeJob(job.id);

  // Ratings and card stats are only counted for a job with results.
  if (!job.results) return;
  const gameIndex = await getGameIndex(job.id, seatNames(job.seats));
  await Promise.all([
    gameIndex ? removeJobFromRatings(job.id, job.seats, gameIndex.games) : false,
    removeJobFromCardStats(job.id, job.seats),
  ]);
}
