/**
 * Auth for the worker endpoints that the Flutter desktop worker also calls
 * (per-sim log upload and the aggregate-if-done fast path).
 *
 * The Docker worker sends the shared WORKER_SECRET. The desktop worker never
 * has that secret; instead it runs signed in as its owner and sends that
 * user's Firebase ID token. A token is accepted only when that user has been
 * given access (see user-store.ts).
 */
import type { NextRequest } from 'next/server';
import { isWorkerRequest, verifyAuth, type AuthUser } from './auth';
import { isInAllowedUsers } from './allowed-users';

export interface WorkerAuthDeps {
  isWorkerRequest: (req: NextRequest) => boolean;
  verifyAuth: (req: NextRequest) => Promise<AuthUser>;
  isInAllowedUsers: (uid: string) => Promise<boolean>;
}

const defaultDeps: WorkerAuthDeps = { isWorkerRequest, verifyAuth, isInAllowedUsers };

/**
 * True when the request carries the worker secret, or a valid Firebase ID
 * token for a user who has been given access. Never throws.
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
