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
const MAX_REQUEST_BYTES = MAX_LOG_BYTES + ENVELOPE_OVERHEAD_BYTES;

function payloadTooLargeResponse(bytes: number) {
  return NextResponse.json(
    { error: `Payload too large: ${bytes} bytes exceeds max of ${MAX_LOG_BYTES} bytes` },
    { status: 413 }
  );
}

/**
 * Read the request body as a UTF-8 string, aborting if the accumulated
 * byte count exceeds `MAX_REQUEST_BYTES`. This closes the
 * `Transfer-Encoding: chunked` bypass where Content-Length is absent and
 * `request.json()` would otherwise buffer the entire body into memory
 * regardless of size.
 *
 * Returns `{ ok: true, text }` on success or `{ ok: false, bytesRead }` on
 * overflow. The caller converts the overflow result into an HTTP 413.
 */
async function readBodyWithLimit(
  request: NextRequest,
  limit: number
): Promise<{ ok: true; text: string } | { ok: false; bytesRead: number }> {
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: true, text: '' };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        // Best-effort cancel so the sender stops sending. Safe to ignore
        // any error here — the connection will be torn down by the 413.
        await reader.cancel().catch(() => { /* ignore */ });
        return { ok: false, bytesRead: total };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Concatenate and decode. Total size is bounded by `limit` so this
  // allocation is also bounded.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8').decode(merged) };
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
  // even start reading the body. Only catches honest clients — chunked
  // transfers are caught by the streaming reader below.
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return payloadTooLargeResponse(contentLength);
    }
  }

  try {
    const { id } = await params;

    // Streaming read with a running byte count. Rejects over-cap uploads
    // mid-flight so we never buffer more than MAX_REQUEST_BYTES in memory,
    // regardless of transfer encoding.
    const bodyResult = await readBodyWithLimit(request, MAX_REQUEST_BYTES);
    if (!bodyResult.ok) {
      return payloadTooLargeResponse(bodyResult.bytesRead);
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyResult.text);
    } catch {
      return badRequestResponse('Invalid JSON body');
    }

    const { filename, logText } = body as { filename?: unknown; logText?: unknown };

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
