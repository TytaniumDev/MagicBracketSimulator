import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { sendAccessRequestEmail } from '@/lib/email-notification';
import { createHmac } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { errorResponse } from '@/lib/api-response';

const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

let _firestore: Firestore | null = null;
function getDb(): Firestore {
  if (!_firestore) {
    _firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  }
  return _firestore;
}

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
export async function POST(request: NextRequest) {
  let user;
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

    const db = getDb();

    // Check for existing pending request
    const existing = await db.collection('accessRequests')
      .where('uid', '==', user.uid)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { message: 'You already have a pending access request' },
        { status: 200 }
      );
    }

    // Create access request document
    const docRef = db.collection('accessRequests').doc();
    await docRef.set({
      uid: user.uid,
      email: user.email,
      displayName: body.displayName || null,
      message,
      status: 'pending',
      createdAt: new Date(),
      resolvedAt: null,
    });

    // Generate approval token and send email
    try {
      const token = generateApprovalToken(user.uid, docRef.id);
      const apiOrigin = new URL(request.url).origin;
      const approveUrl = `${apiOrigin}/api/access-requests/approve?token=${token}`;

      await sendAccessRequestEmail({
        requesterEmail: user.email,
        requesterName: body.displayName || null,
        message,
        approveUrl,
      });
    } catch (emailError) {
      console.error('[AccessRequest] Failed to send email notification:', emailError);
    }

    return NextResponse.json(
      { message: 'Access request submitted' },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/access-requests error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to submit access request', 500);
  }
}

/**
 * GET /api/access-requests — Check if the current user has a pending request.
 */
export async function GET(request: NextRequest) {
  let user;
  try {
    user = await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    if (IS_LOCAL_MODE) {
      return NextResponse.json({ hasRequest: false, status: null });
    }

    const db = getDb();
    const snap = await db.collection('accessRequests')
      .where('uid', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ hasRequest: false, status: null });
    }

    const doc = snap.docs[0].data();
    return NextResponse.json({ hasRequest: true, status: doc.status });
  } catch (error) {
    console.error('GET /api/access-requests error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to check access request', 500);
  }
}
