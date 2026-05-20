/**
 * Central environment mode detection.
 * Zero dependencies — import freely from any module.
 */
export const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

/** Returns true when running in GCP mode (Firestore + Cloud Storage). */
export function isGcpMode(): boolean {
  return USE_FIRESTORE;
}

/** Returns true when running in LOCAL mode (SQLite + local filesystem). */
export function isLocalMode(): boolean {
  return !USE_FIRESTORE;
}
