import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { getCoverageStatus } from '@/lib/coverage-service';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/coverage/status — coverage progress summary (any authenticated user)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const config = await getCoverageStore().getConfig();
    const status = await getCoverageStatus(config.targetGamesPerPair);
    return NextResponse.json(status);
  } catch (error) {
    console.error('GET /api/coverage/status error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get coverage status', 500);
  }
}
