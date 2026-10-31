import { Link } from 'react-router-dom';
import { useWorkerStatus } from '../hooks/useWorkerStatus';
import { formatUptime } from '../utils/format';
import { Popover } from './ui/Popover';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * App bar status: how many desktop workers are online. Opens a list of each
 * worker with its status and uptime, plus the queue.
 */
export function WorkerStatusPill() {
  const { workers, queueDepth, isLoading } = useWorkerStatus();
  if (isLoading) return null;

  const online = workers.length;
  const summary = online > 0 ? `${plural(online, 'worker')} online` : 'No workers online';

  return (
    <Popover
      button={
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${online > 0 ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="tabular-nums">{online}</span>
          <span className="hidden sm:inline">{online === 1 ? 'worker' : 'workers'}</span>
        </>
      }
      buttonLabel={summary}
      buttonClassName="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm text-fg hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      panelLabel="Workers"
      panelClassName="w-80"
    >
      {(close) => (
        <div className="flex flex-col gap-3 text-sm">
          <h2 className="text-xs font-semibold text-fg-muted">{summary}</h2>
          {workers.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {workers.map((w) => (
                <li key={w.workerId} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${w.status === 'idle' ? 'bg-green-400' : 'bg-blue-400'}`} />
                  <span className="truncate text-fg">{w.workerName}</span>
                  <span className="text-xs text-fg-muted tabular-nums">
                    {w.status === 'busy' ? `${w.activeSimulations}/${w.capacity} sims` : 'idle'} · up {formatUptime(w.uptimeMs)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted">New simulations wait in the queue until a worker comes online.</p>
          )}
          <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-fg-muted">
            <span>{plural(queueDepth, 'job')} queued</span>
            <Link to="/worker-setup" onClick={close} className="text-accent hover:underline">
              Worker setup
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
