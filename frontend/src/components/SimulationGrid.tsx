import { useState, useMemo, memo } from 'react';
import type { SimulationStatus, SimulationState } from '../types/simulation';
import { GAMES_PER_CONTAINER } from '../types/simulation';
import type { WorkerInfo } from '../types/worker';
import { WorkerOverrideControls } from './WorkerOverrideControls';

interface SimulationGridProps {
  simulations: SimulationStatus[];
  totalSimulations: number;
  workers?: WorkerInfo[];
  userEmail?: string | null;
  onWorkerRefresh?: () => Promise<void>;
  isAuthenticated?: boolean;
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

/** A single game cell expanded from a container-level SimulationStatus. */
interface GameCell {
  state: SimulationState;
  winner?: string;
  winningTurn?: number;
  durationMs?: number;
  errorMessage?: string;
  containerSimId: string;
  gameIndex: number; // 0-based index within the container
  workerId?: string;
  workerName?: string;
}

interface GameGroup {
  label: string;
  workerId: string | null;
  workerName?: string;
  cells: GameCell[];
}

/**
 * Expand a container-level SimulationStatus into GAMES_PER_CONTAINER game cells.
 */
function expandContainerToGames(sim: SimulationStatus): GameCell[] {
  const cells: GameCell[] = [];
  for (let g = 0; g < GAMES_PER_CONTAINER; g++) {
    if (sim.state === 'COMPLETED') {
      cells.push({
        state: 'COMPLETED',
        winner: sim.winners?.[g],
        winningTurn: sim.winningTurns?.[g],
        durationMs: sim.durationMs,
        containerSimId: sim.simId,
        gameIndex: g,
        workerId: sim.workerId,
        workerName: sim.workerName,
      });
    } else if (sim.state === 'FAILED') {
      cells.push({
        state: 'FAILED',
        errorMessage: sim.errorMessage,
        durationMs: sim.durationMs,
        containerSimId: sim.simId,
        gameIndex: g,
        workerId: sim.workerId,
        workerName: sim.workerName,
      });
    } else {
      // PENDING, RUNNING, CANCELLED — all games inherit the container state
      cells.push({
        state: sim.state,
        durationMs: sim.durationMs,
        errorMessage: sim.errorMessage,
        containerSimId: sim.simId,
        gameIndex: g,
        workerId: sim.workerId,
        workerName: sim.workerName,
      });
    }
  }
  return cells;
}

/**
 * Visual grid of per-game statuses, grouped by worker.
 * Each square represents one game, color-coded by state.
 * Container-level records are expanded into GAMES_PER_CONTAINER game cells each.
 *
 * Memoized to prevent re-renders when parent state changes (e.g. log navigation)
 * but simulation data remains stable.
 */
export const SimulationGrid = memo(function SimulationGrid({ simulations, totalSimulations, workers, userEmail, onWorkerRefresh, isAuthenticated = false }: SimulationGridProps) {
  const [hoveredGame, setHoveredGame] = useState<GameCell | null>(null);

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

  // Expand containers into game cells and group by worker
  const { groups, gameCounts } = useMemo(() => {
    // Total expected containers
    const totalContainers = Math.ceil(totalSimulations / GAMES_PER_CONTAINER);

    // Build a lookup from container index to SimulationStatus
    const simByIndex = new Map<number, SimulationStatus>();
    for (const s of simulations) {
      simByIndex.set(s.index, s);
    }

    // Separate into pending (no workerId) and assigned (has workerId)
    const pendingGameCells: GameCell[] = [];
    const wMap = new Map<string, { games: GameCell[]; earliestIndex: number; workerName?: string }>();

    for (let i = 0; i < totalContainers; i++) {
      const sim = simByIndex.get(i);
      if (!sim || !sim.workerId) {
        // Unassigned or missing — expand to pending game cells
        if (sim) {
          pendingGameCells.push(...expandContainerToGames(sim));
        } else {
          // No record yet — create GAMES_PER_CONTAINER pending placeholders
          for (let g = 0; g < GAMES_PER_CONTAINER; g++) {
            pendingGameCells.push({
              state: 'PENDING',
              containerSimId: `sim_${String(i).padStart(3, '0')}`,
              gameIndex: g,
            });
          }
        }
      } else {
        const gameCells = expandContainerToGames(sim);
        const existing = wMap.get(sim.workerId);
        if (existing) {
          existing.games.push(...gameCells);
        } else {
          wMap.set(sim.workerId, {
            games: gameCells,
            earliestIndex: i,
            workerName: sim.workerName,
          });
        }
      }
    }

    const result: GameGroup[] = [];

    // Pending group always first
    if (pendingGameCells.length > 0) {
      result.push({
        label: 'Pending',
        workerId: null,
        cells: pendingGameCells,
      });
    }

    // Worker groups sorted by earliest container index
    const sortedWorkers = [...wMap.entries()].sort(
      ([, a], [, b]) => a.earliestIndex - b.earliestIndex
    );

    for (let wi = 0; wi < sortedWorkers.length; wi++) {
      const [workerId, { games, workerName }] = sortedWorkers[wi];
      result.push({
        label: isAuthenticated ? (workerName || workerId.slice(0, 8)) : `Worker ${wi + 1}`,
        workerId,
        workerName,
        cells: games,
      });
    }

    // Count games by state across all groups
    const counts: Record<string, number> = {};
    for (const group of result) {
      for (const cell of group.cells) {
        counts[cell.state] = (counts[cell.state] || 0) + 1;
      }
    }

    return { groups: result, gameCounts: counts };
  }, [simulations, totalSimulations, isAuthenticated]);

  // Adaptive cell size based on total game count (global for consistency)
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
            {gameCounts[state] ? ` (${gameCounts[state]})` : ''}
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
                {isAuthenticated && isOwner && worker && (
                  <WorkerOverrideControls worker={worker} onRefresh={onWorkerRefresh} compact />
                )}

                {/* Read-only override for non-owned workers */}
                {isAuthenticated && !isOwner && worker && worker.maxConcurrentOverride != null && (
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
                {group.cells.map((game) => (
                  <div
                    key={`${game.containerSimId}-g${game.gameIndex}`}
                    className={`${cellSize} rounded-sm cursor-default transition-transform hover:scale-125 ${STATE_COLORS[game.state]}`}
                    onMouseEnter={() => setHoveredGame(game)}
                    onMouseLeave={() => setHoveredGame(null)}
                    title={`${game.containerSimId} game ${game.gameIndex + 1}: ${STATE_LABELS[game.state]}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip details */}
      {hoveredGame && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${STATE_COLORS[hoveredGame.state].replace(' animate-pulse', '')}`} />
            <span className="font-medium text-white">
              Game {hoveredGame.gameIndex + 1} of {hoveredGame.containerSimId}
            </span>
            <span className="text-gray-400">— {STATE_LABELS[hoveredGame.state]}</span>
          </div>
          {hoveredGame.durationMs != null && (
            <div className="text-gray-400">
              Container duration: <span className="text-gray-200">{formatDuration(hoveredGame.durationMs)}</span>
            </div>
          )}
          {hoveredGame.winner && (
            <div className="text-gray-400">
              Winner: <span className="text-emerald-400">{hoveredGame.winner}</span>
              {hoveredGame.winningTurn != null && (
                <span> (turn {hoveredGame.winningTurn})</span>
              )}
            </div>
          )}
          {hoveredGame.errorMessage && (
            <div className="text-red-400 text-xs">
              {hoveredGame.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
