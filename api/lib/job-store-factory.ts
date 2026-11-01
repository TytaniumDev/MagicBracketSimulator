/**
 * Job store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (job-store).
 */
import { Job, JobStatus, JobResults, JobSeat, SimulationStatus, SimulationState, WorkerInfo, JobSource } from './types';
import { isTerminalSimState } from '@shared/types/state-machine';
import * as firestoreStore from './firestore-job-store';
import * as workerStore from './worker-store-factory';
import { cancelRecoveryCheck } from './cloud-tasks';
import { isSimLeaseExpired, type ClaimOptions, type SimLeaseStatus } from './sim-lease';
import * as Sentry from '@sentry/nextjs';
import { createLogger } from './logger';
import type { GameCardSummary } from './card-impact/parse';
import { missingGames, reportedGameCount } from './job-utils';

import { USE_FIRESTORE, isGcpMode } from './env';

const log = createLogger('JobStore');
const recoveryLog = createLogger('Recovery');

// Lazy dynamic import of the SQLite-backed store. Using `await import()` (not
// `require()`) so webpack can statically analyze the dependency and emit it
// as a separate chunk that is only loaded when first accessed. This keeps
// better-sqlite3 and the full SQLite schema in db.ts out of the production
// container startup path entirely when running in GCP mode.
type SqliteJobStore = typeof import('./job-store');
let _sqliteStore: SqliteJobStore | null = null;
async function sqliteStore(): Promise<SqliteJobStore> {
  if (!_sqliteStore) {
    _sqliteStore = await import('./job-store');
  }
  return _sqliteStore;
}

// Log mode detection at startup
log.info('Running in mode', { mode: USE_FIRESTORE ? 'GCP' : 'LOCAL' });
if (USE_FIRESTORE) {
  log.info('Project', { project: process.env.GOOGLE_CLOUD_PROJECT });
  log.info('Using Firestore + Cloud Storage + Pub/Sub');
} else {
  log.info('Using SQLite + local filesystem');
}

export { isGcpMode };

export async function getJob(id: string): Promise<Job | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.getJob(id);
  }
  const job = (await sqliteStore()).getJob(id);
  return job ?? null;
}

export async function getJobByIdempotencyKey(key: string): Promise<Job | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.getJobByIdempotencyKey(key);
  }
  const job = (await sqliteStore()).getJobByIdempotencyKey(key);
  return job ?? null;
}

export async function createJob(
  seats: JobSeat[],
  simulations: number,
  options?: {
    idempotencyKey?: string;
    parallelism?: number;
    createdBy?: string;
    source?: JobSource;
  }
): Promise<Job> {
  if (USE_FIRESTORE) {
    return firestoreStore.createJob({
      seats,
      simulations,
      parallelism: options?.parallelism,
      idempotencyKey: options?.idempotencyKey,
      createdBy: options?.createdBy ?? 'unknown',
      source: options?.source,
    });
  }
  return (await sqliteStore()).createJob(
    seats,
    simulations,
    options?.idempotencyKey,
    options?.parallelism,
    options?.source
  );
}

export interface ListJobsOptions {
  userId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListJobsResult {
  jobs: Job[];
  nextCursor: string | null;
}

export async function listJobs(options: ListJobsOptions = {}): Promise<ListJobsResult> {
  if (USE_FIRESTORE) {
    return firestoreStore.listJobs(options);
  }
  const { userId: _userId, ...rest } = options;
  return (await sqliteStore()).listJobs(rest);
}

export async function listActiveJobs(): Promise<Job[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.listActiveJobs();
  }
  return (await sqliteStore()).listActiveJobs();
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.updateJobStatus(id, status);
    return;
  }
  (await sqliteStore()).updateJobStatus(id, status);
}

export async function setJobStartedAt(id: string, workerId?: string, workerName?: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobStartedAt(id, workerId, workerName);
    return;
  }
  (await sqliteStore()).setJobStartedAt(id, workerId, workerName);
}

