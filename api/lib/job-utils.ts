import type { Job } from './types';

/**
 * Detect whether a RUNNING job is stuck: all sims are done but
 * Firestore status was never flipped to COMPLETED (aggregation failed).
 */
export function isJobStuck(job: Pick<Job, 'status' | 'completedSimCount' | 'totalSimCount'>): boolean {
  return (
    job.status === 'RUNNING' &&
    job.completedSimCount != null &&
    job.totalSimCount != null &&
    job.completedSimCount >= job.totalSimCount &&
    job.totalSimCount > 0
  );
}
