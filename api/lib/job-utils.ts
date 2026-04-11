import type { Job } from './types';

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
