import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/react';
import { reportHandledError } from './errorReporting';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

describe('reportHandledError', () => {
  beforeEach(() => vi.mocked(Sentry.captureException).mockClear());

  it('sends each error once, however many handlers see it', () => {
    const error = new TypeError('Failed to fetch');
    reportHandledError(error, { url: '/api/jobs' });
    reportHandledError(error, { mutationKey: ['jobs'] });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('sends different errors separately', () => {
    reportHandledError(new Error('a'), {});
    reportHandledError(new Error('b'), {});
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});
