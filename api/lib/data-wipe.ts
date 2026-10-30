/**
 * Admin data wipe: deletes every job (with its simulations and logs), the
 * records derived from jobs, and every user-imported deck, one bounded step
 * per call so no request runs long or holds much in memory.
 */
import { getDataWipeStore } from './data-wipe-store-factory';
import { LEFTOVER_KINDS, type WipeKind } from './data-wipe-store';
import { deleteJobCompletely } from './job-delete';

/** Jobs per step. Each costs about a hundred Firestore ops and a GCS prefix delete. */
const JOBS_PER_STEP = 10;
/** Leftover records per step. */
const LEFTOVERS_PER_STEP = 500;

export interface WipeStep {
  kind: WipeKind;
  deleted: number;
}

/**
 * Delete the next batch: jobs first, then each leftover kind in turn.
 * Returns null once nothing is left. Safe to stop and call again at any
 * point. Throws if a listed job can't be deleted, so it can't loop forever.
 */
export async function wipeNextStep(): Promise<WipeStep | null> {
  const store = getDataWipeStore();

  const jobIds = await store.listJobIds(JOBS_PER_STEP);
  if (jobIds.length > 0) {
    const deleted = await Promise.all(jobIds.map((id) => deleteJobCompletely(id)));
    const stuck = jobIds.filter((_, i) => !deleted[i]);
    if (stuck.length > 0) throw new Error(`Could not read jobs to delete: ${stuck.join(', ')}`);
    return { kind: 'jobs', deleted: jobIds.length };
  }

  for (const kind of LEFTOVER_KINDS) {
    const deleted = await store.deleteLeftovers(kind, LEFTOVERS_PER_STEP);
    if (deleted > 0) return { kind, deleted };
  }
  return null;
}
