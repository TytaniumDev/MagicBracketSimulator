import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../api', () => ({ backfillCardStats: vi.fn() }));
vi.mock('../errorReporting', () => ({ reportHandledError: vi.fn() }));

import { backfillCardStats } from '../api';
import { reportHandledError } from '../errorReporting';
import { RebuildCardStatsButton } from './RebuildCardStatsButton';

describe('RebuildCardStatsButton', () => {
  it('reports a failed rebuild and still shows the error', async () => {
    const error = new Error('HTTP 500');
    vi.mocked(backfillCardStats).mockRejectedValue(error);
    render(<RebuildCardStatsButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild card stats' }));
    expect(await screen.findByText(/HTTP 500/)).toBeInTheDocument();
    expect(reportHandledError).toHaveBeenCalledWith(error, { action: 'rebuildCardStats', counted: 0 });
  });
});
