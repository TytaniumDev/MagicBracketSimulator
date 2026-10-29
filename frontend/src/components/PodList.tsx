import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import type { JobResponse } from '@shared/types/job';

/** A pod run's pods, each linking to its job page. */
export function PodList({ jobs, missingCount }: { jobs: readonly JobResponse[]; missingCount: number }) {
  return (
    <>
      <ul className="space-y-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              to={`/jobs/${job.id}`}
              className="flex items-center justify-between gap-3 bg-gray-800 hover:bg-gray-700 rounded-md px-3 py-2 transition-colors"
            >
              <span className="text-sm text-gray-200 truncate">{job.deckNames.join(' vs ')}</span>
              <span className="flex items-center gap-3 flex-shrink-0">
                {job.status === 'RUNNING' && (
                  <span className="text-xs text-gray-400 font-mono">
                    {Math.min(job.gamesCompleted, job.simulations)}/{job.simulations} games
                  </span>
                )}
                <StatusBadge status={job.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {missingCount > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          {missingCount} pod{missingCount === 1 ? '' : 's'} could not be loaded (deleted or unavailable).
        </p>
      )}
    </>
  );
}
