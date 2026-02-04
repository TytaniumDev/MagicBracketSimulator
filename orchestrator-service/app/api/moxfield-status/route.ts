import { NextResponse } from 'next/server';
import { isMoxfieldApiEnabled } from '@/lib/moxfield-service';

/**
 * GET /api/moxfield-status - Check if Moxfield API direct import is available
 *
 * Returns { enabled: boolean } so frontend can adapt the UI accordingly.
 * When disabled, users must manually paste their deck list for Moxfield decks.
 */
export async function GET() {
  return NextResponse.json({ enabled: isMoxfieldApiEnabled() });
}
