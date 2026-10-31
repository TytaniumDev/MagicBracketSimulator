import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithRouter } from '../test/render';
import { useWorkerStatus } from '../hooks/useWorkerStatus';
import { WorkerStatusPill } from './WorkerStatusPill';

vi.mock('../hooks/useWorkerStatus');

const status = (workers: ReturnType<typeof useWorkerStatus>['workers'], queueDepth = 0) => ({
  workers,
  queueDepth,
  isLoading: false,
  refresh: async () => {},
});

describe('WorkerStatusPill', () => {
  it('shows how many workers are online and lists them', () => {
    vi.mocked(useWorkerStatus).mockReturnValue(
      status([
        {
          workerId: 'w1',
          workerName: "Tyler's MacBook",
          status: 'busy',
          capacity: 4,
          activeSimulations: 2,
          uptimeMs: 2 * 3600_000 + 5 * 60_000,
          lastHeartbeat: '2026-10-31T00:00:00Z',
        },
      ], 3),
    );
    renderWithRouter(<WorkerStatusPill />);

    fireEvent.click(screen.getByRole('button', { name: '1 worker online' }));
    expect(screen.getByText("Tyler's MacBook")).toBeInTheDocument();
    expect(screen.getByText('2/4 sims · up 2h 5m')).toBeInTheDocument();
    expect(screen.getByText('3 jobs queued')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Worker setup' })).toHaveAttribute('href', '/worker-setup');
  });

  it('says when no workers are online', () => {
    vi.mocked(useWorkerStatus).mockReturnValue(status([]));
    renderWithRouter(<WorkerStatusPill />);

    fireEvent.click(screen.getByRole('button', { name: 'No workers online' }));
    expect(screen.getByText(/wait in the queue until a worker comes online/)).toBeInTheDocument();
  });
});