export async function conditionalUpdateJobStatus(
  id: string,
  expectedStatuses: JobStatus[],
  newStatus: JobStatus,
  metadata?: { workerId?: string; workerName?: string }
): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.conditionalUpdateJobStatus(id, expectedStatuses, newStatus, metadata);
  }
  return (await sqliteStore()).conditionalUpdateJobStatus(id, expectedStatuses, newStatus, metadata);
}

export async function setNeedsAggregation(id: string, value: boolean): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setNeedsAggregation(id, value);
    return;
  }
  (await sqliteStore()).setNeedsAggregation(id, value);
}

export async function setJobCompleted(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobCompleted(id);
    return;
  }
  (await sqliteStore()).setJobCompleted(id);
}

export async function setJobFailed(id: string, errorMessage: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobFailed(id, errorMessage);
    return;
  }
  (await sqliteStore()).setJobFailed(id, errorMessage);
}

export async function setJobResults(jobId: string, results: JobResults): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobResults(jobId, results);
    return;
  }
  (await sqliteStore()).setJobResults(jobId, results);
}

export interface ClaimedSim {
  jobId: string;
  simId: string;
  simIndex: number;
}

/**
 * Atomically claim the next claimable simulation across all active jobs:
 * a PENDING sim, or a RUNNING one whose lease ran out. Flips the sim to
 * RUNNING with the caller's workerId (and a fresh lease when
 * `options.withLease`), and flips the job from QUEUED to RUNNING if this is
 * the first claim against it. Returns null when no work is available.
 */
export async function claimNextSim(
  workerId: string,
  workerName: string,
  options: ClaimOptions = {},
): Promise<ClaimedSim | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.claimNextSim(workerId, workerName, options);
  }
  return (await sqliteStore()).claimNextSim(workerId, workerName, options) ?? null;
}

/**
 * Extend the lease on a RUNNING sim held by `workerId`. See SimLeaseStatus
 * for what each result tells the worker.
 */
export async function extendSimLease(
  jobId: string,
  simId: string,
  workerId: string,
): Promise<SimLeaseStatus> {
  if (USE_FIRESTORE) {
    return firestoreStore.extendSimLease(jobId, simId, workerId);
  }
  return (await sqliteStore()).extendSimLease(jobId, simId, workerId);
}

export async function cancelJob(id: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.cancelJob(id);
  }
  return (await sqliteStore()).cancelJob(id);
}

export async function deleteJob(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteJob(id);
    return;
  }
  (await sqliteStore()).deleteJob(id);
}

// ─── Per-Simulation Tracking ─────────────────────────────────────────────────

export async function initializeSimulations(jobId: string, count: number): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.initializeSimulations(jobId, count);
    return;
  }
  (await sqliteStore()).initializeSimulations(jobId, count);
}

export async function updateSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.updateSimulationStatus(jobId, simId, update);
    return;
  }
  (await sqliteStore()).updateSimulationStatus(jobId, simId, update);
}

export async function getSimulationStatus(jobId: string, simId: string): Promise<SimulationStatus | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.getSimulationStatus(jobId, simId);
  }
  return (await sqliteStore()).getSimulationStatus(jobId, simId);
}

export async function getSimulationStatuses(jobId: string): Promise<SimulationStatus[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.getSimulationStatuses(jobId);
  }
  return (await sqliteStore()).getSimulationStatuses(jobId);
}

export async function listOrphanedLiveSims(): Promise<{ jobId: string; simId: string }[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.listOrphanedLiveSims();
  }
  return (await sqliteStore()).listOrphanedLiveSims();
}

export async function resetJobForRetry(id: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.resetJobForRetry(id);
  }
  return (await sqliteStore()).resetJobForRetry(id);
}

export async function deleteSimulations(jobId: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteSimulations(jobId);
    return;
  }
  (await sqliteStore()).deleteSimulations(jobId);
}

/**
 * Count one more finished sim and the [games] it reported, so job progress
 * shows games actually played. Returns the updated sim counter values.
 * GCP mode increments Firestore counters atomically; local mode recounts
 * from the simulation statuses.
 */
