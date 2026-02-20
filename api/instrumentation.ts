export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startStaleJobScanner } = await import('./lib/stale-job-scanner');
    startStaleJobScanner();

    const { startPreconSync } = await import('./lib/precon-sync-scheduler');
    startPreconSync();
  }
}
