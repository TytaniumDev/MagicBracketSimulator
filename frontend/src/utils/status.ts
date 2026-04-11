import type { JobStatus } from '@shared/types/job';

/** Returns true if the job status represents a terminal (finished) state. */
export function isTerminal(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/** Type-narrowing overload for known JobStatus values. */
export function isTerminalStatus(status: JobStatus): boolean {
  return isTerminal(status);
}
