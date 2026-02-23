/**
 * Firebase Realtime Database helpers for ephemeral job progress.
 *
 * RTDB holds only active job progress data — it's deleted when jobs reach
 * terminal state. Firestore remains the persistent source of truth.
 *
 * In LOCAL mode (no GOOGLE_CLOUD_PROJECT), all functions are no-ops.
 */

const USE_RTDB = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let db: import('firebase-admin/database').Database | null = null;

function getDb(): import('firebase-admin/database').Database | null {
  if (!USE_RTDB) return null;
  if (db) return db;

  try {
    // firebase-admin must be initialized elsewhere (e.g., by Firestore init).
    // getDatabase() retrieves the default app's RTDB instance.
    const { getDatabase } = require('firebase-admin/database') as typeof import('firebase-admin/database');

    // Ensure admin app is initialized
    const admin = require('firebase-admin') as typeof import('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp({
        databaseURL: `https://${process.env.GOOGLE_CLOUD_PROJECT}-default-rtdb.firebaseio.com`,
      });
    } else {
      // If the app exists but RTDB URL wasn't configured, we may need to check.
      // getDatabase() on the default app should work if the URL is discoverable.
    }

    db = getDatabase();
    return db;
  } catch (err) {
    console.warn('[RTDB] Failed to initialize Realtime Database:', err);
    return null;
  }
}

/**
 * Write or merge job-level progress to RTDB.
 * Fire-and-forget — callers should not await or depend on this.
 */
export async function updateJobProgress(
  jobId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const rtdb = getDb();
  if (!rtdb) return;

  try {
    await rtdb.ref(`jobs/${jobId}`).update(data);
  } catch (err) {
    console.warn(`[RTDB] Failed to update job progress for ${jobId}:`, err);
  }
}

/**
 * Write or merge simulation-level progress to RTDB.
 * Fire-and-forget — callers should not await or depend on this.
 */
export async function updateSimProgress(
  jobId: string,
  simId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const rtdb = getDb();
  if (!rtdb) return;

  try {
    await rtdb.ref(`jobs/${jobId}/simulations/${simId}`).update(data);
  } catch (err) {
    console.warn(`[RTDB] Failed to update sim progress for ${jobId}/${simId}:`, err);
  }
}

/**
 * Delete all RTDB data for a job (called when job reaches terminal state).
 * Keeps RTDB small — only active jobs have data.
 */
export async function deleteJobProgress(jobId: string): Promise<void> {
  const rtdb = getDb();
  if (!rtdb) return;

  try {
    await rtdb.ref(`jobs/${jobId}`).remove();
  } catch (err) {
    console.warn(`[RTDB] Failed to delete job progress for ${jobId}:`, err);
  }
}
