/**
 * Stale job sweeper — eventually resolves stuck jobs by hard-cancelling any
 * simulation that has exceeded an absolute lifetime cap (default 2 hours).
 *
 * The sweeper is invoked by Cloud Scheduler via POST /api/admin/sweep-stale-jobs
 * and is safe to run repeatedly: it uses conditional writes so a worker
 * completing a sim at the last second always wins over a sweeper cancel.
 *
 * In both local (SQLite) and GCP (Firestore) modes, it:
 *   1. Hard-fails any QUEUED job older than QUEUED_JOB_HARD_FAIL_THRESHOLD_MS.
 *   2. For each RUNNING job, cancels any sim where (now - job baseline) exceeds
 *      SIM_HARD_CANCEL_THRESHOLD_MS.
 *   3. Calls the existing recoverStaleJob() path to republish stale-PENDING
 *      sims and re-trigger aggregation where applicable.
 *   4. Explicitly triggers aggregation when the job is in a state where
 *      recoverStaleJob's built-in re-trigger does not fire (local mode).
 */
import * as Sentry from '@sentry/nextjs';
import type { Job, SimulationStatus } from './types';
import * as jobStore from './job-store-factory';

export const SIM_HARD_CANCEL_THRESHOLD_MS = parseInt(
  process.env.SIM_HARD_CANCEL_THRESHOLD_MS ?? '7200000',
  10
); // 2 hours

export const QUEUED_JOB_HARD_FAIL_THRESHOLD_MS = parseInt(
  process.env.QUEUED_JOB_HARD_FAIL_THRESHOLD_MS ?? '7200000',
  10
); // 2 hours

export interface SweepResult {
  scanned: number;
  simsCancelled: number;
  jobsFailed: number;
  recoveriesTriggered: number;
  aggregationsTriggered: number;
  errors: { jobId: string; error: string }[];
}

/**
 * Pure predicate: should this sim be hard-cancelled right now?
 *
 * @param sim The simulation to check.
 * @param jobBaselineMs `job.startedAt?.getTime() ?? job.createdAt.getTime()`.
 *   Every sim in a job shares the same baseline so the 2h budget measures
 *   "time since the job started processing", not "time since this sim was
 *   most recently attempted". This gives a user-legible invariant:
 *   no sim can block a job more than 2h after the job started.
 * @param nowMs Current time in ms (injected for testability).
 * @param thresholdMs The cap; defaults to SIM_HARD_CANCEL_THRESHOLD_MS.
 */
export function shouldHardCancelSim(
  sim: SimulationStatus,
  jobBaselineMs: number,
  nowMs: number,
  thresholdMs: number = SIM_HARD_CANCEL_THRESHOLD_MS
): boolean {
  if (sim.state === 'COMPLETED' || sim.state === 'CANCELLED') return false;
  return nowMs - jobBaselineMs > thresholdMs;
}

function jobBaselineMs(job: Job): number {
  return (job.startedAt ?? job.createdAt).getTime();
}

/**
 * Hard-cancel every sim on the given job that has exceeded the lifetime cap.
 * Uses conditional writes so a worker completing a sim at the last second
 * wins the race (the cancel becomes a no-op).
 *
 * Returns the number of sims that were actually cancelled (races lost excluded).
 */
export async function hardCancelStaleSimsForJob(
  job: Job,
  nowMs: number
): Promise<number> {
  const sims = await jobStore.getSimulationStatuses(job.id);
  if (sims.length === 0) return 0;

  const baselineMs = jobBaselineMs(job);
  let cancelled = 0;
  const message = `Hard-cancelled by stale-sweeper after exceeding ${Math.round(
    SIM_HARD_CANCEL_THRESHOLD_MS / 60000
  )}m lifetime cap`;

  for (const sim of sims) {
    if (!shouldHardCancelSim(sim, baselineMs, nowMs)) continue;
    const updated = await jobStore.conditionalUpdateSimulationStatus(
      job.id,
      sim.simId,
      ['PENDING', 'RUNNING', 'FAILED'],
      {
        state: 'CANCELLED',
        errorMessage: message,
        completedAt: new Date(nowMs).toISOString(),
      }
    );
    if (updated) cancelled += 1;
  }

  return cancelled;
}

