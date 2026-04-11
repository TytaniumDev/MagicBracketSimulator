import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    // Previously spawned a long-lived setTimeout/setInterval here to sync
    // precons from Archidekt every 24 hours. That's the wrong shape for a
    // scale-to-zero serverless container: the sync re-runs on every cold
    // start instead of on a schedule, and any in-flight fetch can race
    // with regular request handling. Precon sync now runs via Cloud
    // Scheduler hitting POST /api/sync/precons daily — see
    // docs/PRECON_SYNC.md.
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
