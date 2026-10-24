/**
 * Lookup for the Firestore `allowedUsers` collection: the allowlist of
 * approved accounts. Doc ids are Firebase Auth uids. Users join it when an
 * admin clicks the approve link in an access-request email
 * (`/api/access-requests/approve`). The Firestore rules and the frontend read
 * the same collection.
 */
import { isLocalMode } from './env';
import { getFirestore } from './firestore-client';
import { lruEvictIfFull, lruTouch } from './lru';

const ALLOWED_USERS_COLLECTION = 'allowedUsers';

// A job's worth of worker uploads (and every API call from the web app)
// checks the same uid repeatedly, so remember positive lookups briefly. Revoking a user takes effect within the TTL.
const ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWLIST_CACHE_MAX = 100;
const allowlistCache = new Map<string, number>(); // uid -> expiresAt

/** True when `uid` is in `allowedUsers`. Always true in local mode. */
export async function isInAllowedUsers(uid: string): Promise<boolean> {
  if (isLocalMode()) return true;

  const expiresAt = lruTouch(allowlistCache, uid);
  if (expiresAt !== undefined && expiresAt > Date.now()) return true;

  const snap = await getFirestore().collection(ALLOWED_USERS_COLLECTION).doc(uid).get();
  if (!snap.exists) {
    allowlistCache.delete(uid);
    return false;
  }
  lruEvictIfFull(allowlistCache, ALLOWLIST_CACHE_MAX);
  allowlistCache.set(uid, Date.now() + ALLOWLIST_CACHE_TTL_MS);
  return true;
}
