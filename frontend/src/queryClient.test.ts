import { describe, it, expect, vi } from 'vitest';

vi.mock('./errorReporting', () => ({ reportHandledError: vi.fn() }));

import { reportHandledError } from './errorReporting';
import { queryClient } from './queryClient';

describe('queryClient', () => {
  it('reports failed queries even though the page handles them', async () => {
    const error = new Error('Deck not found');
    await queryClient
      .fetchQuery({ queryKey: ['deck', 'missing'], queryFn: () => Promise.reject(error), retry: false })
      .catch(() => {});
    expect(reportHandledError).toHaveBeenCalledWith(error, { queryKey: ['deck', 'missing'] });
  });
});
