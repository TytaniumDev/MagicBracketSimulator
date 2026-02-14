import { NextRequest, NextResponse } from 'next/server';
import { isMoxfieldApiEnabled } from '@/lib/moxfield-service';

/**
 * GET /api/moxfield-status - Check if Moxfield API direct import is available
 *
 * Returns { enabled: boolean } so frontend can adapt the UI accordingly.
 * When disabled, users must manually paste their deck list for Moxfield decks.
 * ?debug=1 returns safe env diagnostics (hasEnv, envLength) for troubleshooting.
 */
export async function GET(request: NextRequest) {
  const enabled = isMoxfieldApiEnabled();
  const ua = process.env.MOXFIELD_USER_AGENT;
  const hasEnv = ua !== undefined && ua !== null;
  const envLength = typeof ua === 'string' ? ua.trim().length : 0;

  const url = new URL(request.url);
  const body: { enabled: boolean; debug?: { hasEnv: boolean; envLength: number } } = { enabled };
  if (url.searchParams.get('debug') === '1') {
    body.debug = { hasEnv, envLength };
  }

  return NextResponse.json(body);
}
