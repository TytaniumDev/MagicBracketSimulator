/**
 * Delete a job and everything stored under it. Shared by the job delete
 * routes and the admin data wipe.
 */
import * as Sentry from '@sentry/nextjs';
import * as jobStore from './job-store-factory';
import { deleteLogs } from './log-store';
import { removeJobFromStats } from './job-stats-rollback';

export interface DeleteJobOptions {
  /**
   * Take the job's results back out of deck stats and pod run standings
   * first (default). The data wipe skips it, since it deletes those too.
   */
  rollBackStats?: boolean;
}

/**
 * Cancel the job if it is still active (so its worker stops), take its
 * results back out of the stats they fed, then delete its simulations, the
 * job itself and its logs. Returns false if the job doesn't exist. A failed
 * stats rollback throws before anything is deleted, so the delete can be
 * retried; a failed log delete is reported but doesn't fail the call, since
 * the job is already gone by then.
 */
export async function deleteJobCompletely(
  id: string,
  { rollBackStats = true }: DeleteJobOptions = {},
): Promise<boolean> {
  const job = await jobStore.getJob(id);
  if (!job) return false;

  if (job.status === 'QUEUED' || job.status === 'RUNNING') {
    await jobStore.cancelJob(id);
  }

  if (rollBackStats) await removeJobFromStats(job);

  // Delete simulations first: Firestore doesn't cascade subcollections.
  await jobStore.deleteSimulations(id);
  await jobStore.deleteJob(id);

  try {
    await deleteLogs(id);
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'job-delete-logs', jobId: id } });
    console.warn(`Failed to delete logs for job ${id}:`, err);
  }
  return true;
}