export async function incrementCompletedSimCount(
  jobId: string,
  games: number,
): Promise<{ completedSimCount: number; totalSimCount: number }> {
  if (USE_FIRESTORE) {
    return firestoreStore.incrementCompletedSimCount(jobId, games);
  }
  // Local mode fallback: count from simulation statuses
  const store = await sqliteStore();
  const sims = store.getSimulationStatuses(jobId);
  const completedSimCount = sims.filter(s => s.state === 'COMPLETED' || s.state === 'CANCELLED').length;
  const gamesCompleted = sims
    .filter(s => s.state === 'COMPLETED')
    .reduce((sum, s) => sum + reportedGameCount(s), 0);
  store.setGamesCompleted(jobId, gamesCompleted);
  return { completedSimCount, totalSimCount: sims.length };
}

// ─── Stale Job Recovery ──────────────────────────────────────────────────────

export async function conditionalUpdateSimulationStatus(
  jobId: string,
  simId: string,
  expectedStates: SimulationState[],
  update: Partial<SimulationStatus>
): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.conditionalUpdateSimulationStatus(jobId, simId, expectedStates, update);
  }
  return (await sqliteStore()).conditionalUpdateSimulationStatus(jobId, simId, expectedStates, update);
}

/**
 * Conditionally reset a simulation to PENDING AND clear the runtime fields
 * (workerId, workerName, startedAt, completedAt, durationMs, errorMessage)
 * in one atomic write. Used by the stale-recovery paths so a sim reclaimed
 * by the next poll starts from a clean slate — no leftover worker/timing
 * fields from the previous attempt.
 *
 * Returns true if the write applied (sim was in one of expectedStates).
 */
export async function conditionalResetSimulationToPending(
  jobId: string,
  simId: string,
  expectedStates: SimulationState[],
): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.conditionalResetSimulationToPending(jobId, simId, expectedStates);
  }
  return (await sqliteStore()).conditionalResetSimulationToPending(jobId, simId, expectedStates);
}

/**
 * Detect and recover a stale RUNNING job.
 *
 * QUEUED jobs need no recovery: the worker's polling loop picks them up on
 * the next /api/jobs/claim-sim call. If no worker is online, the job stays
 * QUEUED and the stale-sweeper eventually hard-fails it once it exceeds
 * QUEUED_JOB_HARD_FAIL_THRESHOLD_MS.
 *
 * RUNNING jobs use per-simulation recovery: each stuck or dead-worker sim is
 * individually reset to PENDING so another poll can reclaim it. FAILED sims
 * auto-retry the same way.
 *
 * Returns true if any recovery action was taken.
 */
export async function recoverStaleJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;

  if (job.status !== 'RUNNING') return false;

  const activeWorkers = await workerStore.getActiveWorkers(120_000);
  return recoverStaleSimulations(jobId, job, activeWorkers);
}

// ─── Per-Simulation Stale Detection ──────────────────────────────────────────

// Should exceed CONTAINER_TIMEOUT_MS (default 2h) to avoid false positives
const STALE_RUNNING_THRESHOLD_MS = parseInt(process.env.STALE_RUNNING_THRESHOLD_MS || '9000000', 10);  // Default: 2.5 hours

/**
 * Detect and recover individual stuck simulations within a RUNNING job.
 *
 * Handles three cases, all resolved by resetting the sim to PENDING so a
 * polling worker will claim it on its next call:
 * 1. RUNNING sims stuck >2.5 hrs  — container hung.
 * 2. RUNNING sims under a dead worker — crashed mid-sim. A sim with a lease
 *    is dead when the lease ran out; one without (older workers) when its
 *    worker stopped heartbeating.
 * 3. FAILED sims — auto-retry.
 *
 * Uses conditional writes so a worker completing a sim at the last moment
 * wins the race (the reset becomes a no-op).
 */
