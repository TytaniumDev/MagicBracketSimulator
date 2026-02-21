import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';

const WORKER_SECRET = process.env.WORKER_SECRET;

/**
 * Generate a stateless HMAC-based setup token.
 * Token format: base64( timestamp + "." + hmac-sha256(timestamp, WORKER_SECRET)[0:32] )
 */
function generateToken(): string {
  if (!WORKER_SECRET) throw new Error('WORKER_SECRET not configured');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmac = crypto.createHmac('sha256', WORKER_SECRET)
    .update(timestamp).digest('hex').slice(0, 32);
  return Buffer.from(`${timestamp}.${hmac}`).toString('base64');
}

/**
 * POST /api/worker-setup/token
 * Generates a time-limited setup token for bootstrapping a remote worker.
 * Requires an allowed user (Firebase auth).
 */
export async function POST(req: NextRequest) {
  try {
    await verifyAuth(req);
  } catch {
    return unauthorizedResponse();
  }

  if (!WORKER_SECRET) {
    return NextResponse.json(
      { error: 'Worker setup not configured (WORKER_SECRET missing)' },
      { status: 500 },
    );
  }

  const token = generateToken();

  const scriptUrl = 'https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main/scripts/setup-worker.sh';

  // API_URL is always set in production (Cloud Run env or Secret Manager)
  const apiUrl = process.env.API_URL
    || `https://api--${process.env.GOOGLE_CLOUD_PROJECT}.us-central1.hosted.app`;

  return NextResponse.json({
    token,
    expiresIn: '24 hours',
    apiUrl,
    scriptUrl,
  });
}
