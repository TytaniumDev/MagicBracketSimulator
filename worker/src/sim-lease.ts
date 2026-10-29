/**
 * Keeps a claimed sim's lease alive while it runs. Counterpart to
 * api/lib/sim-lease.ts: the worker claims with `?lease=1` and extends the
 * lease about once a minute (the API holds it for 3 minutes). If the worker
 * dies, the lease runs out and another worker takes the sim over, so no
 * heartbeat is needed for crash recovery.
 */

/** What the API's lease endpoint reports. */
export type SimLeaseStatus = 'extended' | 'cancelled' | 'lost';

/** How often a running sim's lease is extended. Well inside the 3-minute lease. */
export const SIM_LEASE_EXTEND_INTERVAL_MS = 60_000;

export interface KeepSimLeaseOptions {
  /** Extend the lease once. Returns null when the call failed; the next tick retries. */
  extend: () => Promise<SimLeaseStatus | null>;
  /** Called once when the API says to stop: the job was cancelled, or the sim is no longer ours. */
  onEnd: (status: 'cancelled' | 'lost') => void;
  intervalMs?: number;
}

/** Start extending a sim's lease on an interval. Returns a function that stops it. */
export function keepSimLease({ extend, onEnd, intervalMs = SIM_LEASE_EXTEND_INTERVAL_MS }: KeepSimLeaseOptions): () => void {
  let stopped = false;
  const timer = setInterval(async () => {
    const status = await extend();
    if (stopped || status === null || status === 'extended') return;
    stop();
    onEnd(status);
  }, intervalMs);

  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return stop;
}

/**
 * Next wait between idle claim polls: doubles after each empty poll, up to
 * `maxMs`. Push notifications (`/notify`) still wake the worker at once.
 */
export function nextIdlePollMs(currentMs: number, baseMs: number, maxMs: number): number {
  return Math.min(Math.max(currentMs, baseMs) * 2, maxMs);
}
