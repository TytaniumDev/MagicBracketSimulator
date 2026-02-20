import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, isAdmin } from '@/lib/auth';

/**
 * GET /api/me - Returns the current user's info including admin status
 */
export async function GET(req: NextRequest) {
  try {
    const user = await verifyAuth(req);
    return NextResponse.json({
      email: user.email,
      uid: user.uid,
      isAdmin: isAdmin(user.email),
    });
  } catch {
    return unauthorizedResponse();
  }
}
