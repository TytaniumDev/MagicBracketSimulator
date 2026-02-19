const SCAN_INTERVAL_MS = 45_000;
const INITIAL_DELAY_MS = 10_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let scanning = false;

async function scanOnce(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const { listActiveJobs, recoverStaleJob } = await import('./job-store-factory');
    const activeJobs = await listActiveJobs();
    for (const job of activeJobs) {
      try {
        const recovered = await recoverStaleJob(job.id);
        if (recovered) {
          console.log(`[StaleJobScanner] Recovered job ${job.id} (was ${job.status})`);
        }
      } catch (err) {
        console.warn(`[StaleJobScanner] Error recovering job ${job.id}:`, err);
      }
    }
  } catch (err) {
    console.warn('[StaleJobScanner] Error during scan:', err);
  } finally {
    scanning = false;
  }
}

export function startStaleJobScanner(): void {
  if (intervalHandle) return;
  console.log('[StaleJobScanner] Starting background scanner');

  const timeout = setTimeout(() => {
    scanOnce();
    intervalHandle = setInterval(scanOnce, SCAN_INTERVAL_MS);
    intervalHandle.unref();
  }, INITIAL_DELAY_MS);
  timeout.unref();
}

export function stopStaleJobScanner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[StaleJobScanner] Stopped');
  }
}
