import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { usePodRunJobs } from '../hooks/usePodRunJobs';
import { usePodRun } from '../hooks/usePodRuns';
import { aggregatePodStandings, parsePodRunJobIds } from '../utils/pods';
import { isTerminal } from '../utils/status';
import { REQUIRED_DECK_COUNT } from '@shared/types/job';

/** Win rate an evenly matched deck would have in a pod. */
const EVEN_WIN_RATE = 1 / REQUIRED_DECK_COUNT;

/**
 * Pod run: every 4-deck pod queued from one selection of more than 4 decks,
 * with standings summed across the pods that have finished.
 *
 * Saved runs live at /pods/:id. The older /pods?jobs=… links (runs queued
 * before runs were saved) still work.
 */
export default function PodRunPage() {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  const podRun = usePodRun(id);
  const jobIds = useMemo(
    () => (id ? podRun.data?.jobIds ?? [] : parsePodRunJobIds(search)),
    [id, podRun.data, search],
  );
  const { jobs, isLoading, missingIds } = usePodRunJobs(jobIds);
  const standings = useMemo(() => aggregatePodStandings(jobs), [jobs]);

  const finished = jobs.filter((j) => isTerminal(j.status)).length;
  const withResults = jobs.filter((j) => j.results && j.results.gamesPlayed > 0).length;

  if (podRun.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
        <Spinner /> Loading pod run...
      </div>
    );
  }

  if (podRun.isError) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        <p className="mb-4">{podRun.error.message}.</p>
        <Link to="/" className="text-blue-400 hover:underline">
          Back to recent simulations
        </Link>
      </div>
    );
  }

  if (jobIds.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        <p className="mb-4">This pod run link has no jobs in it.</p>
        <Link to="/submit" className="text-blue-400 hover:underline">
          Start a new simulation
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Pod Run</h1>
      <p className="text-sm text-gray-400 mb-6">
        {finished} of {jobIds.length} pods finished
        {withResults < finished && ` (${finished - withResults} without results)`}.
        Standings update live as each pod finishes.
        {!id && ' Bookmark this page to come back to it.'}
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Standings</h2>
        {standings.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center flex items-center justify-center gap-2">
            {isLoading && <Spinner />}
            {isLoading ? 'Loading pods...' : 'No pods have finished yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-400 w-10">#</th>
                  <th className="px-3 py-2 text-left text-gray-400">Deck</th>
                  <th className="px-3 py-2 text-right text-gray-400">Win Rate</th>
                  <th className="px-3 py-2 text-right text-gray-400">Wins</th>
                  <th className="px-3 py-2 text-right text-gray-400">Games</th>
                  <th className="px-3 py-2 text-right text-gray-400">Pods</th>
                  <th className="px-3 py-2 text-right text-gray-400">Avg Win Turn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {standings.map((s, idx) => (
                  <tr key={s.name} className="bg-gray-800/50">
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-white">{s.name}</td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-semibold ${
                        s.winRate >= EVEN_WIN_RATE ? 'text-green-400' : 'text-gray-300'
                      }`}
                    >
                      {(s.winRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-300">{s.wins}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{s.gamesPlayed}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{s.pods}</td>
                    <td className="px-3 py-2.5 text-right text-gray-300 font-mono">
                      {s.avgWinTurn != null ? s.avgWinTurn.toFixed(1) : <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500">
          An evenly matched deck wins about {(EVEN_WIN_RATE * 100).toFixed(0)}% of its games.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pods</h2>
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
        {missingIds.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {missingIds.length} pod{missingIds.length === 1 ? '' : 's'} could not be loaded (deleted or unavailable).
          </p>
        )}
      </section>
    </div>
  );
}
