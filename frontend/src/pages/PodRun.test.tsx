import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import PodRunPage from './PodRun';
import { usePodRun } from '../hooks/usePodRuns';
import { usePodRunJobs } from '../hooks/usePodRunJobs';
import { makeJob } from '../test/fixtures';
import type { PodRunResponse } from '@shared/types/pod-run';

vi.mock('../hooks/usePodRuns');
vi.mock('../hooks/usePodRunJobs');

const run: PodRunResponse = {
  id: 'run-1',
  deckNames: ['A', 'B', 'C', 'D', 'E'],
  deckIds: ['a', 'b', 'c', 'd', 'e'],
  jobIds: ['job-1', 'job-2'],
  podCount: 2,
  podsWithResults: 1,
  simulations: 4,
  createdAt: '2026-10-29T00:00:00.000Z',
  standings: [
    { key: 'e', name: 'Eldrazi', pods: 1, gamesPlayed: 4, wins: 3, winRate: 0.75, avgWinTurn: 8 },
    { key: 'a', name: 'Atraxa', pods: 1, gamesPlayed: 4, wins: 1, winRate: 0.25, avgWinTurn: null },
  ],
};

describe('PodRun — saved run', () => {
  beforeEach(() => {
    vi.mocked(usePodRun).mockReturnValue({
      data: run,
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePodRun>);
    vi.mocked(usePodRunJobs).mockReturnValue({ jobs: [makeJob({ id: 'job-1' })], isLoading: false, missingIds: [] });
  });

  const renderRun = () => renderWithRouter(<PodRunPage />, { route: '/pods/run-1', routePath: '/pods/:id' });

  it("shows the run's own standings without loading its pods", () => {
    renderRun();

    expect(screen.getByText('1 of 2 pods have results.', { exact: false })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Eldrazi');
    expect(rows[1]).toHaveTextContent('Atraxa');
    expect(usePodRunJobs).not.toHaveBeenCalled();
  });

  it('loads the pods when asked', () => {
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 pods' }));

    expect(usePodRunJobs).toHaveBeenCalledWith(['job-1', 'job-2']);
    expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === '/jobs/job-1')).toBe(true);
  });
});
