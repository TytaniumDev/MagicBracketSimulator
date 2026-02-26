import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase module (prevents SDK initialization)
vi.mock('./firebase');

// Mock firebase/app-check so we can control getToken behavior
const mockGetToken = vi.fn();
vi.mock('firebase/app-check', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// We need to control what `auth` and `appCheck` resolve to at the module level.
// The __mocks__/firebase.ts exports null for both, which matches local mode.
// For tests that need a logged-in user, we mock `auth` via the imported module.
import * as firebaseModule from './firebase';

// Dynamic import ensures vi.mock('./firebase') is hoisted and applied
// before the api module initializes its module-level bindings (appCheck, auth).
const { fetchWithAuth, getFirebaseIdToken } = await import('./api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(...responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let callIndex = 0;

  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (callIndex >= responses.length) {
      throw new Error(`mockFetch: unexpected call #${callIndex + 1} (only ${responses.length} responses configured)`);
    }
    const resp = responses[callIndex];
    callIndex++;
    return new Response(JSON.stringify(resp.body ?? {}), {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fn);
  return { fetchMock: fn, calls };
}

function mockAuthUser(tokenFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue('test-token')) {
  const user = { getIdToken: tokenFn };
  Object.defineProperty(firebaseModule, 'auth', {
    value: { currentUser: user },
    writable: true,
    configurable: true,
  });
  return { user, tokenFn };
}

function clearAuthUser() {
  Object.defineProperty(firebaseModule, 'auth', {
    value: null,
    writable: true,
    configurable: true,
  });
}

function clearAppCheck() {
  Object.defineProperty(firebaseModule, 'appCheck', {
    value: null,
    writable: true,
    configurable: true,
  });
}

function mockAppCheck() {
  const fakeAppCheck = { name: 'mock-app-check' };
  Object.defineProperty(firebaseModule, 'appCheck', {
    value: fakeAppCheck,
    writable: true,
    configurable: true,
  });
  return fakeAppCheck;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  clearAuthUser();
  clearAppCheck();
});

// ---------------------------------------------------------------------------
// fetchWithAuth
// ---------------------------------------------------------------------------

describe('fetchWithAuth', () => {
  it('returns response on 200 — no retry', async () => {
    mockAuthUser();
    const { fetchMock } = mockFetch({ status: 200, body: { ok: true } });

    const res = await fetchWithAuth('https://api.test/jobs/1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 401, succeeds on second attempt', async () => {
    const { tokenFn } = mockAuthUser(
      vi.fn()
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token')
    );
    const { fetchMock } = mockFetch(
      { status: 401, body: { error: 'Unauthorized' } },
      { status: 200, body: { data: 'success' } }
    );

    const res = await fetchWithAuth('https://api.test/jobs/1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call should force-refresh the token
    expect(tokenFn).toHaveBeenCalledTimes(2);
    expect(tokenFn).toHaveBeenNthCalledWith(1, false);
    expect(tokenFn).toHaveBeenNthCalledWith(2, true);
  });

  it('retries once on 401 but returns second 401 (no infinite loop)', async () => {
    mockAuthUser();
    const { fetchMock } = mockFetch(
      { status: 401, body: { error: 'Unauthorized' } },
      { status: 401, body: { error: 'Still unauthorized' } }
    );

    const res = await fetchWithAuth('https://api.test/jobs/1');

    expect(res.status).toBe(401);
    // Exactly 2 calls — no infinite retry loop
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-401 errors (403, 500)', async () => {
    mockAuthUser();
    const { fetchMock } = mockFetch({ status: 403, body: { error: 'Forbidden' } });

    const res = await fetchWithAuth('https://api.test/jobs/1');

    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes through AbortSignal on both attempts', async () => {
    mockAuthUser();
    const { fetchMock } = mockFetch(
      { status: 401 },
      { status: 200 }
    );
    const controller = new AbortController();

    await fetchWithAuth('https://api.test/jobs/1', { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Verify signal was passed to both fetch calls
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(controller.signal);
    }
  });

  it('includes X-Firebase-AppCheck header when appCheck is available', async () => {
    mockAuthUser();
    mockAppCheck();
    mockGetToken.mockResolvedValue({ token: 'mock-appcheck-token' });
    const { fetchMock } = mockFetch({ status: 200, body: { ok: true } });

    await fetchWithAuth('https://api.test/jobs/1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Firebase-AppCheck']).toBe('mock-appcheck-token');
    expect(headers['Authorization']).toBe('Bearer test-token');
  });
});

// ---------------------------------------------------------------------------
// getFirebaseIdToken
// ---------------------------------------------------------------------------

describe('getFirebaseIdToken', () => {
  it('returns null when no user is logged in', async () => {
    // auth exists but no currentUser
    Object.defineProperty(firebaseModule, 'auth', {
      value: { currentUser: null },
      writable: true,
      configurable: true,
    });

    const token = await getFirebaseIdToken();
    expect(token).toBeNull();
  });

  it('returns local-mock-token when auth is null (local mode)', async () => {
    clearAuthUser(); // auth = null

    const token = await getFirebaseIdToken();
    expect(token).toBe('local-mock-token');
  });

  it('passes forceRefresh to user.getIdToken()', async () => {
    const { tokenFn } = mockAuthUser();

    await getFirebaseIdToken(true);

    expect(tokenFn).toHaveBeenCalledWith(true);
  });

  it('defaults forceRefresh to false', async () => {
    const { tokenFn } = mockAuthUser();

    await getFirebaseIdToken();

    expect(tokenFn).toHaveBeenCalledWith(false);
  });
});
