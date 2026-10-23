/**
 * Auth for the worker endpoints that the Flutter desktop worker also calls
 * (per-sim log upload and the aggregate-if-done fast path).
 *
 * The Docker worker sends the shared WORKER_SECRET. The desktop worker never
 * has that secret; instead it runs signed in as its owner and sends that
 * user's Firebase ID token. A token is accepted only when its uid is in the
 * Firestore `allowedUsers` collection, the same allowlist the Firestore rules
 * and the frontend use. (`verifyAllowedUser` checks the ALLOWED_EMAILS env
 * var, which is unset in prod, so it would let any Google account through.)
 */
import type { NextRequest } from 'next/server';
import { isWorkerRequest, verifyAuth, type AuthUser } from './auth';
import { isLocalMode } from './env';
import { getFirestore } from './firestore-client';
import { lruEvictIfFull, lruTouch } from './lru';

const ALLOWED_USERS_COLLECTION = 'allowedUsers';

// A job's worth of uploads checks the same uid ~50 times, so remember
// positive lookups briefly. Revoking a user takes effect within the TTL.
const ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWLIST_CACHE_MAX = 100;
const allowlistCache = new Map<string, number>(); // uid -> expiresAt

async function isInAllowedUsers(uid: string): Promise<boolean> {
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

export interface WorkerAuthDeps {
  isWorkerRequest: (req: NextRequest) => boolean;
  verifyAuth: (req: NextRequest) => Promise<AuthUser>;
  isInAllowedUsers: (uid: string) => Promise<boolean>;
}

const defaultDeps: WorkerAuthDeps = { isWorkerRequest, verifyAuth, isInAllowedUsers };

/**
 * True when the request carries the worker secret, or a valid Firebase ID
 * token for a user in `allowedUsers`. Never throws.
 */
export async function isWorkerOrAllowlistedUser(
  req: NextRequest,
  deps: WorkerAuthDeps = defaultDeps,
): Promise<boolean> {
  if (deps.isWorkerRequest(req)) return true;
  if (!req.headers.get('Authorization')) return false;
  try {
    const user = await deps.verifyAuth(req);
    return await deps.isInAllowedUsers(user.uid);
  } catch {
    return false;
  }
}
