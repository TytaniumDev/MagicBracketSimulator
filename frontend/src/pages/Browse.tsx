import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase, fetchPublic } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { WorkerStatusBanner } from '../components/WorkerStatusBanner';
import { useWorkerStatus } from '../hooks/useWorkerStatus';

type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface JobSummary {
  id: string;
  name: string;
  deckNames: string[];
  status: JobStatus;
  simulations: number;
  gamesCompleted: number;
  createdAt: string;
  hasResult: boolean;
  durationMs?: number | null;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    QUEUED: 'bg-gray-600 text-gray-200',
    RUNNING: 'bg-blue-600 text-white',
    ANALYZING: 'bg-purple-600 text-white',
    COMPLETED: 'bg-green-600 text-white',
    FAILED: 'bg-red-600 text-white',
    CANCELLED: 'bg-orange-600 text-white',
  };

  const labels: Record<JobStatus, string> = {
    QUEUED: 'Queued',
    RUNNING: 'Running',
    ANALYZING: 'Analyzing',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function Browse() {
  const { user, isAllowed, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiBase = getApiBase();
  const { workers, queueDepth, isLoading: workersLoading, refresh: refreshWorkers } = useWorkerStatus();

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetchPublic(`${apiBase}/api/jobs`);
      if (!res.ok) throw new Error('Failed to fetch jobs');
      const data = await res.json();
      setJobs(data.jobs || []);
      setError(null);
      return data.jobs as JobSummary[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchJobs().then((jobList) => {
      const hasInProgress = jobList.some(
        (job) => job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'ANALYZING'
      );
      if (hasInProgress && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          const updated = await fetchJobs();
          const stillInProgress = updated.some(
            (job) => job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'ANALYZING'
          );
          if (!stillInProgress && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }, 10000);
      }
    });

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [fetchJobs]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-2">Bracket Simulations</h1>
      <p className="text-gray-400 text-center mb-8">
        Recent Magic: The Gathering Commander bracket analysis runs
      </p>

      {/* CTA based on auth state */}
      {!authLoading && (
        <div className="mb-6 text-center">
          {isAllowed ? (
            <Link
              to="/submit"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors"
            >
              New Simulation
            </Link>
          ) : user ? (
            <Link
              to="/submit"
              className="inline-block px-6 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 font-medium transition-colors"
            >
              Request Access to Submit
            </Link>
          ) : (
            <p className="text-gray-500 text-sm">
              Sign in to submit your own simulations
            </p>
          )}
        </div>
      )}

      {/* Worker Status Banner */}
      <WorkerStatusBanner workers={workers} queueDepth={queueDepth} isLoading={workersLoading} onRefresh={refreshWorkers} userEmail={user?.email} />

      {/* Jobs List */}
      {isLoading && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
          Loading simulations...
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {!isLoading && !error && jobs.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
          No simulations yet.
        </div>
      )}

      {!isLoading && !error && jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((run) => (
            <Link
              key={run.id}
              to={`/jobs/${run.id}`}
              className="block bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-white truncate">
                      {run.name}
                    </h3>
                    <StatusBadge status={run.status} />
                  </div>
                  <p className="text-sm text-gray-400 truncate">
                    {run.deckNames.join(', ')}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-medium text-gray-300">
                    {run.status === 'COMPLETED'
                      ? `${run.simulations} / ${run.simulations} games`
                      : `${run.gamesCompleted ?? 0} / ${run.simulations} games`}
                  </div>
                  {run.durationMs != null && run.durationMs >= 0 && (
                    <div className="text-xs text-gray-400">
                      Run time: {formatDurationMs(run.durationMs)}
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    {formatDate(run.createdAt)}
                  </div>
                </div>
              </div>
              {(run.status === 'RUNNING' || run.status === 'ANALYZING') && (
                <div className="mt-2">
                  <div
                    className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={run.gamesCompleted}
                    aria-valuemin={0}
                    aria-valuemax={run.simulations}
                  >
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (run.gamesCompleted / run.simulations) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
