import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getStructuredLogs } from '@/lib/log-store';
import * as jobStore from '@/lib/job-store-factory';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/structured — Return structured games for UI visualization.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;

    // Fetch job upfront for deck name hints so we only call getStructuredLogs once
    const job = await jobStore.getJob(id);
    const deckNames = job?.decks?.map((d) => d.name);
    const result = await getStructuredLogs(id, deckNames && deckNames.length > 0 ? deckNames : undefined);

    if (!result) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/structured error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get structured logs' },
      { status: 500 }
    );
  }
}
