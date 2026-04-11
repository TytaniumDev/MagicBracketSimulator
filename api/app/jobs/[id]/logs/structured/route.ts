import { NextRequest, NextResponse } from 'next/server';
import { optionalAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { getRawLogs } from '@/lib/gcs-storage';
import { getJob } from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import { structureGames } from '@/lib/condenser';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /jobs/[id]/logs/structured - Get structured logs from GCS (GCP mode only)
 * Builds structured from raw logs using forge-log-analyzer
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isGcpMode()) {
    return NextResponse.json({ error: 'Not available in local mode' }, { status: 404 });
  }

  try {
    const user = await optionalAllowedUser(request);
    if (!user) {
      return unauthorizedResponse();
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const rawLogs = await getRawLogs(id);
    if (!rawLogs || rawLogs.length === 0) {
      return NextResponse.json({ error: 'Raw logs not found' }, { status: 404 });
    }

    const deckNames = job.decks.map((d) => d.name);
    const structured = structureGames(rawLogs, deckNames);

    return NextResponse.json({ games: structured });
  } catch (error) {
    console.error('GET /jobs/[id]/logs/structured error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get structured logs' },
      { status: 500 }
    );
  }
}
