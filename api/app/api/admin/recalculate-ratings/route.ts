import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { rebuildRatingsFromHistory } from '@/lib/glicko2-rebuild';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (_err) {
    return unauthorizedResponse('Admin access required');
  }

  try {
    await rebuildRatingsFromHistory();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Rebuild] error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Error rebuilding', 500);
  }
}
