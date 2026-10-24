import type { JobStatus } from '@shared/types/job';

const STYLES: Record<JobStatus, string> = {
  QUEUED: 'bg-gray-600 text-gray-200',
  RUNNING: 'bg-blue-600 text-white',
  COMPLETED: 'bg-green-600 text-white',
  FAILED: 'bg-red-600 text-white',
  CANCELLED: 'bg-orange-600 text-white',
};

const LABELS: Record<JobStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** Small colored pill showing a job's status. */
export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
