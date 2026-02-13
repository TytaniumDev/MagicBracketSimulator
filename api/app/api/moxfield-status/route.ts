import { NextResponse } from 'next/server';
import { isMoxfieldApiEnabled } from '@/lib/moxfield-service';

/**
 * GET /api/moxfield-status - Check if Moxfield API direct import is available
 *
 * Returns { enabled: boolean } so frontend can adapt the UI accordingly.
 * When disabled, users must manually paste their deck list for Moxfield decks.
 */
export async function GET() {
  const enabled = isMoxfieldApiEnabled();
  // #region agent log
  try {
    fetch('http://127.0.0.1:1026/ingest/11c89cba-1ae5-4e5d-9178-21fb760379c4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'api/app/api/moxfield-status/route.ts:GET', message: 'moxfield-status response', data: { enabled }, timestamp: Date.now(), hypothesisId: 'A' }) }).catch(() => {});
  } catch (_) {}
  // #endregion
  return NextResponse.json({ enabled });
}
