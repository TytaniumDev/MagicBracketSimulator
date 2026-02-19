import { useState, useMemo, memo } from 'react';
import type { SimulationStatus, SimulationState } from '../types/simulation';
import type { WorkerInfo } from '../types/worker';
import { WorkerOverrideControls } from './WorkerOverrideControls';

interface SimulationGridProps {
  simulations: SimulationStatus[];
  totalSimulations: number;
  workers?: WorkerInfo[];
  userEmail?: string | null;
  onWorkerRefresh?: () => Promise<void>;
}

const STATE_COLORS: Record<SimulationState, string> = {
  PENDING: 'bg-gray-600',
  RUNNING: 'bg-blue-500 animate-pulse',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  CANCELLED: 'bg-orange-500',
};

const STATE_LABELS: Record<SimulationState, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
}

interface SimGroup {
  label: string;
  workerId: string | null; // null = pending/unassigned
  workerName?: string;
  cells: (SimulationStatus | null)[];
}

/**
 * Visual grid of per-simulation statuses, grouped by worker.
 * Each square represents one simulation, color-coded by state.
 * Hover shows details; looks like a GitHub contribution graph.
 *
 * Memoized to prevent re-renders when parent state changes (e.g. log navigation)
 * but simulation data remains stable.
 */
export const SimulationGrid = memo(function SimulationGrid({ simulations, totalSimulations, workers, userEmail, onWorkerRefresh }: SimulationGridProps) {
  const [hoveredSim, setHoveredSim] = useState<SimulationStatus | null>(null);

  // Count by state
  const counts = simulations.reduce(
    (acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Build a lookup from workerId to WorkerInfo
  const workerMap = useMemo(() => {
    const map = new Map<string, WorkerInfo>();
    if (workers) {
      for (const w of workers) {
        map.set(w.workerId, w);
      }
    }
    return map;
  }, [workers]);

  // Group simulations by worker
  const groups = useMemo(() => {
    const simByIndex = new Map<number, SimulationStatus>();
    for (const s of simulations) {
      simByIndex.set(s.index, s);
    }

    // Separate into pending (no workerId) and assigned (has workerId)
    const pendingCells: (SimulationStatus | null)[] = [];
    const wMap = new Map<string, { sims: SimulationStatus[]; earliestIndex: number }>();

    for (let i = 0; i < totalSimulations; i++) {
      const sim = simByIndex.get(i) ?? null;
      if (!sim || !sim.workerId) {
        // Unassigned or missing — goes to pending group
        pendingCells.push(sim);
      } else {
        const existing = wMap.get(sim.workerId);
        if (existing) {
          existing.sims.push(sim);
        } else {
          wMap.set(sim.workerId, { sims: [sim], earliestIndex: i });
        }
      }
    }

    const result: SimGroup[] = [];

    // Pending group always first
    if (pendingCells.length > 0) {
      result.push({
        label: 'Pending',
        workerId: null,
        cells: pendingCells,
      });
    }

    // Worker groups sorted by earliest simulation index
    const sortedWorkers = [...wMap.entries()].sort(
      ([, a], [, b]) => a.earliestIndex - b.earliestIndex
    );

    for (const [workerId, { sims }] of sortedWorkers) {
      // Sort sims by index within the group
      sims.sort((a, b) => a.index - b.index);
      const workerName = sims.find((s) => s.workerName)?.workerName;
      result.push({
        label: workerName || workerId.slice(0, 8),
        workerId,
        workerName,
        cells: sims,
      });
    }

    return result;
  }, [simulations, totalSimulations]);

  // Adaptive cell size based on total count (global for consistency)
  const cellSize = totalSimulations <= 20 ? 'w-5 h-5' : totalSimulations <= 50 ? 'w-4 h-4' : 'w-3 h-3';
  const gapSize = totalSimulations <= 50 ? 'gap-1' : 'gap-0.5';

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        {(['COMPLETED', 'RUNNING', 'PENDING', 'FAILED', 'CANCELLED'] as SimulationState[]).map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${STATE_COLORS[state].replace(' animate-pulse', '')}`} />
            {STATE_LABELS[state]}
            {counts[state] ? ` (${counts[state]})` : ''}
          </span>
        ))}
      </div>

      {/* Grouped grids */}
      <div className="space-y-3">
        {groups.map((group) => {
          const worker = group.workerId ? workerMap.get(group.workerId) : null;
          const isOwner = worker && userEmail && worker.ownerEmail
            && worker.ownerEmail.toLowerCase() === userEmail.toLowerCase();

          return (
            <div key={group.workerId ?? '__pending__'}>
              {/* Group header */}
              <div className="flex items-center gap-1.5 mb-1 text-xs">
                {group.workerId ? (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-gray-400 font-mono">{group.label}</span>
                  </>
                ) : (
                  <span className="text-gray-500">{group.label}</span>
                )}
                <span className="text-gray-600">({group.cells.length})</span>

                {/* Inline capacity controls for owned workers */}
                {isOwner && worker && (
                  <WorkerOverrideControls worker={worker} onRefresh={onWorkerRefresh} compact />
                )}

                {/* Read-only override for non-owned workers */}
                {!isOwner && worker && worker.maxConcurrentOverride != null && (
                  <span className="text-gray-500 ml-1">
                    cap: {worker.maxConcurrentOverride}
                    {worker.maxConcurrentOverride > worker.capacity && (
                      <span className="text-amber-400 ml-1">!</span>
                    )}
                  </span>
                )}
              </div>
              {/* Grid */}
              <div className={`flex flex-wrap ${gapSize}`}>
                {group.cells.map((sim, i) => {
                  const state: SimulationState = sim?.state ?? 'PENDING';
                  return (
                    <div
                      key={sim?.index ?? `pending-${i}`}
                      className={`${cellSize} rounded-sm cursor-default transition-transform hover:scale-125 ${STATE_COLORS[state]}`}
                      onMouseEnter={() => sim && setHoveredSim(sim)}
                      onMouseLeave={() => setHoveredSim(null)}
                      title={sim ? `${sim.simId}: ${STATE_LABELS[state]}` : `Pending`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip details */}
      {hoveredSim && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${STATE_COLORS[hoveredSim.state].replace(' animate-pulse', '')}`} />
            <span className="font-medium text-white">{hoveredSim.simId}</span>
            <span className="text-gray-400">— {STATE_LABELS[hoveredSim.state]}</span>
          </div>
          {hoveredSim.durationMs != null && (
            <div className="text-gray-400">
              Duration: <span className="text-gray-200">{formatDuration(hoveredSim.durationMs)}</span>
            </div>
          )}
          {hoveredSim.winner && (
            <div className="text-gray-400">
              Winner: <span className="text-emerald-400">{hoveredSim.winner}</span>
              {hoveredSim.winningTurn != null && (
                <span> (turn {hoveredSim.winningTurn})</span>
              )}
            </div>
          )}
          {hoveredSim.errorMessage && (
            <div className="text-red-400 text-xs">
              {hoveredSim.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
