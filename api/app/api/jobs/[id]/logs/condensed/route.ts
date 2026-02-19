import { NextRequest, NextResponse } from 'next/server';
import { getCondensedLogs } from '@/lib/log-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/condensed — Return condensed game data.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const condensed = await getCondensedLogs(id);
    if (!condensed) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json({ condensed });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/condensed error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get condensed logs' },
      { status: 500 }
    );
  }
}
