/**
 * Worker Sentry initialization.
 *
 * Graceful no-op when SENTRY_DSN is unset so LOCAL and dev workers don't
 * need to care. All instrumentation goes through this module so we get
 * consistent tags and a single place to change configuration.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
const enabled = !!dsn;

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.GOOGLE_CLOUD_PROJECT ? 'production' : 'local',
    // Tracing is opt-in per-transaction; most worker code doesn't need it.
    tracesSampleRate: 0.1,
    // The worker runs long-lived processes; keep error sampling at 1.0 so
    // we never miss failures (they're already rare).
    sampleRate: 1.0,
  });
}

export interface WorkerErrorTags {
  jobId?: string;
  simId?: string;
  simIndex?: number;
  workerId?: string;
  component?: string;
}

/**
 * Capture an exception with worker-specific tags. No-op if Sentry is disabled.
 */
export function captureWorkerException(
  error: unknown,
  tags: WorkerErrorTags = {}
): void {
  if (!enabled) return;
  Sentry.captureException(error, {
    tags: {
      component: tags.component ?? 'worker',
      ...(tags.jobId && { jobId: tags.jobId }),
      ...(tags.simId && { simId: tags.simId }),
      ...(tags.simIndex != null && { simIndex: String(tags.simIndex) }),
      ...(tags.workerId && { workerId: tags.workerId }),
    },
  });
}

/**
 * Add a breadcrumb for observability. No-op if Sentry is disabled.
 */
export function addWorkerBreadcrumb(
  message: string,
  data?: Record<string, unknown>
): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({
    message,
    category: 'worker',
    level: 'info',
    ...(data && { data }),
  });
}

/**
 * Flush pending Sentry events before the process exits. Call before
 * process.exit() so fatal errors are reported.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Best-effort flush; never block shutdown.
  }
}
