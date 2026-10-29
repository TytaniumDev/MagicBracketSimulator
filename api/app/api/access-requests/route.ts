import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, AuthUser } from '@/lib/auth';
import { sendAccessRequestEmail } from '@/lib/email-notification';
import { createHmac } from 'node:crypto';
import { getUserAccess, requestAccess } from '@/lib/user-store';
import { errorResponse } from '@/lib/api-response';

import { isLocalMode } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';

const IS_LOCAL_MODE = isLocalMode();

/**
 * Signed `uid:requestId:timestamp:signature`. Requests now live at
 * users/{uid}, so requestId is the uid; the approve route only uses the uid.
 */
function generateApprovalToken(uid: string, requestId: string): string {
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new Error('WORKER_SECRET not configured');

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${uid}:${requestId}:${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

/**
 * POST /api/access-requests — Submit an access request.
 * Any authenticated user can request access (no allowlist check).
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  let user: AuthUser;
  try {
    user = await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : null;

    if (IS_LOCAL_MODE) {
      return NextResponse.json(
        { message: 'Access request submitted (local mode)' },
        { status: 201 }
      );
    }

    const displayName = typeof body.displayName === 'string' ? body.displayName : null;
    const previous = await requestAccess(user.uid, { email: user.email, displayName, message });
    if (previous === 'requested') {
      return NextResponse.json(
        { message: 'You already have a pending access request' },
        { status: 200 }
      );
    }
    if (previous === 'allowed') {
      return NextResponse.json({ message: 'You already have access' }, { status: 200 });
    }

    // Generate approval token and send email
    try {
      const token = generateApprovalToken(user.uid, user.uid);
      const apiOrigin = new URL(request.url).origin;
      const approveUrl = `${apiOrigin}/api/access-requests/approve?token=${token}`;

      await sendAccessRequestEmail({
        requesterEmail: user.email,
        requesterName: displayName,
        message,
        approveUrl,
      });
    } catch (emailError) {
      Sentry.captureException(emailError, { tags: { component: 'access-request-email' } });
      console.error('[AccessRequest] Failed to send email notification:', emailError);
    }

    return NextResponse.json(
      { message: 'Access request submitted' },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/access-requests error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/access-requests' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to submit access request', 500);
  }
}

/**
 * GET /api/access-requests — Check if the current user has a pending request.
 */
export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  let user: AuthUser;
  try {
    user = await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    if (IS_LOCAL_MODE) {
      return NextResponse.json({ hasRequest: false, status: null });
    }

    const access = await getUserAccess(user.uid);
    if (!access) {
      return NextResponse.json({ hasRequest: false, status: null });
    }
    // 'pending' and 'approved' are the statuses this endpoint has always returned.
    return NextResponse.json({ hasRequest: true, status: access.status === 'allowed' ? 'approved' : 'pending' });
  } catch (error) {
    console.error('GET /api/access-requests error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/access-requests' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to check access request', 500);
  }
}
