/**
 * Is a user approved? Reads their access record (user-store.ts); users are
 * approved when an admin clicks the approve link in an access-request email
 * (`/api/access-requests/approve`).
 */
import { isLocalMode } from './env';
import { getUserAccess } from './user-store';
import { lruEvictIfFull, lruTouch } from './lru';

// A job's worth of worker uploads (and every API call from the web app)
// checks the same uid repeatedly, so remember positive lookups briefly. Revoking a user takes effect within the TTL.
const ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWLIST_CACHE_MAX = 100;
const allowlistCache = new Map<string, number>(); // uid -> expiresAt

/** True when `uid` has been given access. Always true in local mode. */
export async function isInAllowedUsers(uid: string): Promise<boolean> {
  if (isLocalMode()) return true;

  const expiresAt = lruTouch(allowlistCache, uid);
  if (expiresAt !== undefined && expiresAt > Date.now()) return true;

  if ((await getUserAccess(uid))?.status !== 'allowed') {
    allowlistCache.delete(uid);
    return false;
  }
  lruEvictIfFull(allowlistCache, ALLOWLIST_CACHE_MAX);
  allowlistCache.set(uid, Date.now() + ALLOWLIST_CACHE_TTL_MS);
  return true;
}
