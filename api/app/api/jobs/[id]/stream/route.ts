import { NextRequest } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import { getDeckById } from '@/lib/deck-store-factory';
import * as workerStore from '@/lib/worker-store-factory';
import type { Job } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface QueueInfo {
  queuePosition?: number;
  workers?: { online: number; idle: number; busy: number; updating: number };
}

function jobToStreamEvent(
  job: Job,
  queueInfo?: QueueInfo,
  deckLinks?: Record<string, string | null>
) {
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  return {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
    status: job.status,
    simulations: job.simulations,
    gamesCompleted: job.gamesCompleted ?? 0,
    parallelism: job.parallelism ?? 4,
    createdAt: job.createdAt.toISOString(),
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    durationMs,
    dockerRunDurationsMs: job.dockerRunDurationsMs,
    workerId: job.workerId,
    workerName: job.workerName,
    claimedAt: job.claimedAt?.toISOString(),
    retryCount: job.retryCount ?? 0,
    ...(queueInfo?.queuePosition != null && { queuePosition: queueInfo.queuePosition }),
    ...(queueInfo?.workers && { workers: queueInfo.workers }),
    ...(deckLinks && { deckLinks }),
  };
}

async function resolveDeckLinks(job: Job): Promise<Record<string, string | null> | undefined> {
  if (!job.deckIds || job.deckIds.length !== 4) return undefined;
  const deckNames = job.decks.map((d) => d.name);
  const entries = await Promise.all(
    job.deckIds.map(async (id, i) => {
      try {
        const deck = await getDeckById(id);
        return [deckNames[i], deck?.link ?? null] as [string, string | null];
      } catch {
        return [deckNames[i], null] as [string, string | null];
      }
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Compute queue position for a QUEUED job and worker availability.
 * Cached to avoid excessive queries.
 */
let cachedQueueInfo: { data: { allQueued: Job[]; workerStats: { online: number; idle: number; busy: number; updating: number } }; at: number } | null = null;

async function getQueueInfo(jobId: string, jobCreatedAt: Date): Promise<QueueInfo> {
  const now = Date.now();
  // Refresh cache every 10 seconds
  if (!cachedQueueInfo || now - cachedQueueInfo.at > 10_000) {
    try {
      const [allJobs, activeWorkers] = await Promise.all([
        jobStore.listJobs(),
        workerStore.getActiveWorkers(),
      ]);
      const allQueued = allJobs.filter((j) => j.status === 'QUEUED');
      const idle = activeWorkers.filter((w) => w.status === 'idle').length;
      const updating = activeWorkers.filter((w) => w.status === 'updating').length;
      const busy = activeWorkers.length - idle - updating;
      cachedQueueInfo = {
        data: {
          allQueued,
          workerStats: { online: activeWorkers.length, idle, busy, updating },
        },
        at: now,
      };
    } catch {
      return {};
    }
  }

  const { allQueued, workerStats } = cachedQueueInfo!.data;
  // Queue position: count of QUEUED jobs created before this one
  const position = allQueued.filter(
    (j) => j.id !== jobId && j.createdAt.getTime() <= jobCreatedAt.getTime()
  ).length;

  return { queuePosition: position, workers: workerStats };
}

function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * GET /api/jobs/[id]/stream - Server-Sent Events stream for job updates (public, no auth required)
 *
 * GCP mode: Uses Firestore onSnapshot for real-time push
 * LOCAL mode: Polls SQLite every 2 seconds server-side
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Job ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify job exists before starting stream
  let initialJob = await jobStore.getJob(id);
  if (!initialJob) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Attempt stale job recovery on stream open (RUNNING or stuck QUEUED)
  if (initialJob.status === 'RUNNING' || initialJob.status === 'QUEUED') {
    const recovered = await jobStore.recoverStaleJob(id);
    if (recovered) {
      initialJob = (await jobStore.getJob(id)) ?? initialJob;
    }
  }

  // Resolve deck links once (they don't change during a job)
  const deckLinks = await resolveDeckLinks(initialJob);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      /** Send a named SSE event (or default 'data' event if no eventName). */
      const send = (data: object, eventName?: string) => {
        if (closed) return;
        try {
          let msg = '';
          if (eventName) {
            msg += `event: ${eventName}\n`;
          }
          msg += `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          // Stream already closed
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Send initial state immediately (with queue info if QUEUED)
      const sendInitial = async () => {
        const queueInfo = initialJob.status === 'QUEUED'
          ? await getQueueInfo(id, initialJob.createdAt).catch(() => ({}))
          : undefined;
        send(jobToStreamEvent(initialJob, queueInfo, deckLinks));
      };

      // Send simulation statuses
      const sendSimulations = async () => {
        try {
          const sims = await jobStore.getSimulationStatuses(id);
          if (sims.length > 0 && !closed) {
            send({ simulations: sims }, 'simulations');
          }
        } catch { /* ignore */ }
      };

      if (isTerminalStatus(initialJob.status)) {
        // For terminal jobs, await both sends before closing to avoid race condition
        (async () => {
          await sendInitial();
          await sendSimulations();
          close();
        })();
        return;
      }

      // For non-terminal jobs, fire-and-forget initial sends
      sendInitial();
      sendSimulations();

      if (isGcpMode()) {
        // GCP mode: Use Firestore onSnapshot for real-time updates
        const { firestore } = require('@/lib/firestore-job-store') as { firestore: import('@google-cloud/firestore').Firestore };

        // Listener 1: Job document changes
        const unsubJob = firestore.collection('jobs').doc(id).onSnapshot(
          async (snapshot) => {
            if (!snapshot.exists) {
              send({ error: 'Job not found' });
              unsubJob();
              unsubSims();
              close();
              return;
            }

            const data = snapshot.data()!;
            const deckIds = Array.isArray(data.deckIds) && data.deckIds.length === 4 ? data.deckIds as string[] : undefined;
            const job: Job = {
              id: snapshot.id,
              decks: data.decks || [],
              ...(deckIds != null && { deckIds }),
              status: data.status,
              simulations: data.simulations,
              parallelism: data.parallelism,
              createdAt: data.createdAt?.toDate() || new Date(),
              startedAt: data.startedAt?.toDate(),
              completedAt: data.completedAt?.toDate(),
              gamesCompleted: data.gamesCompleted,
              errorMessage: data.errorMessage,
              dockerRunDurationsMs: data.dockerRunDurationsMs,
              ...(data.workerId && { workerId: data.workerId }),
              ...(data.workerName && { workerName: data.workerName }),
              ...(data.claimedAt && { claimedAt: data.claimedAt.toDate() }),
              ...(data.retryCount != null && data.retryCount > 0 && { retryCount: data.retryCount }),
            };

            const queueInfo = job.status === 'QUEUED'
              ? await getQueueInfo(id, job.createdAt).catch(() => ({}))
              : undefined;
            send(jobToStreamEvent(job, queueInfo, deckLinks));

            if (isTerminalStatus(job.status)) {
              unsubJob();
              unsubSims();
              close();
            }
          },
          (error) => {
            console.error(`SSE onSnapshot error for job ${id}:`, error);
            send({ error: 'Stream error' });
            close();
          },
        );

        // Listener 2: Simulations subcollection changes
        const unsubSims = firestore
          .collection('jobs').doc(id).collection('simulations')
          .orderBy('index', 'asc')
          .onSnapshot(
            (snapshot) => {
              if (snapshot.empty) return;
              const sims = snapshot.docs.map((doc) => {
                const d = doc.data();
                return {
                  simId: doc.id,
                  index: d.index ?? 0,
                  state: d.state ?? 'PENDING',
                  ...(d.workerId && { workerId: d.workerId }),
                  ...(d.workerName && { workerName: d.workerName }),
                  ...(d.startedAt && { startedAt: d.startedAt }),
                  ...(d.completedAt && { completedAt: d.completedAt }),
                  ...(d.durationMs != null && { durationMs: d.durationMs }),
                  ...(d.errorMessage && { errorMessage: d.errorMessage }),
                  ...(d.winner && { winner: d.winner }),
                  ...(d.winningTurn != null && { winningTurn: d.winningTurn }),
                };
              });
              send({ simulations: sims }, 'simulations');
            },
            (error) => {
              console.error(`SSE simulations onSnapshot error for job ${id}:`, error);
              // Non-fatal: simulation updates just won't appear
            },
          );

        // Periodic stale job recovery check (every 30s)
        const recoveryInterval = setInterval(async () => {
          if (closed) {
            clearInterval(recoveryInterval);
            return;
          }
          try {
            await jobStore.recoverStaleJob(id);
          } catch {
            // Non-fatal: recovery check failed
          }
        }, 30_000);

        // Cleanup on client disconnect
        request.signal.addEventListener('abort', () => {
          clearInterval(recoveryInterval);
          unsubJob();
          unsubSims();
          close();
        });
      } else {
        // LOCAL mode: Poll SQLite every 2 seconds server-side
        let lastJobJson = JSON.stringify(jobToStreamEvent(initialJob, undefined, deckLinks));
        let lastSimsJson = '';

        const interval = setInterval(async () => {
          if (closed) {
            clearInterval(interval);
            return;
          }
          try {
            const job = await jobStore.getJob(id);
            if (!job) {
              send({ error: 'Job not found' });
              clearInterval(interval);
              close();
              return;
            }

            // Only send job event if data changed
            const queueInfo = job.status === 'QUEUED'
              ? await getQueueInfo(id, job.createdAt).catch(() => ({}))
              : undefined;
            const currentJobJson = JSON.stringify(jobToStreamEvent(job, queueInfo, deckLinks));
            if (currentJobJson !== lastJobJson) {
              lastJobJson = currentJobJson;
              send(jobToStreamEvent(job, queueInfo, deckLinks));
            }

            // Poll simulation statuses too
            const sims = await jobStore.getSimulationStatuses(id);
            if (sims.length > 0) {
              const currentSimsJson = JSON.stringify(sims);
              if (currentSimsJson !== lastSimsJson) {
                lastSimsJson = currentSimsJson;
                send({ simulations: sims }, 'simulations');
              }
            }

            if (isTerminalStatus(job.status)) {
              clearInterval(interval);
              close();
            }
          } catch (error) {
            console.error(`SSE poll error for job ${id}:`, error);
            clearInterval(interval);
            close();
          }
        }, 2000);

        // Periodic stale job recovery check (every 30s)
        const localRecoveryInterval = setInterval(async () => {
          if (closed) {
            clearInterval(localRecoveryInterval);
            return;
          }
          try {
            await jobStore.recoverStaleJob(id);
          } catch {
            // Non-fatal: recovery check failed
          }
        }, 30_000);

        request.signal.addEventListener('abort', () => {
          clearInterval(interval);
          clearInterval(localRecoveryInterval);
          close();
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
