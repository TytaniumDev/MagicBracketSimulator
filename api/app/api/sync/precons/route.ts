/**
 * POST /api/sync/precons - Trigger Archidekt precon sync.
 * Protected by WORKER_SECRET header (or local mode).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { syncPrecons } from '@/lib/archidekt-sync';
import { errorResponse } from '@/lib/api-response';

const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

export async function POST(req: NextRequest) {
  // In GCP mode, require worker secret
  if (!IS_LOCAL_MODE && !isWorkerRequest(req)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const result = await syncPrecons();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[SyncPrecons] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Sync failed', 500);
  }
}
