/**
 * Precon sync scheduler: syncs on startup then every 24 hours.
 */
import { syncPrecons } from './archidekt-sync';

const INITIAL_DELAY_MS = 5_000;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24 hours

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let syncing = false;

async function runSync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await syncPrecons();
  } catch (err) {
    console.error('[PreconSyncScheduler] Sync error:', err);
  } finally {
    syncing = false;
  }
}

export function startPreconSync(): void {
  if (intervalHandle) return;
  console.log('[PreconSyncScheduler] Scheduling precon sync (initial in 5s, then every 24h)');

  const timeout = setTimeout(() => {
    runSync();
    intervalHandle = setInterval(runSync, SYNC_INTERVAL_MS);
    intervalHandle.unref();
  }, INITIAL_DELAY_MS);
  timeout.unref();
}

export function stopPreconSync(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[PreconSyncScheduler] Stopped');
  }
}
