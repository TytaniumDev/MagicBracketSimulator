import { Link } from 'react-router-dom';
import { useRecentPodRuns } from '../hooks/usePodRuns';
import { formatRelativeDate } from '../utils/format';
import { savedPodRunPath } from '../utils/pods';

/** How many pod runs the front page shows. */
const RECENT_POD_RUN_LIMIT = 5;

/**
 * Front-page list of the latest pod runs. Renders nothing until there is at
 * least one, so the page looks the same for people who never queue one.
 */
export function RecentPodRuns() {
  const { data: podRuns } = useRecentPodRuns(RECENT_POD_RUN_LIMIT);
  if (!podRuns || podRuns.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Pod Runs</h2>
      <ul className="space-y-2">
        {podRuns.map((run) => (
          <li key={run.id}>
            <Link
              to={savedPodRunPath(run.id)}
              className="flex items-center justify-between gap-4 bg-gray-800 hover:bg-gray-700 rounded-lg p-4 transition-colors"
            >
              <div className="min-w-0">
                <h3 className="font-semibold text-white mb-1">{run.deckNames.length} decks</h3>
                <p className="text-sm text-gray-400 truncate">{run.deckNames.join(', ')}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-medium text-gray-300">
                  {run.podCount} pods × {run.simulations} games
                </div>
                <div className="text-xs text-gray-500">{formatRelativeDate(run.createdAt)}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