async function recoverStaleSimulations(
  jobId: string,
  job: Job,
  activeWorkers: WorkerInfo[],
): Promise<boolean> {
  if (!USE_FIRESTORE) {
    return recoverStaleSimulationsLocal(jobId, job, activeWorkers);
  }

  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return false;

  const now = Date.now();
  const activeWorkerIds = new Set(activeWorkers.map((w) => w.workerId));

  const recoveryFlags = await Promise.all(
    sims.map(async (sim) => {
      // Case 1: RUNNING sim stuck for >2.5 hours — container hung.
      if (sim.state === 'RUNNING' && sim.startedAt) {
        const runningForMs = now - new Date(sim.startedAt).getTime();
        if (runningForMs > STALE_RUNNING_THRESHOLD_MS) {
          const updated = await conditionalResetSimulationToPending(jobId, sim.simId, ['RUNNING']);
          if (updated) {
            recoveryLog.info('Sim RUNNING too long, reset to PENDING', { jobId, simId: sim.simId, runningMin: Math.round(runningForMs / 60000) });
          }
          return updated;
        }
      }

      // Case 2: RUNNING sim whose worker is dead.
      const workerDead = sim.leaseExpiresAt
        ? isSimLeaseExpired(sim, now)
        : sim.workerId != null && !activeWorkerIds.has(sim.workerId);
      if (sim.state === 'RUNNING' && workerDead) {
        const updated = await conditionalResetSimulationToPending(jobId, sim.simId, ['RUNNING']);
        if (updated) {
          recoveryLog.info('Sim worker is dead, reset to PENDING', { jobId, simId: sim.simId, deadWorker: sim.workerId });
        }
        return updated;
      }

      // Case 3: FAILED sim — retry if any worker is online to pick it up.
      if (sim.state === 'FAILED' && activeWorkers.length > 0) {
        const updated = await conditionalResetSimulationToPending(jobId, sim.simId, ['FAILED']);
        if (updated) {
          recoveryLog.info('Sim FAILED, reset to PENDING for retry', { jobId, simId: sim.simId });
        }
        return updated;
      }

      return false;
    })
  );

  const recovered = recoveryFlags.some(Boolean);

  // Only aggregate when all sims are terminal. FAILED sims above are reset
  // to PENDING and will be retried; they're not terminal here.
  if (!recovered) {
    const allDone = sims.every(
      (s) => s.state === 'COMPLETED' || s.state === 'CANCELLED'
    );
    if (allDone) {
      const needsRetrigger = job.status === 'RUNNING' || job.needsAggregation === true;
      if (needsRetrigger) {
        aggregateJobResults(jobId).catch((err) => {
          recoveryLog.error('Aggregation failed', { jobId, error: err instanceof Error ? err.message : String(err) });
          Sentry.captureException(err, { tags: { component: 'recovery-aggregation', jobId } });
        });
      }
    }
  }

  return recovered;
}

/**
 * LOCAL-mode recovery. Parallel to the GCP path above but reaches for
 * resetJobForRetry when the job itself needs to be flipped back to QUEUED
 * (e.g. so the UI reflects the reclaim state).
 *
 * Strategy:
 *   1. If the job is RUNNING but its worker is not in the active-workers
 *      list (and at least one other worker IS active), reset the job back
 *      to QUEUED and reset any RUNNING/FAILED sims to PENDING. The next
 *      worker poll to claimNextSim() picks up one of those PENDING sims
 *      and promotes the job back to RUNNING.
 *   2. If all sims are already terminal (COMPLETED/CANCELLED) but the job
 *      status is still RUNNING, trigger aggregation to finalize it — this
 *      matches the GCP path and is what the stale-sweeper relies on.
 *   3. If no active workers exist, do nothing — resetting would just thrash.
 */
