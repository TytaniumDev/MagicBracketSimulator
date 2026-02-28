import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase, fetchWithAuth, deleteJobs } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { WorkerStatusBanner } from '../components/WorkerStatusBanner';
import { Spinner } from '../components/Spinner';
import { useWorkerStatus } from '../hooks/useWorkerStatus';
import type { JobStatus, JobSummary } from '@shared/types/job';

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
    COMPLETED: 'bg-green-600 text-white',
    FAILED: 'bg-red-600 text-white',
    CANCELLED: 'bg-orange-600 text-white',
  };

  const labels: Record<JobStatus, string> = {
    QUEUED: 'Queued',
    RUNNING: 'Running',
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
  const { user, isAllowed, isAdmin, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Admin bulk-delete state
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const toggleSelectJob = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedJobs(new Set(jobs.map((j) => j.id)));
  const deselectAll = () => setSelectedJobs(new Set());

  const handleBulkDelete = async () => {
    if (selectedJobs.size === 0) return;
    if (!window.confirm(`Delete ${selectedJobs.size} job(s)? This cannot be undone.`)) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { results } = await deleteJobs(Array.from(selectedJobs));
      const deletedIds = new Set(results.filter((r) => r.deleted).map((r) => r.id));
      setJobs((prev) => prev.filter((j) => !deletedIds.has(j.id)));
      setSelectedJobs(new Set());
      const failedCount = results.filter((r) => !r.deleted).length;
      if (failedCount > 0) {
        setDeleteError(`${failedCount} job(s) failed to delete`);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const apiBase = getApiBase();
  const { workers, queueDepth, isLoading: workersLoading, refresh: refreshWorkers } = useWorkerStatus(!!isAllowed);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${apiBase}/api/jobs`);
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
        (job) => job.status === 'QUEUED' || job.status === 'RUNNING'
      );
      if (hasInProgress && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          const updated = await fetchJobs();
          const stillInProgress = updated.some(
            (job) => job.status === 'QUEUED' || job.status === 'RUNNING'
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

      {/* Worker Status Banner — only for users who can submit */}
      {isAllowed && (
        <WorkerStatusBanner workers={workers} queueDepth={queueDepth} isLoading={workersLoading} onRefresh={refreshWorkers} userEmail={user?.email} />
      )}

      {/* Jobs List */}
      {isLoading && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center flex justify-center items-center gap-2">
          <Spinner />
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

      {/* Admin bulk-delete toolbar */}
      {isAdmin && !isLoading && jobs.length > 0 && (
        <div className="mb-3 flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
          <button
            type="button"
            onClick={selectedJobs.size === jobs.length ? deselectAll : selectAll}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            {selectedJobs.size === jobs.length ? 'Deselect All' : 'Select All'}
          </button>
          {selectedJobs.size > 0 && (
            <>
              <span className="text-sm text-gray-400">{selectedJobs.size} selected</span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isDeleting}
                className="ml-auto px-3 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isDeleting && <Spinner size="sm" />}
                {isDeleting ? 'Deleting...' : `Delete Selected (${selectedJobs.size})`}
              </button>
            </>
          )}
        </div>
      )}

      {deleteError && (
        <div className="mb-3 bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-md text-sm">
          {deleteError}
        </div>
      )}

      {!isLoading && !error && jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((run) => (
            <Link
              key={run.id}
              to={`/jobs/${run.id}`}
              className={`block bg-gray-800 rounded-lg p-4 border transition-colors relative ${
                selectedJobs.has(run.id)
                  ? 'border-blue-500'
                  : 'border-gray-700 hover:border-gray-600'
              } ${isAdmin ? 'pl-10' : ''}`}
            >
              {isAdmin && (
                <input
                  type="checkbox"
                  checked={selectedJobs.has(run.id)}
                  onClick={(e) => toggleSelectJob(run.id, e)}
                  onChange={() => {}}
                  className="absolute left-3 top-5 w-4 h-4 accent-blue-500 cursor-pointer"
                />
              )}
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
              {run.status === 'RUNNING' && (
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
