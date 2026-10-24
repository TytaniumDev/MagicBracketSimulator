import { Link } from 'react-router-dom';
import { usePodRunsForJob } from '../hooks/usePodRuns';
import { savedPodRunPath } from '../utils/pods';

/**
 * Link from a job to the pod run it was queued in. Renders nothing for jobs
 * that aren't part of a saved pod run.
 */
export function PodRunLink({ jobId }: { jobId: string }) {
  const { data: podRuns } = usePodRunsForJob(jobId);
  const podRun = podRuns?.[0];
  if (!podRun) return null;

  return (
    <Link
      to={savedPodRunPath(podRun.id)}
      className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm transition-colors"
    >
      Part of a {podRun.deckNames.length}-deck pod run · see standings
      <span aria-hidden>→</span>
    </Link>
  );
}
