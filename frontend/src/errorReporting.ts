import * as Sentry from '@sentry/react';

/**
 * Report a failure the UI handled itself (a failed API call shown as an
 * error message), which Sentry's crash handling never sees. A no-op when
 * Sentry isn't configured.
 */
export function reportHandledError(error: unknown, context: Record<string, unknown>): void {
  Sentry.captureException(error, { level: 'warning', tags: { handled: 'true' }, extra: context });
}
