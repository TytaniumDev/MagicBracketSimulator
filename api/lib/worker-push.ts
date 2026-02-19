/**
 * Push helper for sending commands to worker HTTP APIs.
 * All calls are best-effort with 5s timeout — heartbeat fallback still works if push fails.
 */

import * as workerStore from './worker-store-factory';

const PUSH_TIMEOUT_MS = 5_000;

/**
 * Send a POST request to a single worker's HTTP API.
 * Returns true on success, false on failure.
 */
export async function pushToWorker(
  workerApiUrl: string,
  path: string,
  body: unknown
): Promise<boolean> {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return false;

  try {
    const res = await fetch(`${workerApiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Push a command to all active workers that have a workerApiUrl.
 * Best-effort — failures are logged but don't throw.
 */
export async function pushToAllWorkers(
  path: string,
  body: unknown
): Promise<void> {
  const workers = await workerStore.getActiveWorkers();
  const pushable = workers.filter((w) => w.workerApiUrl);
  if (pushable.length === 0) return;

  const results = await Promise.allSettled(
    pushable.map((w) => pushToWorker(w.workerApiUrl!, path, body))
  );

  const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
  if (failed > 0) {
    console.warn(`Push to ${path}: ${pushable.length - failed}/${pushable.length} workers succeeded`);
  }
}
