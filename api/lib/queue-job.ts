/**
 * Queue a user's job: write it with its pending sims and schedule its
 * recovery check. Shared by POST /api/jobs (one pod) and pod runs (many).
 */
import * as jobStore from './job-store-factory';
import { isGcpMode } from './job-store-factory';
import { scheduleRecoveryCheck } from './cloud-tasks';
import { GAMES_PER_CONTAINER, type Job, type JobSeat } from './types';
import * as Sentry from '@sentry/nextjs';

export interface QueueJobOptions {
  createdBy: string;
  idempotencyKey?: string;
  parallelism?: number;
}

/**
 * Queue a job for `seats`. With an idempotency key that was already used,
 * returns that job as it is: its sims are only written when it has none
 * (the earlier request died between writing the job and its sims), so a
 * retry never resets sims that workers already claimed.
 */
export async function queueJob(seats: JobSeat[], simulations: number, options: QueueJobOptions): Promise<Job> {
  if (options.idempotencyKey) {
    const existing = await jobStore.getJobByIdempotencyKey(options.idempotencyKey);
    if (existing) {
      const sims = await jobStore.getSimulationStatuses(existing.id);
      if (sims.length === 0) await initializeJob(existing);
      return existing;
    }
  }

  const job = await jobStore.createJob(seats, simulations, {
    idempotencyKey: options.idempotencyKey,
    parallelism: options.parallelism,
    createdBy: options.createdBy,
  });
  await initializeJob(job);
  return job;
}

async function initializeJob(job: Job): Promise<void> {
  // Each sim plays GAMES_PER_CONTAINER games. Workers discover the sims
  // through their GET /api/jobs/claim-sim polling; no queue publish needed.
  await jobStore.initializeSimulations(job.id, Math.ceil(job.simulations / GAMES_PER_CONTAINER));

  if (isGcpMode()) {
    // A recovery check at T+10min as defense-in-depth; the stale sweeper
    // covers the same ground on its own schedule.
    scheduleRecoveryCheck(job.id, 600).catch((err) => {
      console.warn('[Recovery] Failed to schedule check:', err instanceof Error ? err.message : err);
      Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId: job.id } });
    });
  }
}
