import { NextRequest } from 'next/server';
import { optionalAuth, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import type { Job } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function jobToStreamEvent(job: Job) {
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
    resultJson: job.resultJson,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    durationMs,
    dockerRunDurationsMs: job.dockerRunDurationsMs,
    workerId: job.workerId,
    claimedAt: job.claimedAt?.toISOString(),
  };
}

function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/**
 * Authenticate via Authorization header OR ?token= query param.
 * EventSource doesn't support custom headers, so the token query param
 * is needed for SSE connections from the browser.
 */
async function authenticateStream(request: NextRequest): Promise<boolean> {
  if (isWorkerRequest(request)) return true;

  // Try standard Authorization header first
  const user = await optionalAuth(request);
  if (user) return true;

  // Fall back to query param token (for EventSource)
  const tokenParam = request.nextUrl.searchParams.get('token');
  if (tokenParam) {
    // Create a synthetic request with the token as a Bearer header
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${tokenParam}`);
    const syntheticReq = new NextRequest(request.url, { headers });
    const tokenUser = await optionalAuth(syntheticReq);
    return tokenUser !== null;
  }

  // In local mode, optionalAuth returns local mock user even without a token
  return false;
}

/**
 * GET /api/jobs/[id]/stream - Server-Sent Events stream for job updates
 *
 * GCP mode: Uses Firestore onSnapshot for real-time push
 * LOCAL mode: Polls SQLite every 2 seconds server-side
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const allowed = await authenticateStream(request);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = await params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Job ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify job exists before starting stream
  const initialJob = await jobStore.getJob(id);
  if (!initialJob) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

      // Send initial state immediately
      send(jobToStreamEvent(initialJob));

      // Send initial simulation statuses (if any exist)
      jobStore.getSimulationStatuses(id).then((sims) => {
        if (sims.length > 0 && !closed) {
          send({ simulations: sims }, 'simulations');
        }
      }).catch(() => { /* ignore */ });

      if (isTerminalStatus(initialJob.status)) {
        close();
        return;
      }

      if (isGcpMode()) {
        // GCP mode: Use Firestore onSnapshot for real-time updates
        const { firestore } = require('@/lib/firestore-job-store') as { firestore: import('@google-cloud/firestore').Firestore };

        // Listener 1: Job document changes
        const unsubJob = firestore.collection('jobs').doc(id).onSnapshot(
          (snapshot) => {
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
              resultJson: data.resultJson,
              dockerRunDurationsMs: data.dockerRunDurationsMs,
              ...(data.workerId && { workerId: data.workerId }),
              ...(data.claimedAt && { claimedAt: data.claimedAt.toDate() }),
            };

            send(jobToStreamEvent(job));

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

        // Cleanup on client disconnect
        request.signal.addEventListener('abort', () => {
          unsubJob();
          unsubSims();
          close();
        });
      } else {
        // LOCAL mode: Poll SQLite every 2 seconds server-side
        let lastJobJson = JSON.stringify(jobToStreamEvent(initialJob));
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
            const currentJobJson = JSON.stringify(jobToStreamEvent(job));
            if (currentJobJson !== lastJobJson) {
              lastJobJson = currentJobJson;
              send(jobToStreamEvent(job));
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

        request.signal.addEventListener('abort', () => {
          clearInterval(interval);
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
