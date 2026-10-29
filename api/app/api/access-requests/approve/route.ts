import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { approveUser } from '@/lib/user-store';
import * as Sentry from '@sentry/nextjs';

const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

function htmlResponse(statusCode: number, title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0;}
.card{background:#2d2d44;border-radius:12px;padding:2rem;max-width:480px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.3);}
.success{color:#4ade80;} .error{color:#f87171;}
</style></head>
<body><div class="card">${body}</div></body></html>`,
    {
      status: statusCode,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

function validateToken(tokenB64: string): { uid: string } | null {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return null;

  try {
    const decoded = Buffer.from(tokenB64, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;

    const [uid, requestId, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > TOKEN_EXPIRY_SECONDS) return null;

    // Verify signature
    const payload = `${uid}:${requestId}:${timestampStr}`;
    const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');

    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSig, 'base64url');

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    return { uid };
  } catch {
    return null;
  }
}

/**
 * GET /api/access-requests/approve?token=... — Admin clicks from email to approve a user.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return htmlResponse(400, 'Invalid Link',
      '<h2 class="error">Invalid approval link</h2><p>No token provided.</p>');
  }

  const parsed = validateToken(token);
  if (!parsed) {
    return htmlResponse(400, 'Invalid or Expired',
      '<h2 class="error">Invalid or Expired Link</h2><p>This approval link is invalid or has expired (24-hour limit). Ask the user to submit a new request.</p>');
  }

  const { uid } = parsed;

  try {
    const before = await approveUser(uid);
    if (!before) {
      return htmlResponse(404, 'Not Found',
        '<h2 class="error">Request Not Found</h2><p>This access request no longer exists.</p>');
    }

    if (before.status === 'allowed') {
      return htmlResponse(200, 'Already Approved',
        `<h2 class="success">Already Approved</h2><p><strong>${before.email}</strong> was already approved.</p>`);
    }

    return htmlResponse(200, 'User Approved',
      `<h2 class="success">User Approved!</h2><p><strong>${before.email}</strong> can now submit simulations on Magic Bracket Simulator.</p>`);
  } catch (error) {
    Sentry.captureException(error, { tags: { component: 'access-request-approve' } });
    console.error('GET /api/access-requests/approve error:', error);
    return htmlResponse(500, 'Error',
      '<h2 class="error">Something went wrong</h2><p>Failed to approve user. Please try again or approve manually via the Firebase Console.</p>');
  }
}
