import { useState } from 'react';
import { backfillCardStats } from '../api';
import { reportHandledError } from '../errorReporting';

type Progress =
  | { state: 'idle' }
  | { state: 'running'; counted: number }
  | { state: 'done'; counted: number; failed: number }
  | { state: 'error'; counted: number; message: string };

/**
 * Admin button that rebuilds card impact stats from every completed job's
 * logs, one page at a time. Safe to press again: jobs already counted are
 * skipped, so a stopped run picks up where it left off.
 */
export function RebuildCardStatsButton() {
  const [progress, setProgress] = useState<Progress>({ state: 'idle' });

  const run = async () => {
    let counted = 0;
    let failed = 0;
    let cursor: string | null = null;
    setProgress({ state: 'running', counted });
    try {
      do {
        const page = await backfillCardStats(cursor);
        counted += page.processed;
        failed += page.errors.length;
        cursor = page.nextCursor;
        setProgress({ state: 'running', counted });
      } while (cursor);
      setProgress({ state: 'done', counted, failed });
    } catch (err) {
      reportHandledError(err, { action: 'rebuildCardStats', counted });
      setProgress({ state: 'error', counted, message: err instanceof Error ? err.message : 'Failed' });
    }
  };

  return (
    <div className="flex items-center gap-3 text-xs text-gray-400">
      <button
        type="button"
        onClick={run}
        disabled={progress.state === 'running'}
        className="px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
      >
        Rebuild card stats
      </button>
      {progress.state === 'running' && <span>Counting jobs... {progress.counted} so far</span>}
      {progress.state === 'done' && (
        <span>
          Counted {progress.counted} jobs{progress.failed > 0 && `, ${progress.failed} failed`}.
        </span>
      )}
      {progress.state === 'error' && (
        <span className="text-red-400">
          Stopped after {progress.counted} jobs: {progress.message}. Press again to resume.
        </span>
      )}
    </div>
  );
}
