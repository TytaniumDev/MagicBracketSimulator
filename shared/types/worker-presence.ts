/**
 * Worker presence in the Firebase Realtime Database.
 *
 * Every online desktop worker has one entry at `presence/{workerId}`, which it
 * rewrites about once a minute, with an onDisconnect that removes the entry
 * the moment its connection drops. Realtime Database bills bandwidth and
 * storage, not operations, so these writes cost nothing against the
 * Firestore free tier.
 *
 * The API (active workers for recovery and health checks) and the frontend
 * (worker list) both read presence and keep only the entries seen recently.
 */
import type { WorkerInfo } from './worker';

/** Realtime Database path holding one entry per worker. */
export const PRESENCE_PATH = 'presence';

/** A worker counts as online when seen within this window. */
export const WORKER_STALE_MS = 3 * 60 * 1000;

/** One worker's entry at `presence/{workerId}`. */
export interface WorkerPresence {
  workerName: string;
  /** Always 'flutter'; the database rules require it. */
  workerType: 'flutter';
  status: WorkerInfo['status'];
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  /** Server time of the last write, in epoch ms. */
  lastSeen: number;
  /** Firebase uid of the desktop worker's user; the database rules check it. */
  uid: string;
}

/** True when the worker was seen recently enough to count as online. */
export function isPresenceActive(
  presence: Pick<WorkerPresence, 'lastSeen'>,
  nowMs: number = Date.now(),
  staleMs: number = WORKER_STALE_MS,
): boolean {
  return typeof presence.lastSeen === 'number' && nowMs - presence.lastSeen <= staleMs;
}

/** Convert a presence entry to the WorkerInfo shape the API and UI use. */
export function presenceToWorkerInfo(workerId: string, presence: WorkerPresence): WorkerInfo {
  return {
    workerId,
    workerName: presence.workerName,
    status: presence.status,
    capacity: presence.capacity ?? 0,
    activeSimulations: presence.activeSimulations ?? 0,
    uptimeMs: presence.uptimeMs ?? 0,
    lastHeartbeat: new Date(presence.lastSeen).toISOString(),
  };
}

/**
 * The online workers in a `presence` snapshot, newest first. `entries` is the
 * snapshot's value: a map of workerId to entry, or null when empty.
 */
export function activeWorkersFromPresence(
  entries: Record<string, WorkerPresence> | null | undefined,
  nowMs: number = Date.now(),
  staleMs: number = WORKER_STALE_MS,
): WorkerInfo[] {
  return Object.entries(entries ?? {})
    .filter(([, p]) => p && isPresenceActive(p, nowMs, staleMs))
    .sort(([, a], [, b]) => b.lastSeen - a.lastSeen)
    .map(([id, p]) => presenceToWorkerInfo(id, p));
}
