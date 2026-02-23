export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPreconSync } = await import('./lib/precon-sync-scheduler');
    startPreconSync();
  }
}
