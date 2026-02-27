import { NextRequest } from 'next/server';
import { verifyAuth, verifyTokenString, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import { getDeckById } from '@/lib/deck-store-factory';
import { GAMES_PER_CONTAINER, type Job } from '@/lib/types';
import { jobToStreamEvent } from '@/lib/stream-utils';

interface RouteParams {
  params: Promise<{ id: string }>;
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

function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * GET /api/jobs/[id]/stream - Server-Sent Events stream for job updates
 *
 * Auth: accepts ?token= query param (SSE can't send headers) or Authorization header.
 * Workers bypass auth via X-Worker-Secret.
 *
 * GCP mode: Returns 410 Gone — frontend uses Firebase RTDB direct streaming instead.
 * LOCAL mode: Polls SQLite every 2 seconds server-side (RTDB not available locally).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  // Auth: workers bypass, otherwise check token query param or Authorization header
  if (!isWorkerRequest(request)) {
    const tokenParam = request.nextUrl.searchParams.get('token');
    try {
      if (tokenParam) {
        await verifyTokenString(tokenParam);
      } else {
        await verifyAuth(request);
      }
    } catch {
      return unauthorizedResponse();
    }
  }

  const { id } = await params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Job ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // In GCP mode, frontend streams from RTDB directly — SSE endpoint no longer needed
  if (isGcpMode()) {
    return new Response(JSON.stringify({ error: 'Use Firebase RTDB for real-time streaming' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── LOCAL mode: Poll SQLite every 2 seconds ──────────────────────────────

  // Verify job exists before starting stream
  let initialJob = await jobStore.getJob(id);
  if (!initialJob) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Attempt stale job recovery on stream open
  if (initialJob.status === 'RUNNING' || initialJob.status === 'QUEUED') {
    const recovered = await jobStore.recoverStaleJob(id);
    if (recovered) {
      initialJob = (await jobStore.getJob(id)) ?? initialJob;
    }
  }

  const deckLinks = await resolveDeckLinks(initialJob);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
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

      let interval: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
        close();
      };

      const sendInitial = async () => {
        const sims = await jobStore.getSimulationStatuses(id);
        const computedGames = sims.length > 0
          ? sims.filter((s) => s.state === 'COMPLETED').length * GAMES_PER_CONTAINER
          : undefined;
        send(jobToStreamEvent(initialJob, undefined, deckLinks, computedGames));
      };

      const sendSimulations = async () => {
        try {
          const sims = await jobStore.getSimulationStatuses(id);
          if (sims.length > 0 && !closed) {
            send({ simulations: sims }, 'simulations');
          }
        } catch { /* ignore */ }
      };

      if (isTerminalStatus(initialJob.status)) {
        (async () => {
          await sendInitial();
          await sendSimulations();
          close();
        })();
        return;
      }

      sendInitial();
      sendSimulations();

      // LOCAL mode: Poll SQLite every 2 seconds
      let lastJobJson = JSON.stringify(jobToStreamEvent(initialJob, undefined, deckLinks));
      let lastSimsJson = '';

      interval = setInterval(async () => {
        if (closed) {
          cleanup();
          return;
        }
        try {
          const job = await jobStore.getJob(id);
          if (!job) {
            send({ error: 'Job not found' });
            cleanup();
            return;
          }

          const sims = await jobStore.getSimulationStatuses(id);
          const computedGames = sims.length > 0
            ? sims.filter((s) => s.state === 'COMPLETED').length * GAMES_PER_CONTAINER
            : undefined;

          const currentJobJson = JSON.stringify(jobToStreamEvent(job, undefined, deckLinks, computedGames));
          if (currentJobJson !== lastJobJson) {
            lastJobJson = currentJobJson;
            send(jobToStreamEvent(job, undefined, deckLinks, computedGames));
          }
          if (sims.length > 0) {
            const currentSimsJson = JSON.stringify(sims);
            if (currentSimsJson !== lastSimsJson) {
              lastSimsJson = currentSimsJson;
              send({ simulations: sims }, 'simulations');
            }
          }

          if (isTerminalStatus(job.status)) {
            cleanup();
          }
        } catch (error) {
          console.error(`SSE poll error for job ${id}:`, error);
          cleanup();
        }
      }, 2000);

      request.signal.addEventListener('abort', () => {
        cleanup();
      });
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
