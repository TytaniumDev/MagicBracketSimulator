/**
 * Worker HTTP API — lightweight push-based control plane.
 *
 * Endpoints:
 *   POST /config  — push config updates (e.g., maxConcurrentOverride)
 *   POST /cancel  — cancel all simulations for a job
 *   POST /notify  — notify worker that a new job is available
 *   POST /drain   — stop accepting new work (active sims complete, then idle)
 *   POST /pull-image — trigger a fresh pull of the simulation image
 *   GET  /health  — health check (no auth)
 *
 * All POST endpoints require X-Worker-Secret header (constant-time comparison).
 */

import * as http from 'http';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerApiHandlers {
  onConfig: (maxConcurrentOverride: number | null) => void;
  onCancel: (jobId: string) => void;
  onNotify: () => void;
  onDrain: (drain: boolean) => void;
  onPullImage: () => void;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of the X-Worker-Secret header against the expected secret.
 * Uses SHA-256 hashing so both sides are always the same length.
 */
function verifySecret(provided: string | undefined): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected || !provided) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 64 * 1024; // 64 KB
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let server: http.Server | null = null;

export function startWorkerApi(handlers: WorkerApiHandlers): Promise<void> {
  const port = parseInt(process.env.WORKER_API_PORT || '9090', 10);

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const url = req.url ?? '';
      const method = req.method ?? '';

      // GET /health — no auth
      if (method === 'GET' && url === '/health') {
        jsonResponse(res, 200, { ok: true });
        return;
      }

      // All other routes require auth
      if (!verifySecret(req.headers['x-worker-secret'] as string | undefined)) {
        jsonResponse(res, 401, { error: 'Unauthorized' });
        return;
      }

      // Only POST methods beyond this point
      if (method !== 'POST') {
        jsonResponse(res, 405, { error: 'Method not allowed' });
        return;
      }

      try {
        const body = await readBody(req);

        switch (url) {
          case '/config': {
            const data = JSON.parse(body) as { maxConcurrentOverride?: unknown };
            const override = data.maxConcurrentOverride;
            if (override !== null && override !== undefined) {
              if (typeof override !== 'number' || !Number.isInteger(override) || override < 1 || override > 20) {
                jsonResponse(res, 400, { error: 'maxConcurrentOverride must be null or integer 1-20' });
                return;
              }
            }
            const value = (override === null || override === undefined) ? null : override as number;
            handlers.onConfig(value);
            jsonResponse(res, 200, { ok: true, applied: value });
            break;
          }

          case '/cancel': {
            const data = JSON.parse(body) as { jobId?: unknown };
            if (typeof data.jobId !== 'string' || !data.jobId) {
              jsonResponse(res, 400, { error: 'jobId is required' });
              return;
            }
            handlers.onCancel(data.jobId);
            jsonResponse(res, 200, { ok: true, jobId: data.jobId });
            break;
          }

          case '/notify': {
            handlers.onNotify();
            jsonResponse(res, 200, { ok: true });
            break;
          }

          case '/drain': {
            const data = JSON.parse(body) as { drain?: unknown };
            if (typeof data.drain !== 'boolean') {
              jsonResponse(res, 400, { error: 'drain must be a boolean' });
              return;
            }
            handlers.onDrain(data.drain);
            jsonResponse(res, 200, { ok: true, draining: data.drain });
            break;
          }

          case '/pull-image': {
            handlers.onPullImage();
            jsonResponse(res, 200, { ok: true, message: 'Image pull initiated' });
            break;
          }

          default:
            jsonResponse(res, 404, { error: 'Not found' });
        }
      } catch (err) {
        const message = err instanceof SyntaxError ? 'Invalid JSON' : 'Internal error';
        jsonResponse(res, 400, { error: message });
      }
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`Worker API listening on 0.0.0.0:${port}`);
      resolve();
    });

    server.on('error', (err) => {
      console.error('Worker API server error:', err);
      reject(err);
    });
  });
}

export async function stopWorkerApi(): Promise<void> {
  if (!server) return;
  return new Promise((resolve) => {
    server!.close(() => {
      server = null;
      resolve();
    });
  });
}
