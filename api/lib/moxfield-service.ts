/**
 * Moxfield API service with rate limiting and secure User-Agent handling.
 *
 * The User-Agent is loaded from MOXFIELD_USER_AGENT env var and never exposed
 * to the client. All Moxfield API requests must go through this service.
 */

// Rate limiter state (module-level singleton)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1000; // 1 request per second

/**
 * Check if Moxfield API is configured (env var is set).
 */
export function isMoxfieldApiEnabled(): boolean {
  const ua = process.env.MOXFIELD_USER_AGENT;
  const uaDefined = ua !== undefined && ua !== null;
  const trimLen = typeof ua === 'string' ? ua.trim().length : 0;
  const result = !!ua && trimLen > 0;
  // #region agent log
  try {
    fetch('http://127.0.0.1:1026/ingest/11c89cba-1ae5-4e5d-9178-21fb760379c4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'api/lib/moxfield-service.ts:isMoxfieldApiEnabled', message: 'Moxfield env check', data: { uaDefined, trimLen, result }, timestamp: Date.now(), hypothesisId: 'A' }) }).catch(() => {});
  } catch (_) {}
  // #endregion
  return result;
}

/**
 * Get the User-Agent. Throws if not configured.
 */
function getMoxfieldUserAgent(): string {
  const ua = process.env.MOXFIELD_USER_AGENT?.trim();
  if (!ua) {
    throw new Error(
      'Moxfield API is not configured. Please paste your deck list manually.'
    );
  }
  return ua;
}

/**
 * Enforce 1 req/sec rate limit.
 */
async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitTime = MIN_REQUEST_INTERVAL_MS - elapsed;
    await new Promise((r) => setTimeout(r, waitTime));
  }
  lastRequestTime = Date.now();
}

/**
 * Rate-limited fetch for Moxfield API. Throws if not configured.
 */
export async function moxfieldFetch(url: string): Promise<Response> {
  const userAgent = getMoxfieldUserAgent(); // Throws if not set
  await enforceRateLimit();

  return fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
  });
}
