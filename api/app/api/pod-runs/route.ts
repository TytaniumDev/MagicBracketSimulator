import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAllowedUser, unauthorizedResponse, AuthUser } from '@/lib/auth';
import { getPodRunStore } from '@/lib/pod-run-store-factory';
import { podRunToSummary } from '@/lib/pod-run-utils';
import { resolveJobSeats } from '@/lib/job-seats';
import { parseBody, createPodRunSchema } from '@/lib/validation';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;

/**
 * GET /api/pod-runs - List pod runs, most recent first
 * Query params: ?limit=N (default 10, max 50), or ?jobId=<id> for the runs
 * that include that job.
 * Returns: { podRuns: PodRunSummary[] }
 */
export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIST_LIMIT;
    if (!Number.isFinite(limit) || limit <= 0) {
      return badRequestResponse('limit must be a positive integer');
    }

    const store = await getPodRunStore();
    const runs = jobId
      ? await store.listPodRunsForJob(jobId)
      : await store.listPodRuns(Math.min(limit, MAX_LIST_LIMIT));
    return NextResponse.json({ podRuns: runs.map(podRunToSummary) });
  } catch (error) {
    console.error('GET /api/pod-runs error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/pod-runs' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to list pod runs', 500);
  }
}

/**
 * POST /api/pod-runs - Save a pod run once its jobs are queued
 * Body: { deckIds, jobIds, simulations, idempotencyKey? }
 * Returns: { id }
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  let user: AuthUser;
  try {
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = parseBody(createPodRunSchema, body);
    if (!parsed.success) {
      return badRequestResponse(parsed.error);
    }
    const { deckIds, jobIds, simulations, idempotencyKey } = parsed.data;

    const { seats, errors } = await resolveJobSeats(deckIds);
    if (errors.length > 0) {
      return badRequestResponse(`Invalid deck IDs: ${errors.join(', ')}`);
    }

    const run = await (await getPodRunStore()).createPodRun({
      deckIds,
      deckNames: seats.map((s) => s.name),
      jobIds,
      simulations,
      createdBy: user.uid,
      idempotencyKey,
    });
    return NextResponse.json({ id: run.id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/pod-runs error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/pod-runs' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to save pod run', 500);
  }
}
