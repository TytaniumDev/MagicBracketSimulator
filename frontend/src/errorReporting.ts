import * as Sentry from '@sentry/react';

/**
 * Errors already sent, so one failure reported where it happens (a failed
 * fetch) isn't sent again by the query or mutation that surfaces it.
 */
const reported = new WeakSet<object>();

function isReported(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (reported.has(error)) return true;
  reported.add(error);
  return false;
}

/**
 * Report a failure the UI handled itself (a failed API call shown as an
 * error message), which Sentry's crash handling never sees. A no-op when
 * Sentry isn't configured.
 */
export function reportHandledError(error: unknown, context: Record<string, unknown>): void {
  if (isReported(error)) return;
  Sentry.captureException(error, { level: 'warning', tags: { handled: 'true' }, extra: context });
}
