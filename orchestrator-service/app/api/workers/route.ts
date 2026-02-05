import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listWorkers, getCurrentRefreshId } from '@/lib/worker-store-factory';

/**
 * GET /api/workers - List workers that responded to the latest report-in request
 * Auth: Firebase verifyAuth
 * Returns workers where refreshId === currentRefreshId (only workers that responded to last refresh).
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const workers = await listWorkers();
    const refreshId = await getCurrentRefreshId();
    return NextResponse.json({ workers, refreshId: refreshId || undefined });
  } catch (error) {
    console.error('Failed to list workers:', error);
    return NextResponse.json(
      { error: 'Failed to list workers' },
      { status: 500 }
    );
  }
}
