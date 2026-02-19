import { useState } from 'react';
import type { WorkerInfo } from '../types/worker';
import { WorkerOverrideControls } from './WorkerOverrideControls';

interface WorkerStatusBannerProps {
  workers: WorkerInfo[];
  queueDepth: number;
  isLoading: boolean;
  onRefresh?: () => Promise<void>;
  userEmail?: string | null;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function WorkerStatusBanner({ workers, queueDepth, isLoading, onRefresh, userEmail }: WorkerStatusBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return null;

  const online = workers.length;
  const idle = workers.filter((w) => w.status === 'idle').length;
  const updating = workers.filter((w) => w.status === 'updating').length;
  const active = online - updating; // Workers not in 'updating' state
  const hasActiveWorkers = active > 0;
  const hasOnlyUpdating = online > 0 && active === 0;

  // Dot color: green if any active workers, amber if all updating, red if none
  const dotColor = hasActiveWorkers
    ? 'bg-green-500'
    : hasOnlyUpdating
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="bg-gray-800 rounded-lg px-4 py-3 mb-6 border border-gray-700">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-sm"
      >
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${dotColor}`}
          />
          <span className="text-gray-300">
            {hasActiveWorkers
              ? `${online} worker${online !== 1 ? 's' : ''} online${idle > 0 ? ` (${idle} idle)` : ''}${updating > 0 ? ` (${updating} updating)` : ''}`
              : hasOnlyUpdating
                ? `${updating} worker${updating !== 1 ? 's' : ''} updating`
                : 'No workers online'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {queueDepth > 0 && (
            <span className="text-gray-400">
              {queueDepth} job{queueDepth !== 1 ? 's' : ''} queued
            </span>
          )}
          <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && workers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
          {workers.map((w) => {
            const isOwner = userEmail && w.ownerEmail && w.ownerEmail.toLowerCase() === userEmail.toLowerCase();

            return (
              <div key={w.workerId} className="text-xs text-gray-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        w.status === 'updating'
                          ? 'bg-amber-500'
                          : w.status === 'idle'
                            ? 'bg-green-500'
                            : 'bg-blue-500'
                      }`}
                    />
                    <span className="text-gray-300 font-medium">{w.workerName}</span>
                    <span className="text-gray-500">({w.status})</span>
                    {w.ownerEmail && (
                      <span className="text-gray-600">&middot; {w.ownerEmail}</span>
                    )}
                  </div>
                  {w.status !== 'updating' && (
                    <div className="flex items-center gap-3">
                      {w.status === 'busy' && (
                        <span>
                          {w.activeSimulations}/{w.maxConcurrentOverride ?? w.capacity} sims
                        </span>
                      )}
                      <span>up {formatUptime(w.uptimeMs)}</span>
                    </div>
                  )}
                </div>

                {/* Owner controls for concurrency override */}
                {isOwner && w.status !== 'updating' && (
                  <WorkerOverrideControls worker={w} onRefresh={onRefresh} />
                )}

                {/* Read-only override display for non-owners */}
                {!isOwner && w.maxConcurrentOverride != null && w.status !== 'updating' && (
                  <div className="mt-1 text-gray-500">
                    override: {w.maxConcurrentOverride} (hw: {w.capacity})
                    {w.maxConcurrentOverride > w.capacity && (
                      <span className="text-amber-400 ml-1">exceeds hardware</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
