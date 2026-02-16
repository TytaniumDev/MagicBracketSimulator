import { useState } from 'react';
import type { SimulationStatus, SimulationState } from '../types/simulation';

interface SimulationGridProps {
  simulations: SimulationStatus[];
  totalSimulations: number;
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

/**
 * Visual grid of per-simulation statuses.
 * Each square represents one simulation, color-coded by state.
 * Hover shows details; looks like a GitHub contribution graph.
 */
export function SimulationGrid({ simulations, totalSimulations }: SimulationGridProps) {
  const [hoveredSim, setHoveredSim] = useState<SimulationStatus | null>(null);

  // Count by state
  const counts = simulations.reduce(
    (acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // If no simulations to show, render placeholder squares
  const cells: (SimulationStatus | null)[] = [];
  for (let i = 0; i < totalSimulations; i++) {
    cells.push(simulations.find((s) => s.index === i) ?? null);
  }

  // Adaptive cell size based on total count
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

      {/* Grid */}
      <div className={`flex flex-wrap ${gapSize}`}>
        {cells.map((sim, i) => {
          const state: SimulationState = sim?.state ?? 'PENDING';
          return (
            <div
              key={i}
              className={`${cellSize} rounded-sm cursor-default transition-transform hover:scale-125 ${STATE_COLORS[state]}`}
              onMouseEnter={() => sim && setHoveredSim(sim)}
              onMouseLeave={() => setHoveredSim(null)}
              title={sim ? `${sim.simId}: ${STATE_LABELS[state]}` : `sim_${String(i).padStart(3, '0')}: Pending`}
            />
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
          {(hoveredSim.workerName || hoveredSim.workerId) && (
            <div className="text-gray-500 text-xs">
              Worker: {hoveredSim.workerName || hoveredSim.workerId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
