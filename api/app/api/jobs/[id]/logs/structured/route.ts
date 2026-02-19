import { NextRequest, NextResponse } from 'next/server';
import { getStructuredLogs } from '@/lib/log-store';
import * as jobStore from '@/lib/job-store-factory';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/structured — Return structured games for UI visualization.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Try without hints first; if null, fetch job for deck names and retry
    let result = await getStructuredLogs(id);
    if (!result) {
      const job = await jobStore.getJob(id);
      const deckNames = job?.decks?.map((d) => d.name);
      if (deckNames && deckNames.length > 0) {
        result = await getStructuredLogs(id, deckNames);
      }
    }

    if (!result) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/structured error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get structured logs' },
      { status: 500 }
    );
  }
}
