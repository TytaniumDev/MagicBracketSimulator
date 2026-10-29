import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth';
import { deleteJobCompletely } from '@/lib/job-delete';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * POST /api/jobs/bulk-delete - Bulk delete jobs (admin only)
 * Body: { jobIds: string[] } — max 50 per request
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Admin access required')) {
      return forbiddenResponse('Admin access required');
    }
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { jobIds } = body;

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return badRequestResponse('jobIds must be a non-empty array');
    }

    if (jobIds.length > 50) {
      return badRequestResponse('Maximum 50 jobs per request');
    }

    // ⚡ Bolt Performance Optimization:
    // Process bulk deletions in parallel to eliminate N+1 network/DB bottlenecks
    const results = await Promise.all(
      jobIds.map(async (id: string) => {
        try {
          if (!(await deleteJobCompletely(id))) {
            return { id, deleted: false, error: 'Not found' };
          }
          return { id, deleted: true };
        } catch (err) {
          Sentry.captureException(err, { tags: { component: 'bulk-delete', jobId: id } });
          return {
            id,
            deleted: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      })
    );

    const deletedCount = results.filter((r) => r.deleted).length;
    return NextResponse.json({ deletedCount, results });
  } catch (error) {
    console.error('POST /api/jobs/bulk-delete error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/jobs/bulk-delete' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete jobs', 500);
  }
}
