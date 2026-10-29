import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, isAdmin, isAllowedAccount, type AuthUser } from '@/lib/auth';
import { isLocalMode } from '@/lib/env';
import { getUserAccess } from '@/lib/user-store';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/me - The signed-in user's access: whether they may run
 * simulations, are an admin, or have asked for access. Any signed-in user
 * may call it; the web app uses it to decide what to show.
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
