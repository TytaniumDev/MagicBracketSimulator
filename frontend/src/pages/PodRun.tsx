import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { PodList } from '../components/PodList';
import { PodStandingsTable } from '../components/PodStandingsTable';
import { usePodRunJobs } from '../hooks/usePodRunJobs';
import { usePodRun } from '../hooks/usePodRuns';
import { aggregatePodStandings, parsePodRunJobIds } from '../utils/pods';
import { isTerminal } from '../utils/status';
import type { DeckStanding } from '@shared/types/pod-run';

/**
 * Pod run: every 4-deck pod queued from one selection of more than 4 decks,
 * with standings summed across the pods that have finished.
 *
 * Saved runs live at /pods/:id and keep their own standings, so the page
 * reads one run; its pods load only when asked for. The older
 * /pods?jobs=… links (runs queued before runs were saved) still work by
 * loading every pod.
 */
export default function PodRunPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <SavedPodRun id={id} /> : <LinkedPodRun />;
}

function SavedPodRun({ id }: { id: string }) {
  const podRun = usePodRun(id);
  const [showPods, setShowPods] = useState(false);

  if (podRun.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
        <Spinner /> Loading pod run...
      </div>
    );
  }

  if (podRun.isError || !podRun.data) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        <p className="mb-4">{podRun.error?.message ?? 'Pod run not found'}.</p>
        <Link to="/" className="text-blue-400 hover:underline">
          Back to recent simulations
        </Link>
      </div>
    );
  }

  const run = podRun.data;
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Pod Run</h1>
      <p className="text-sm text-gray-400 mb-6">
        {run.podsWithResults} of {run.podCount} pods have results. Standings update live as each pod finishes.
      </p>

      <StandingsSection standings={run.standings} />

      <section>
        <h2 className="text-lg font-semibold mb-3">Pods</h2>
        {showPods ? (
          <LoadedPods jobIds={run.jobIds} />
        ) : (
          <button
            type="button"
            onClick={() => setShowPods(true)}
            className="text-sm text-blue-400 hover:underline"
          >
            Show all {run.podCount} pods
          </button>
        )}
      </section>
    </div>
  );
}

/** Loads each pod's job to list it. */
function LoadedPods({ jobIds }: { jobIds: readonly string[] }) {
  const { jobs, isLoading, missingIds } = usePodRunJobs(jobIds);
  if (isLoading && jobs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Spinner /> Loading pods...
      </div>
    );
  }
  return <PodList jobs={jobs} missingCount={missingIds.length} />;
}

/** A /pods?jobs=… link: standings are summed from the pods themselves. */
function LinkedPodRun() {
  const { search } = useLocation();
  const jobIds = useMemo(() => parsePodRunJobIds(search), [search]);
  const { jobs, isLoading, missingIds } = usePodRunJobs(jobIds);
  const standings = useMemo(() => aggregatePodStandings(jobs), [jobs]);

  const finished = jobs.filter((j) => isTerminal(j.status)).length;
  const withResults = jobs.filter((j) => j.results && j.results.gamesPlayed > 0).length;

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
        Standings update live as each pod finishes. Bookmark this page to come back to it.
      </p>

      <StandingsSection standings={standings} isLoading={isLoading} />

      <section>
        <h2 className="text-lg font-semibold mb-3">Pods</h2>
        <PodList jobs={jobs} missingCount={missingIds.length} />
      </section>
    </div>
  );
}

function StandingsSection({ standings, isLoading = false }: { standings: readonly DeckStanding[]; isLoading?: boolean }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Standings</h2>
      {standings.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center flex items-center justify-center gap-2">
          {isLoading && <Spinner />}
          {isLoading ? 'Loading pods...' : 'No pods have finished yet.'}
        </div>
      ) : (
        <PodStandingsTable standings={standings} />
      )}
    </section>
  );
}
