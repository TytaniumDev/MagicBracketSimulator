/**
 * Retry classification for GCS operations.
 *
 * Lives in its own module so it can be unit-tested without constructing a
 * real @google-cloud/storage client.
 */

// All entries must be lowercase — error.message is lowercased before comparison.
const RETRYABLE_MESSAGES = [
  'socket hang up',
  'econnreset',
  'etimedout',
  'econnrefused',
  'network error',
  // Node emits this when a socket closes mid-TLS-handshake. Observed in
  // production against storage.googleapis.com resumable uploads (issue #158).
  'client network socket disconnected',
];
const RETRYABLE_CODES = [429, 500, 502, 503, 504];

/**
 * Returns true for transient network/server errors that are safe to retry.
 */
export function isRetryableGcsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();
  if (RETRYABLE_MESSAGES.some(retryableMsg => msg.includes(retryableMsg))) {
    return true;
  }

  const code = (error as { code?: number }).code;
  if (typeof code === 'number' && RETRYABLE_CODES.includes(code)) {
    return true;
  }

  return false;
}
