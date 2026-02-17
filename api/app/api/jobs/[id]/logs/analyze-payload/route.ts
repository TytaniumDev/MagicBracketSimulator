import { NextRequest, NextResponse } from 'next/server';
import { optionalAuth, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import { getAnalyzePayloadData } from '@/lib/log-store';
import * as jobStore from '@/lib/job-store-factory';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/analyze-payload — Return the Gemini analysis payload.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    const user = await optionalAuth(request);
    if (!user) return unauthorizedResponse();
  }

  try {
    const { id } = await params;

    // Try without hints first; if null, fetch job for deck info and retry
    let payload = await getAnalyzePayloadData(id);
    if (!payload) {
      const job = await jobStore.getJob(id);
      const deckNames = job?.decks?.map((d) => d.name);
      const deckLists = job?.decks?.map((d) => d.dck ?? '');
      if (deckNames && deckNames.length > 0) {
        payload = await getAnalyzePayloadData(id, deckNames, deckLists);
      }
    }

    if (!payload) {
      return NextResponse.json({ error: 'Analyze payload not found for this job' }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/analyze-payload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get analyze payload' },
      { status: 500 }
    );
  }
}