async function recoverStaleSimulationsLocal(
  jobId: string,
  job: Job,
  activeWorkers: WorkerInfo[],
): Promise<boolean> {
  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return false;

  const allTerminal = sims.every(
    (s) => s.state === 'COMPLETED' || s.state === 'CANCELLED'
  );

  // Fast path: all sims terminal but job still RUNNING → aggregate to finalize.
  if (allTerminal) {
    const needsRetrigger = job.status === 'RUNNING' || job.needsAggregation === true;
    if (needsRetrigger) {
      recoveryLog.info('LOCAL: all sims terminal, retriggering aggregation', { jobId });
      // Awaited (not fire-and-forget) so the caller — typically the
      // stale-sweeper HTTP handler — doesn't return before the aggregation
      // finishes. On serverless runtimes (Cloud Run), unawaited background
      // work can be throttled or killed the moment the response is sent.
      try {
        await aggregateJobResults(jobId);
      } catch (err) {
        recoveryLog.error('LOCAL aggregation failed', { jobId, error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err, { tags: { component: 'recovery-aggregation-local', jobId } });
      }
      return true;
    }
    return false;
  }

  // Only attempt re-claim if there's another worker to take over.
  if (activeWorkers.length === 0) return false;

  const activeWorkerIds = new Set(activeWorkers.map((w) => w.workerId));
  const workerStillAlive = job.workerId != null && activeWorkerIds.has(job.workerId);
  if (workerStillAlive) return false;

  // Worker is dead. Reset in-flight sims so the re-claim has clean state.
  const resetResults = await Promise.all(
    sims.map(async (sim) => {
      if (sim.state !== 'RUNNING' && sim.state !== 'FAILED') return false;
      return conditionalUpdateSimulationStatus(
        jobId,
        sim.simId,
        [sim.state],
        { state: 'PENDING' }
      );
    })
  );
  const resetCount = resetResults.filter(Boolean).length;

  const jobReset = await resetJobForRetry(jobId);
  recoveryLog.info('LOCAL: reset stuck RUNNING job for re-claim', {
    jobId,
    deadWorkerId: job.workerId,
    resetSims: resetCount,
    jobReset,
  });

  return jobReset || resetCount > 0;
}

/**
 * Derive the overall job status from the aggregate simulation states.
 * Returns null if there are no simulations (legacy job without per-sim tracking).
 */
export function deriveJobStatus(simulations: SimulationStatus[]): JobStatus | null {
  if (simulations.length === 0) return null;

  const states = simulations.map((s) => s.state);
  // A sim is "done" if it's in a terminal state OR FAILED (which will be retried but counts as done for derivation)
  const isDone = (s: SimulationState) => isTerminalSimState(s) || s === 'FAILED';
  const allPending = states.every((s) => s === 'PENDING');
  const anyRunning = states.some((s) => s === 'RUNNING');
  const allDone = states.every(isDone);
  const allFailed = states.every((s) => s === 'FAILED');
  const allCancelled = states.every((s) => s === 'CANCELLED');
  const anyCancelled = states.some((s) => s === 'CANCELLED');

  if (allPending) return 'QUEUED';
  if (allCancelled) return 'CANCELLED';
  if (anyRunning || (!allDone && !allPending)) return 'RUNNING';
  if (allDone) {
    if (allFailed) return 'FAILED';
    if (anyCancelled && !states.some((s) => s === 'COMPLETED')) return 'CANCELLED';
    return 'COMPLETED';
  }

  return 'RUNNING';
}

/**
 * Aggregate results when all simulations are COMPLETED or CANCELLED.
 * FAILED sims are NOT considered terminal — they will be retried by the scanner.
 * Walks the incrementally uploaded raw logs once to build the game index,
 * results, rating counters and card counters,
 * and sets the job to COMPLETED or CANCELLED.
 */
/**
 * Report to Sentry when a job's logs hold fewer games than its completed
 * sims should have played (a worker running too few games per sim, or a
 * log that never reached storage). The job still aggregates what it has.
 */
function reportMissingGames(jobId: string, sims: SimulationStatus[], gamesFound: number): void {
  const completedSims = sims.filter((s) => s.state === 'COMPLETED').length;
  const missing = missingGames(completedSims, gamesFound);
  if (missing === 0) return;
  log.warn('Job logs are missing games', { jobId, completedSims, gamesFound, missing });
  Sentry.captureMessage('Job logs are missing games', {
    level: 'warning',
    tags: { component: 'aggregation-game-count', jobId },
    extra: { completedSims, gamesFound, missing },
  });
}

export async function aggregateJobResults(jobId: string): Promise<void> {
  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return;

  // Only aggregate when all sims are in terminal states (COMPLETED or CANCELLED).
  // FAILED sims will be retried by the stale job scanner.
  const allDone = sims.every(s => isTerminalSimState(s.state));
  if (!allDone) return;

  const job = await getJob(jobId);
  if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') return; // Already aggregated

  // Mark that aggregation is in progress — recovery can detect and retry if this crashes
  await setNeedsAggregation(jobId, true);

  // Walk the raw logs uploaded by workers once, a few files at a time: index
  // each game (where its log is, who won) and parse its card signals.
  const { buildGameIndex, saveGameIndex } = await import('./log-store');
  const { parseGameCards } = await import('./card-impact/parse');
  const deckNames = job.seats.map((s) => s.name);
  const deckIds = job.seats.map((s) => s.deckId);
  const cardGames: GameCardSummary[] = [];
  const gameIndex = await buildGameIndex(jobId, deckNames, (game) => cardGames.push(parseGameCards(game)));
  reportMissingGames(jobId, sims, gameIndex?.games.length ?? 0);

  if (gameIndex) {
    await saveGameIndex(jobId, gameIndex);

    const { computeJobResults } = await import('./job-results');
    const results = computeJobResults(gameIndex.games, deckNames);
    await setJobResults(jobId, results);

    // Copy the results up to the job's pod run, if it's in one. The store
    // re-reads the job, so a run saved since `job` was read still counts it.
    const { getPodRunStore } = await import('./pod-run-store-factory');
    (await getPodRunStore()).applyJob(jobId).catch((err) => {
      log.error('Pod run standings update failed (non-fatal)', { jobId, error: err instanceof Error ? err.message : String(err) });
      Sentry.captureException(err, { tags: { component: 'pod-run-standings', jobId } });
    });

    // Update per-deck win/game counters
    const { processJobForRatings } = await import('./trueskill-service');
    processJobForRatings(jobId, job.seats, gameIndex.games).catch((err) => {
      log.error('Rating stats update failed (non-fatal)', { jobId, error: err instanceof Error ? err.message : String(err) });
      Sentry.captureException(err, { tags: { component: 'rating-stats', jobId } });
    });

    // Update per-deck card impact counters from the card signals parsed above
    const { processJobsForCardStats } = await import('./card-impact/service');
    processJobsForCardStats([{ jobId, deckIds, deckNames, games: cardGames }]).catch((err) => {
      log.error('Card stats update failed (non-fatal)', { jobId, error: err instanceof Error ? err.message : String(err) });
      Sentry.captureException(err, { tags: { component: 'card-stats', jobId } });
    });
  }

  // Don't overwrite CANCELLED status — logs are ingested above, but status stays CANCELLED
  if (job.status === 'CANCELLED') {
    await setNeedsAggregation(jobId, false);
    return;
  }

  const allCancelled = sims.every(s => s.state === 'CANCELLED');
  if (allCancelled) {
    await setJobFailed(jobId, 'All simulations were cancelled (likely by stale-sweeper lifetime cap)');
    await setNeedsAggregation(jobId, false);
    cancelRecoveryCheck(jobId).catch(err => {
      log.warn('Cleanup fire-and-forget failed', { jobId, error: err instanceof Error ? err.message : err });
      Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId } });
    });
    return;
  }

  await setJobCompleted(jobId);

  // Clear the flag — aggregation completed successfully
  await setNeedsAggregation(jobId, false);

  // Cancel recovery task
  cancelRecoveryCheck(jobId).catch(err => {
    log.warn('Cleanup fire-and-forget failed', { jobId, error: err instanceof Error ? err.message : err });
    Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId } });
  });
}

