/**
 * Worker presence in the Firebase Realtime Database.
 *
 * Every online worker has one entry at `presence/{workerId}`, rewritten about
 * once a minute: the Docker worker through `POST /api/workers/heartbeat`, the
 * desktop worker directly (with an onDisconnect that removes the entry the
 * moment its connection drops). Realtime Database bills bandwidth and
 * storage, not operations, so these writes cost nothing against the
 * Firestore free tier.
 *
 * The API (active workers for recovery and push) and the frontend (worker
 * list) both read presence and keep only the entries seen recently.
 */
import type { WorkerInfo } from './worker';

/** Realtime Database path holding one entry per worker. */
export const PRESENCE_PATH = 'presence';

/** A worker counts as online when seen within this window. */
export const WORKER_STALE_MS = 3 * 60 * 1000;

/** Longer window while a worker restarts for an update. */
export const WORKER_UPDATING_STALE_MS = 5 * 60 * 1000;

/** One worker's entry at `presence/{workerId}`. */
export interface WorkerPresence {
  workerName: string;
  workerType?: 'docker' | 'flutter';
  status: WorkerInfo['status'];
  currentJobId?: string | null;
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  /** Server time of the last write, in epoch ms. */
  lastSeen: number;
  version?: string | null;
  maxConcurrentOverride?: number | null;
  ownerEmail?: string | null;
  workerApiUrl?: string | null;
  /** Firebase uid of the desktop worker's user; the database rules check it. */
  uid?: string;
}

/** True when the worker was seen recently enough to count as online. */
export function isPresenceActive(
  presence: Pick<WorkerPresence, 'status' | 'lastSeen'>,
  nowMs: number = Date.now(),
  staleMs: number = WORKER_STALE_MS,
): boolean {
  const window = presence.status === 'updating' ? Math.max(staleMs, WORKER_UPDATING_STALE_MS) : staleMs;
  return typeof presence.lastSeen === 'number' && nowMs - presence.lastSeen <= window;
}

/** Convert a presence entry to the WorkerInfo shape the API and UI use. */
export function presenceToWorkerInfo(workerId: string, presence: WorkerPresence): WorkerInfo {
  return {
    workerId,
    workerName: presence.workerName,
    status: presence.status,
    ...(presence.currentJobId ? { currentJobId: presence.currentJobId } : {}),
    capacity: presence.capacity ?? 0,
    activeSimulations: presence.activeSimulations ?? 0,
    uptimeMs: presence.uptimeMs ?? 0,
    lastHeartbeat: new Date(presence.lastSeen).toISOString(),
    ...(presence.version ? { version: presence.version } : {}),
    maxConcurrentOverride: presence.maxConcurrentOverride ?? null,
    ownerEmail: presence.ownerEmail ?? null,
    workerApiUrl: presence.workerApiUrl ?? null,
    ...(presence.workerType ? { workerType: presence.workerType } : {}),
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
