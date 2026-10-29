import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

import { isLocalMode } from './env';
import { getFirebaseAdminApp } from './firebase-admin-app';
import { isInAllowedUsers } from './allowed-users';

// Local mode: skip Firebase Auth entirely when GOOGLE_CLOUD_PROJECT is not set
const IS_LOCAL_MODE = isLocalMode();

const LOCAL_MOCK_USER: AuthUser = { uid: 'local-user', email: 'local@dev' };


export interface AuthUser {
  uid: string;
  email: string;
}

// Extra pre-approved emails (comma-separated), on top of approved users
const ALLOWED_EMAILS: string[] = process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [];

// Admin email list - parsed from ADMIN_EMAILS env var (comma-separated)
const ADMIN_EMAILS: string[] = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [];

/**
 * May this account run simulations? True for admins, emails in ALLOWED_EMAILS,
 * and users approved through an access request (see user-store.ts).
 * `lookup` is injectable for tests.
 */
export async function isAllowedAccount(
  uid: string,
  email: string,
  lookup: (uid: string) => Promise<boolean> = isInAllowedUsers,
): Promise<boolean> {
  const normalized = email.toLowerCase();
  if (isAdmin(normalized) || ALLOWED_EMAILS.includes(normalized)) return true;
  return lookup(uid);
}

/**
 * Check if an email is an admin. Always true in local mode.
 */
export function isAdmin(email: string): boolean {
  if (IS_LOCAL_MODE) return true;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Tier 1: Verify that the request is from any signed-in Google user.
 * Does NOT check the allowlist — any valid Firebase token is accepted.
 * Used for read-only endpoints that any authenticated user can access.
 * @throws Error if token is missing or invalid
 */
export async function verifyAuth(req: NextRequest): Promise<AuthUser> {
  if (IS_LOCAL_MODE) {
    return LOCAL_MOCK_USER;
  }

  // App Check disabled per user request (Firebase Auth is sufficient for this app)
  // await verifyAppCheck(req);

  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    throw new Error('Empty authorization token');
  }

  return verifyTokenString(token);
}

/**
 * Verify a raw Firebase ID token string (not from request headers).
 * Used by SSE stream route where the token arrives as a query parameter.
 * @throws Error if token is invalid
 */
export async function verifyTokenString(token: string): Promise<AuthUser> {
  if (IS_LOCAL_MODE) {
    return LOCAL_MOCK_USER;
  }

  try {
    getFirebaseAdminApp();
    const decoded: DecodedIdToken = await getAuth().verifyIdToken(token);

    if (!decoded.email) {
      throw new Error('Token does not contain email');
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('email')) {
      throw error;
    }
    throw new Error(
      `Invalid token: ${error instanceof Error ? error.message : 'unknown'}`,
      { cause: error }
    );
  }
}

/**
 * Tier 2: Verify that the request is from a signed-in user on the allowlist.
 * Used for privileged write operations (create jobs, add decks, cancel, etc.).
 * @throws Error if token is invalid or user not on allowlist
 */
export async function verifyAllowedUser(req: NextRequest): Promise<AuthUser> {
  // In local mode, skip Firebase token verification and return a mock user
  if (IS_LOCAL_MODE) {
    return LOCAL_MOCK_USER;
  }

  // App Check disabled per user request (Firebase Auth is sufficient for this app)
  // await verifyAppCheck(req);

  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    throw new Error('Empty authorization token');
  }

  try {
    getFirebaseAdminApp();
    const decoded: DecodedIdToken = await getAuth().verifyIdToken(token);

    if (!decoded.email) {
      throw new Error('Token does not contain email');
    }

    if (!(await isAllowedAccount(decoded.uid, decoded.email))) {
      throw new Error('User not in allowlist');
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw auth-specific errors
      if (error.message.includes('allowlist') || error.message.includes('email')) {
        throw error;
      }
      throw new Error(`Invalid token: ${error.message}`, { cause: error });
    }
    throw new Error('Token verification failed', { cause: error });
  }
}

/**
 * Tier 3: Verify that the request is from an admin user.
 * Calls verifyAuth() (token-only, no allowlist) then checks admin email list.
 * Admins don't need to be separately on the allowlist.
 * @throws Error with 'Admin access required' if not admin
 */
export async function verifyAdmin(req: NextRequest): Promise<AuthUser> {
  const user = await verifyAuth(req);
  if (!isAdmin(user.email)) {
    throw new Error('Admin access required');
  }
  return user;
}

/**
 * Optional allowed-user auth - returns user if authenticated and on allowlist, null otherwise.
 * Does not throw on missing/invalid token.
 */
export async function optionalAllowedUser(req: NextRequest): Promise<AuthUser | null> {
  try {
    return await verifyAllowedUser(req);
  } catch {
    return null;
  }
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create a 403 Forbidden response
 */
export function forbiddenResponse(message: string = 'Forbidden'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Check if request is from worker (X-Worker-Secret header matches WORKER_SECRET env)
 * Used for PATCH/GET jobs by worker and misc-runner
 */
export function isWorkerRequest(req: NextRequest): boolean {
  const secret = req.headers.get('X-Worker-Secret');
  const expected = process.env.WORKER_SECRET;

  if (!expected || !secret) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  const secretHash = createHash('sha256').update(secret).digest();
  const expectedHash = createHash('sha256').update(expected).digest();

  return timingSafeEqual(secretHash, expectedHash);
}


