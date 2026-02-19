import { NextRequest, NextResponse } from 'next/server';
import { getAnalyzePayloadData } from '@/lib/log-store';
import { buildPromptPreview } from '@/lib/gemini';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/analyze-prompt-preview — Return the exact prompts that would be sent to Gemini.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const payload = await getAnalyzePayloadData(id);
    if (!payload) {
      return NextResponse.json({ error: 'Analyze payload not found for this job' }, { status: 404 });
    }

    const preview = await buildPromptPreview(payload);
    return NextResponse.json(preview);
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/analyze-prompt-preview error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build prompt preview' },
      { status: 500 }
    );
  }
}
