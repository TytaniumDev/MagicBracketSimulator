import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { deleteJobArtifacts } from '@/lib/gcs-storage';
import { isGcpMode } from '@/lib/deck-store-factory';

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
      return NextResponse.json({ error: 'jobIds must be a non-empty array' }, { status: 400 });
    }

    if (jobIds.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 jobs per request' }, { status: 400 });
    }

    const results: { id: string; deleted: boolean; error?: string }[] = [];

    for (const id of jobIds) {
      try {
        const job = await jobStore.getJob(id);
        if (!job) {
          results.push({ id, deleted: false, error: 'Not found' });
          continue;
        }

        // Cancel if still active
        if (job.status === 'QUEUED' || job.status === 'RUNNING') {
          await jobStore.cancelJob(id);
        }

        // Delete simulation subcollection first (Firestore doesn't cascade)
        await jobStore.deleteSimulations(id);
        await jobStore.deleteJob(id);

        if (isGcpMode()) {
          try {
            await deleteJobArtifacts(id);
          } catch (err) {
            console.warn(`Failed to delete GCS artifacts for ${id}:`, err);
          }
        }

        results.push({ id, deleted: true });
      } catch (err) {
        results.push({
          id,
          deleted: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const deletedCount = results.filter((r) => r.deleted).length;
    return NextResponse.json({ deletedCount, results });
  } catch (error) {
    console.error('POST /api/jobs/bulk-delete error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete jobs' },
      { status: 500 }
    );
  }
}
