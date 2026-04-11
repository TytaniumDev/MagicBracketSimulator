import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import { uploadSingleSimulationLog, MAX_LOG_BYTES } from '@/lib/log-store';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// JSON envelope overhead (`{"filename":"…","logText":"…"}` plus escaping).
// Used to cap the Content-Length rejection above the raw log payload cap.
const ENVELOPE_OVERHEAD_BYTES = 4 * 1024;

function payloadTooLargeResponse(bytes: number) {
  return NextResponse.json(
    { error: `Payload too large: ${bytes} bytes exceeds max of ${MAX_LOG_BYTES} bytes` },
    { status: 413 }
  );
}

/**
 * POST /api/jobs/[id]/logs/simulation — Upload a single simulation's raw log.
 * Called by the worker incrementally after each simulation completes.
 * Body: { filename: string, logText: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  // Early reject oversize uploads via Content-Length header so we never
  // buffer multi-gigabyte bodies into memory. The library performs a
  // second defense-in-depth check after parsing.
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_LOG_BYTES + ENVELOPE_OVERHEAD_BYTES) {
      return payloadTooLargeResponse(contentLength);
    }
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { filename, logText } = body;

    if (!filename || typeof filename !== 'string') {
      return badRequestResponse('filename is required');
    }
    if (!logText || typeof logText !== 'string') {
      return badRequestResponse('logText is required');
    }

    try {
      await uploadSingleSimulationLog(id, filename, logText);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Log too large')) {
        return payloadTooLargeResponse(Buffer.byteLength(logText, 'utf-8'));
      }
      throw err;
    }

    return NextResponse.json({ uploaded: true }, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs/[id]/logs/simulation error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to upload log', 500);
  }
}
