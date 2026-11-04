/**
 * Queue a pod run in one request: one job for every 4-deck pod of the
 * selected decks, then the run that ties them together.
 *
 * The browser used to create each pod with its own POST /api/jobs, one after
 * another, so a 35-pod run took 35 round trips plus a save. Here the decks
 * are read once and the pods are written a few at a time.
 */
import { podCombinations } from '@shared/types/pod-run';
import { resolveJobSeats } from './job-seats';
import { mapWithLimit } from './map-limit';
import { getPodRunStore } from './pod-run-store-factory';
import type { PodRun } from './pod-run-store';
import { queueJob } from './queue-job';

/**
 * Pods written at once. Each pod is a handful of Firestore round trips;
 * eight in flight keep a 210-pod run to seconds without crowding out the
 * API's other requests on its single instance.
 */
export const POD_QUEUE_CONCURRENCY = 8;

export interface QueuePodRunInput {
  deckIds: string[];
  simulations: number;
  createdBy: string;
  /**
   * The run's key. Each pod's job is keyed `${key}-pod${i}`, so a retry
   * after a partial failure reuses the pods already queued, and the run
   * itself is saved once.
   */
  idempotencyKey?: string;
}

export type QueuePodRunResult =
  | { ok: true; run: PodRun }
  | { ok: false; invalidDeckIds: string[] };

export async function queuePodRun(input: QueuePodRunInput): Promise<QueuePodRunResult> {
  const { deckIds, simulations, createdBy, idempotencyKey } = input;
  const { seats, errors } = await resolveJobSeats(deckIds);
  if (errors.length > 0) return { ok: false, invalidDeckIds: errors };

  const jobs = await mapWithLimit(podCombinations(seats), POD_QUEUE_CONCURRENCY, (pod, i) =>
    queueJob(pod, simulations, {
      createdBy,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}-pod${i}` : undefined,
    }),
  );

  const run = await (await getPodRunStore()).createPodRun({
    deckIds,
    deckNames: seats.map((s) => s.name),
    jobIds: jobs.map((j) => j.id),
    simulations,
    createdBy,
    idempotencyKey,
  });
  return { ok: true, run };
}
