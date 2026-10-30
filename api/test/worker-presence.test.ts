/**
 * Tests for the pure worker-presence rules (shared/types/worker-presence.ts):
 * which Realtime Database entries count as online, and how they map to
 * WorkerInfo.
 *
 * Run with: npx tsx test/worker-presence.test.ts
 */
import {
  activeWorkersFromPresence,
  isPresenceActive,
  presenceToWorkerInfo,
  WORKER_STALE_MS,
  type WorkerPresence,
} from '@shared/types/worker-presence';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}: expected ${e}, got ${a}`);
  }
}

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function entry(overrides: Partial<WorkerPresence> = {}): WorkerPresence {
  return {
    workerName: 'box',
    workerType: 'flutter',
    status: 'idle',
    capacity: 4,
    activeSimulations: 0,
    uptimeMs: 1000,
    lastSeen: NOW - 10_000,
    uid: 'uid1',
    ...overrides,
  };
}

check('seen 10 s ago is active', isPresenceActive(entry(), NOW), true);
check('seen just inside the window is active', isPresenceActive(entry({ lastSeen: NOW - WORKER_STALE_MS }), NOW), true);
check('seen past the window is not active', isPresenceActive(entry({ lastSeen: NOW - WORKER_STALE_MS - 1 }), NOW), false);
check(
  'a narrower staleMs is honoured',
  isPresenceActive(entry({ lastSeen: NOW - 130_000 }), NOW, 120_000),
  false,
);
check(
  'an entry without lastSeen is not active',
  isPresenceActive({} as WorkerPresence, NOW),
  false,
);

check('presenceToWorkerInfo maps fields', presenceToWorkerInfo('w1', entry({
  status: 'busy',
  activeSimulations: 2,
})), {
  workerId: 'w1',
  workerName: 'box',
  status: 'busy',
  capacity: 4,
  activeSimulations: 2,
  uptimeMs: 1000,
  lastHeartbeat: new Date(NOW - 10_000).toISOString(),
});

check('null snapshot means no workers', activeWorkersFromPresence(null, NOW), []);
check(
  'keeps active entries, newest first',
  activeWorkersFromPresence({
    old: entry({ lastSeen: NOW - 60_000 }),
    gone: entry({ lastSeen: NOW - WORKER_STALE_MS - 1 }),
    fresh: entry({ lastSeen: NOW - 1_000 }),
  }, NOW).map((w) => w.workerId),
  ['fresh', 'old'],
);

if (failed > 0) process.exit(1);
