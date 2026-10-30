import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, isAdmin, isAllowedAccount, isPreapprovedEmail, type AuthUser } from '@/lib/auth';
import { isLocalMode } from '@/lib/env';
import { ensureAllowed, getUserAccess } from '@/lib/user-store';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

// Pre-approved accounts this instance has already given an access record.
const recordedPreapproved = new Set<string>();

/**
 * GET /api/me - The signed-in user's access: whether they may use the app,
 * are an admin, or have asked for access. Any signed-in user may call it;
 * the web app uses it to decide what to show.
 *
 * A pre-approved account (admin or ALLOWED_EMAILS) gets an allowed
 * users/{uid} record on its first call, since the Firestore rules decide
 * who may read from that record alone.
 */
export async function GET(req: NextRequest) {
  let user: AuthUser;
  try {
    user = await verifyAuth(req);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const isAllowed = await isAllowedAccount(user.uid, user.email);
    if (!isLocalMode() && isPreapprovedEmail(user.email) && !recordedPreapproved.has(user.uid)) {
      await ensureAllowed(user.uid, user.email);
      recordedPreapproved.add(user.uid);
    }
    const access = isLocalMode() || isAllowed ? null : await getUserAccess(user.uid);
    return NextResponse.json({
      email: user.email,
      uid: user.uid,
      isAdmin: isAdmin(user.email),
      isAllowed,
      hasRequestedAccess: access?.status === 'requested',
    });
  } catch (error) {
    console.error('GET /api/me error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/me' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to load user', 500);
  }
}
