/**
 * Approved users copied into the Realtime Database at `approved/{uid}`
 * (GCP mode). database.rules.json cannot read Firestore, so this copy is how
 * it lets only approved accounts read or write worker presence.
 *
 * The source of truth stays the Firestore access record (user-store.ts) plus
 * ADMIN_EMAILS / ALLOWED_EMAILS. The API writes the copy whenever it lets an
 * account in, so every approved user who reaches the API gets one. Only the
 * Admin SDK writes here; the rules deny clients.
 *
 * To revoke a user, delete both `users/{uid}` in Firestore and
 * `approved/{uid}` in the Realtime Database.
 */
import { getDatabase } from 'firebase-admin/database';
import * as Sentry from '@sentry/nextjs';
import { isLocalMode } from './env';
import { getFirebaseAdminApp } from './firebase-admin-app';

/** Realtime Database path holding one `true` entry per approved uid. */
export const APPROVED_PATH = 'approved';

type MirrorWriter = (uid: string) => Promise<void>;

async function writeToRealtimeDatabase(uid: string): Promise<void> {
  await getDatabase(getFirebaseAdminApp()).ref(`${APPROVED_PATH}/${uid}`).set(true);
}

/**
 * Builds the mirror. Each instance writes a uid once and remembers it, so
 * the per-request call is free after the first. A failed write is reported
 * to Sentry and retried on the user's next request; it never blocks access
 * to the API.
 */
export function createApprovedUsersMirror(write: MirrorWriter = writeToRealtimeDatabase) {
  const mirrored = new Set<string>();
  return async function mirrorApprovedUser(uid: string): Promise<void> {
    if (isLocalMode() || mirrored.has(uid)) return;
    try {
      await write(uid);
      mirrored.add(uid);
    } catch (error) {
      Sentry.captureException(error, { tags: { component: 'approved-users-mirror' } });
      console.error('[ApprovedUsersMirror] Failed to mirror approved user:', error);
    }
  };
}

/** Record `uid` as approved in the Realtime Database. */
export const mirrorApprovedUser = createApprovedUsersMirror();
