import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';

// Local mode: skip Firebase Auth entirely when GOOGLE_CLOUD_PROJECT is not set
const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

const LOCAL_MOCK_USER: AuthUser = { uid: 'local-user', email: 'local@dev' };

// Initialize Firebase Admin SDK (singleton) — only used in GCP mode
let firebaseApp: App | undefined;

function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  // Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS or ADC)
  // In Cloud Run, this uses the service account automatically
  // For local dev, set GOOGLE_APPLICATION_CREDENTIALS to firebase-admin-key.json
  if (process.env.FIREBASE_ADMIN_KEY) {
    // If key is provided as JSON string (e.g., from Secret Manager)
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  } else {
    // Use Application Default Credentials
    firebaseApp = initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  }

  return firebaseApp;
}

export interface AuthUser {
  uid: string;
  email: string;
}

// Email allowlist - can be loaded from Firestore or env var
const ALLOWED_EMAILS: string[] = process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [];

// If allowlist is empty, allow all authenticated users (dev mode)
const ALLOWLIST_ENABLED = ALLOWED_EMAILS.length > 0;

// Admin email list - parsed from ADMIN_EMAILS env var (comma-separated)
const ADMIN_EMAILS: string[] = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [];

/**
 * Check if an email is an admin. Always true in local mode.
 */
export function isAdmin(email: string): boolean {
  if (IS_LOCAL_MODE) return true;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * Verify that the request is from an admin user.
 * Calls verifyAuth() first, then checks isAdmin().
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
 * Verify Firebase ID token from request
 * @param req Next.js request object
 * @returns Decoded user info if valid
 * @throws Error if token is invalid or user not allowed
 */
export async function verifyAuth(req: NextRequest): Promise<AuthUser> {
  // In local mode, skip Firebase token verification and return a mock user
  if (IS_LOCAL_MODE) {
    return LOCAL_MOCK_USER;
  }

  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('Empty authorization token');
  }

  try {
    getFirebaseApp();
    const decoded: DecodedIdToken = await getAuth().verifyIdToken(token);
    
    if (!decoded.email) {
      throw new Error('Token does not contain email');
    }

    // Check allowlist if enabled
    if (ALLOWLIST_ENABLED && !ALLOWED_EMAILS.includes(decoded.email.toLowerCase())) {
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
      throw new Error(`Invalid token: ${error.message}`);
    }
    throw new Error('Token verification failed');
  }
}

/**
 * Optional auth - returns user if authenticated, null otherwise
 * Does not throw on missing/invalid token
 */
export async function optionalAuth(req: NextRequest): Promise<AuthUser | null> {
  try {
    return await verifyAuth(req);
  } catch {
    return null;
  }
}

/**
 * Verify Firebase ID token without checking the allowlist.
 * Used for endpoints that any authenticated user can access (e.g., access requests).
 */
export async function verifyAuthOnly(req: NextRequest): Promise<AuthUser> {
  if (IS_LOCAL_MODE) {
    return LOCAL_MOCK_USER;
  }

  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No authorization token provided');
  }

  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    throw new Error('Empty authorization token');
  }

  try {
    getFirebaseApp();
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
    throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'unknown'}`);
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