/**
 * Hard-fail a QUEUED job that has sat unclaimed past the absolute cap.
 * Returns true if the job was transitioned to FAILED.
 */
export async function hardFailStaleQueuedJob(
  job: Job,
  nowMs: number
): Promise<boolean> {
  if (job.status !== 'QUEUED') return false;
  const ageMs = nowMs - job.createdAt.getTime();
  if (ageMs <= QUEUED_JOB_HARD_FAIL_THRESHOLD_MS) return false;

  await jobStore.setJobFailed(
    job.id,
    `Hard-failed by stale-sweeper: job remained QUEUED for ${Math.round(
      ageMs / 60000
    )}m without being claimed by a worker`
  );
  return true;
}

/**
 * Run one sweep cycle over every active (QUEUED or RUNNING) job.
 *
 * For each job, in order:
 *   1. If QUEUED and too old → hard-fail and skip the rest.
 *   2. If RUNNING → hard-cancel any sims past the 2h baseline.
 *   3. Call jobStore.recoverStaleJob() — this is the existing path that
 *      republishes stale-PENDING sims and re-triggers aggregation in
 *      Firestore/Pub/Sub mode.
 *   4. If the job is still RUNNING and every sim is terminal, explicitly
 *      call aggregateJobResults. This covers local (SQLite) mode, where
 *      recoverStaleJob's built-in re-trigger does not fire.
 *
 * Per-job errors are isolated: one broken job does not halt the sweep.
 * Errors are logged to Sentry with `component: 'stale-sweeper'` and also
 * collected into SweepResult.errors for the HTTP response.
 *
 * @param nowMs Injected clock, defaults to Date.now(). Tests can pass a
 *   fixed future time to simulate aged jobs without manipulating DB rows.
 */
export async function sweepStaleJobs(nowMs: number = Date.now()): Promise<SweepResult> {
  const activeJobs = await jobStore.listActiveJobs();
  const result: SweepResult = {
    scanned: activeJobs.length,
    simsCancelled: 0,
    jobsFailed: 0,
    recoveriesTriggered: 0,
    aggregationsTriggered: 0,
    errors: [],
  };

  for (const job of activeJobs) {
    try {
      if (job.status === 'QUEUED') {
        const failed = await hardFailStaleQueuedJob(job, nowMs);
        if (failed) {
          result.jobsFailed += 1;
          continue;
        }
      }

      if (job.status === 'RUNNING') {
        const cancelled = await hardCancelStaleSimsForJob(job, nowMs);
        result.simsCancelled += cancelled;
      }

      const recovered = await jobStore.recoverStaleJob(job.id);
      if (recovered) result.recoveriesTriggered += 1;

      // Local mode + post-cancel catch-up: if the job is still RUNNING but
      // every sim is terminal, explicitly aggregate. recoverStaleJob's
      // built-in re-trigger is gated on GCP mode, so we cover the gap here.
      const refreshed = await jobStore.getJob(job.id);
      if (refreshed && refreshed.status === 'RUNNING') {
        const sims = await jobStore.getSimulationStatuses(job.id);
        const allTerminal =
          sims.length > 0 &&
          sims.every((s) => s.state === 'COMPLETED' || s.state === 'CANCELLED');
        if (allTerminal) {
          await jobStore.aggregateJobResults(job.id);
          result.aggregationsTriggered += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err, {
        tags: { component: 'stale-sweeper', jobId: job.id },
      });
      console.error(`[StaleSweeper] job=${job.id} error:`, message);
      result.errors.push({ jobId: job.id, error: message });
    }
  }

  return result;
}
