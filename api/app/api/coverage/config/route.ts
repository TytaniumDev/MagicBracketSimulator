import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/coverage/config — read coverage config (any authenticated user)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const config = await getCoverageStore().getConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error('GET /api/coverage/config error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get config', 500);
  }
}

/**
 * PATCH /api/coverage/config — update coverage config (admin only)
 */
export async function PATCH(request: NextRequest) {
  let user;
  try {
    user = await verifyAdmin(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid or missing JSON body', 400);
    const update: { enabled?: boolean; targetGamesPerPair?: number } = {};

    if (typeof body.enabled === 'boolean') {
      update.enabled = body.enabled;
    }
    if (typeof body.targetGamesPerPair === 'number') {
      if (body.targetGamesPerPair < 1 || body.targetGamesPerPair > 10000) {
        return errorResponse('targetGamesPerPair must be between 1 and 10000', 400);
      }
      update.targetGamesPerPair = body.targetGamesPerPair;
    }

    if (Object.keys(update).length === 0) {
      return errorResponse('No valid fields to update', 400);
    }

    const config = await getCoverageStore().updateConfig(update, user.email);
    return NextResponse.json(config);
  } catch (error) {
    console.error('PATCH /api/coverage/config error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to update config', 500);
  }
}
