import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./firebase');
vi.mock('./errorReporting', () => ({ reportHandledError: vi.fn() }));

import { reportHandledError } from './errorReporting';
import { fetchWithAuth } from './api';

describe('fetchWithAuth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports a request that never got a response, then rethrows', async () => {
    const error = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(fetchWithAuth('/api/jobs', { method: 'POST' })).rejects.toBe(error);
    expect(reportHandledError).toHaveBeenCalledWith(error, { url: '/api/jobs', method: 'POST' });
  });

  it('leaves error responses to the caller', async () => {
    vi.mocked(reportHandledError).mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const res = await fetchWithAuth('/api/jobs');
    expect(res.status).toBe(500);
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});
