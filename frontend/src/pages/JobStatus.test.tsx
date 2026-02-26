import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import JobStatusPage from './JobStatus';
import { useJobData } from '../hooks/useJobData';
import { useWinData } from '../hooks/useWinData';
import { useJobLogs } from '../hooks/useJobLogs';
import { useWorkerStatus } from '../hooks/useWorkerStatus';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '../api';
import { emptyLogs } from '../test/fixtures';
import type { SimulationStatus } from '../types/simulation';
import {
  makeJob,
  completedWithResults,
  runningHalfway,
  queuedFirstInLine,
  queuedNoWorkers,
  queuedRetrying,
  failedWithError,
  cancelled,
} from '../test/fixtures';

// ---------------------------------------------------------------------------
// Mock all data hooks at module level
// ---------------------------------------------------------------------------

vi.mock('../hooks/useJobData');
vi.mock('../hooks/useWinData');
vi.mock('../hooks/useJobLogs');
vi.mock('../hooks/useWorkerStatus');
vi.mock('../contexts/AuthContext');
vi.mock('../api', () => ({
  getApiBase: () => 'http://localhost:3000',
  fetchWithAuth: vi.fn(),
  deleteJob: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultWinData = {
  winTally: null,
  winTurns: null,
  gamesPlayed: 0,
  simGamesCompleted: 0,
};

function setupMocks(overrides: {
  job?: ReturnType<typeof makeJob> | null;
  simulations?: SimulationStatus[];
  error?: string | null;
  winData?: Partial<typeof defaultWinData>;
  isAdmin?: boolean;
} = {}) {
  vi.mocked(useJobData).mockReturnValue({
    job: overrides.job ?? null,
    setJob: vi.fn(),
    simulations: overrides.simulations ?? [],
    error: overrides.error ?? null,
    setError: vi.fn(),
  });

  vi.mocked(useWinData).mockReturnValue({
    ...defaultWinData,
    ...overrides.winData,
  });

  vi.mocked(useJobLogs).mockReturnValue(emptyLogs);

  vi.mocked(useWorkerStatus).mockReturnValue({
    workers: [],
    queueDepth: 0,
    isLoading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
  });

  vi.mocked(useAuth).mockReturnValue({
    user: overrides.isAdmin ? { email: 'admin@test.com' } as unknown as import('firebase/auth').User : null,
    isAllowed: true,
    isAdmin: overrides.isAdmin ?? false,
    loading: false,
    hasRequestedAccess: false,
    refreshAccessRequestStatus: vi.fn().mockResolvedValue(undefined),
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue(null),
  });
}

function renderJobStatus(jobId = 'job-abc-123') {
  return renderWithRouter(<JobStatusPage />, {
    route: `/jobs/${jobId}`,
    routePath: '/jobs/:id',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ID regression test — the primary motivation for this test suite
// ---------------------------------------------------------------------------

describe('JobStatus — ID display', () => {
  it('renders the job ID in the page', () => {
    setupMocks({ job: makeJob({ id: 'job-abc-123' }) });
    renderJobStatus();
    const idElement = screen.getByText(/ID:/);
    expect(idElement).toHaveTextContent('ID: job-abc-123');
  });

  it('shows blank ID when id field is undefined (the RTDB bug)', () => {
    // This documents the bug before the fix — RTDB data lacks `id`
    setupMocks({ job: makeJob({ id: undefined as unknown as string }) });
    renderJobStatus();
    const idElement = screen.getByText(/ID:/);
    // The text should be just "ID:" with nothing after it
    expect(idElement.textContent?.trim()).toBe('ID:');
  });
});

// ---------------------------------------------------------------------------
// Loading and error states
// ---------------------------------------------------------------------------

describe('JobStatus — loading and error', () => {
  it('shows "Loading job..." when job is null', () => {
    setupMocks({ job: null });
    renderJobStatus();
    expect(screen.getByText('Loading job...')).toBeInTheDocument();
  });

  it('shows error message and back link when error is set', () => {
    setupMocks({ error: 'Job not found' });
    renderJobStatus();
    expect(screen.getByText('Job not found')).toBeInTheDocument();
    expect(screen.getByText('Back to browse')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Simulation count in heading
// ---------------------------------------------------------------------------

describe('JobStatus — heading', () => {
  it('shows simulation count in heading', () => {
    setupMocks({ job: makeJob({ simulations: 20 }) });
    renderJobStatus();
    expect(screen.getByText('20 Game Simulation')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Queued states
// ---------------------------------------------------------------------------

describe('JobStatus — queued', () => {
  it('shows queue panel with position', () => {
    setupMocks({ job: queuedFirstInLine.job });
    renderJobStatus();
    expect(screen.getByText('Next up')).toBeInTheDocument();
  });

  it('shows "Retrying" label when retryCount > 0', () => {
    setupMocks({ job: queuedRetrying.job });
    renderJobStatus();
    expect(screen.getByText(/Retrying/)).toBeInTheDocument();
  });

  it('shows "No workers online" when workers.online is 0', () => {
    setupMocks({ job: queuedNoWorkers.job });
    renderJobStatus();
    expect(screen.getByText('No workers online')).toBeInTheDocument();
  });

  it('shows worker count when workers are online', () => {
    setupMocks({ job: queuedFirstInLine.job });
    renderJobStatus();
    expect(screen.getByText(/2 online/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Running state
// ---------------------------------------------------------------------------

describe('JobStatus — running', () => {
  it('shows progress bar with aria attributes', () => {
    setupMocks({
      job: runningHalfway.job,
      simulations: runningHalfway.simulations,
      winData: { simGamesCompleted: 8 },
    });
    renderJobStatus();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '8');
    expect(progressBar).toHaveAttribute('aria-valuemax', '20');
  });

  it('shows Cancel button when running', () => {
    setupMocks({
      job: runningHalfway.job,
      simulations: runningHalfway.simulations,
      winData: { simGamesCompleted: 8 },
    });
    renderJobStatus();
    expect(screen.getByText('Cancel Job')).toBeInTheDocument();
  });

  it('shows status label "Running"', () => {
    setupMocks({ job: runningHalfway.job, simulations: runningHalfway.simulations });
    renderJobStatus();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Completed state
// ---------------------------------------------------------------------------

describe('JobStatus — completed', () => {
  it('shows duration when completed', () => {
    setupMocks({ job: completedWithResults.job });
    renderJobStatus();
    // 295_000ms = 4m 55.0s
    expect(screen.getByText('4m 55.0s')).toBeInTheDocument();
  });

  it('shows "Completed" status label', () => {
    setupMocks({ job: completedWithResults.job });
    renderJobStatus();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Failed state
// ---------------------------------------------------------------------------

describe('JobStatus — failed', () => {
  it('shows error message in red box', () => {
    setupMocks({ job: failedWithError.job, simulations: failedWithError.simulations });
    renderJobStatus();
    expect(screen.getByText('Worker crashed: OOM killed during simulation')).toBeInTheDocument();
  });

  it('shows "Failed" status label', () => {
    setupMocks({ job: failedWithError.job });
    renderJobStatus();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cancelled state
// ---------------------------------------------------------------------------

describe('JobStatus — cancelled', () => {
  it('shows "Cancelled" status label', () => {
    setupMocks({ job: cancelled.job });
    renderJobStatus();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Admin controls
// ---------------------------------------------------------------------------

describe('JobStatus — admin controls', () => {
  it('shows Delete button for admin users on terminal jobs', () => {
    setupMocks({ job: completedWithResults.job, isAdmin: true });
    renderJobStatus();
    expect(screen.getByText('Delete Job')).toBeInTheDocument();
  });

  it('does not show Delete button for non-admin users', () => {
    setupMocks({ job: completedWithResults.job, isAdmin: false });
    renderJobStatus();
    expect(screen.queryByText('Delete Job')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Run Again button
// ---------------------------------------------------------------------------

describe('JobStatus — Run Again', () => {
  it('shows "Run Again" button when job is COMPLETED with deckIds', () => {
    setupMocks({ job: makeJob({ status: 'COMPLETED', deckIds: ['a', 'b', 'c', 'd'] }) });
    renderJobStatus();
    expect(screen.getByText('Run Again')).toBeInTheDocument();
  });

  it('shows "Run Again" button when job is FAILED with deckIds', () => {
    setupMocks({ job: makeJob({ status: 'FAILED', deckIds: ['a', 'b', 'c', 'd'] }) });
    renderJobStatus();
    expect(screen.getByText('Run Again')).toBeInTheDocument();
  });

  it('shows "Run Again" button when job is CANCELLED with deckIds', () => {
    setupMocks({ job: makeJob({ status: 'CANCELLED', deckIds: ['a', 'b', 'c', 'd'] }) });
    renderJobStatus();
    expect(screen.getByText('Run Again')).toBeInTheDocument();
  });

  it('hides "Run Again" button when job is RUNNING', () => {
    setupMocks({ job: makeJob({ status: 'RUNNING', deckIds: ['a', 'b', 'c', 'd'], completedAt: undefined, durationMs: null }) });
    renderJobStatus();
    expect(screen.queryByText('Run Again')).not.toBeInTheDocument();
  });

  it('hides "Run Again" button when job is QUEUED', () => {
    setupMocks({
      job: makeJob({
        status: 'QUEUED',
        deckIds: ['a', 'b', 'c', 'd'],
        startedAt: undefined,
        completedAt: undefined,
        durationMs: null,
        queuePosition: 0,
        workers: { online: 1, idle: 1, busy: 0 },
      }),
    });
    renderJobStatus();
    expect(screen.queryByText('Run Again')).not.toBeInTheDocument();
  });

  it('hides "Run Again" button when deckIds is missing', () => {
    setupMocks({ job: makeJob({ status: 'COMPLETED', deckIds: undefined }) });
    renderJobStatus();
    expect(screen.queryByText('Run Again')).not.toBeInTheDocument();
  });

  it('calls fetchWithAuth with correct params on click', async () => {
    const mockResponse = { ok: true, json: () => Promise.resolve({ id: 'job-new' }) };
    vi.mocked(fetchWithAuth).mockResolvedValue(mockResponse as unknown as Response);

    setupMocks({
      job: makeJob({
        status: 'COMPLETED',
        simulations: 20,
        deckIds: ['deck-a', 'deck-b', 'deck-c', 'deck-d'],
      }),
    });
    renderJobStatus();

    fireEvent.click(screen.getByText('Run Again'));

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        'http://localhost:3000/api/jobs',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );
    });

    const callArgs = vi.mocked(fetchWithAuth).mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.deckIds).toEqual(['deck-a', 'deck-b', 'deck-c', 'deck-d']);
    expect(body.simulations).toBe(20);
    expect(body.idempotencyKey).toBeDefined();
  });

  it('navigates to new job on success', async () => {
    const mockResponse = { ok: true, json: () => Promise.resolve({ id: 'job-new-456' }) };
    vi.mocked(fetchWithAuth).mockResolvedValue(mockResponse as unknown as Response);

    setupMocks({ job: makeJob({ status: 'COMPLETED', deckIds: ['a', 'b', 'c', 'd'] }) });
    renderJobStatus();

    fireEvent.click(screen.getByText('Run Again'));

    // After successful resubmit, navigate() is called which triggers a route change.
    // In MemoryRouter, this causes the component to unmount and the new route
    // (which doesn't match /jobs/:id pattern) results in no content rendered.
    await waitFor(() => {
      expect(screen.queryByText('Run Again')).not.toBeInTheDocument();
    });
  });

  it('shows "Submitting..." while request is in-flight', async () => {
    let resolveResponse!: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    vi.mocked(fetchWithAuth).mockReturnValue(pendingPromise);

    setupMocks({ job: makeJob({ status: 'COMPLETED', deckIds: ['a', 'b', 'c', 'd'] }) });
    renderJobStatus();

    fireEvent.click(screen.getByText('Run Again'));

    await waitFor(() => {
      expect(screen.getByText('Submitting...')).toBeInTheDocument();
    });
    expect(screen.getByText('Submitting...').closest('button')).toBeDisabled();

    resolveResponse({ ok: true, json: () => Promise.resolve({ id: 'job-new' }) } as unknown as Response);
  });

  it('shows error when resubmit fails', async () => {
    const mockSetError = vi.fn();
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error('Network error'));

    setupMocks({ job: makeJob({ status: 'COMPLETED', deckIds: ['a', 'b', 'c', 'd'] }) });
    // Replace just setError with our spy
    vi.mocked(useJobData).mockReturnValue({
      job: makeJob({ status: 'COMPLETED', deckIds: ['a', 'b', 'c', 'd'] }),
      setJob: vi.fn(),
      simulations: [],
      error: null,
      setError: mockSetError,
    });

    renderJobStatus();

    fireEvent.click(screen.getByText('Run Again'));

    await waitFor(() => {
      expect(mockSetError).toHaveBeenCalledWith('Network error');
    });
  });
});
