import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { getCoverageStatus } from '@/lib/coverage-service';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/coverage/status — coverage progress summary (any authenticated user)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const config = await (await getCoverageStore()).getConfig();
    const status = await getCoverageStatus(config.targetGamesPerPair);
    return NextResponse.json(status);
  } catch (error) {
    console.error('GET /api/coverage/status error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/coverage/status' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to get coverage status', 500);
  }
}
