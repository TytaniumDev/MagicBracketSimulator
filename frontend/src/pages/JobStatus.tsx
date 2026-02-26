import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getApiBase, fetchWithAuth, deleteJob } from '../api';
import { ColorIdentity } from '../components/ColorIdentity';
import { DeckShowcase } from '../components/DeckShowcase';
import { SimulationGrid } from '../components/SimulationGrid';
import { useJobData } from '../hooks/useJobData';
import { useWinData } from '../hooks/useWinData';
import { useJobLogs } from '../hooks/useJobLogs';
import { useWorkerStatus } from '../hooks/useWorkerStatus';
import { useAuth } from '../contexts/AuthContext';
import { matchesDeckName } from '../utils/deck-match';

type LogViewTab = 'raw' | 'condensed';

// Event type filter options for the UI
const EVENT_FILTER_OPTIONS = [
  { value: 'spell_cast', label: 'Spells' },
  { value: 'spell_cast_high_cmc', label: 'High CMC' },
  { value: 'land_played', label: 'Lands' },
  { value: 'life_change', label: 'Life Change' },
  { value: 'combat', label: 'Combat' },
  { value: 'win_condition', label: 'Win' },
  { value: 'zone_change_gy_to_bf', label: 'Reanimate' },
  { value: 'commander_cast', label: 'Commander' },
  { value: 'draw_extra', label: 'Draw' },
] as const;

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

export default function JobStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { workers, refresh: refreshWorkers } = useWorkerStatus(!!user);
  const apiBase = getApiBase();

  // UI-only state
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [logViewTab, setLogViewTab] = useState<LogViewTab>('condensed');
  const [selectedGame, setSelectedGame] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState(1);
  const [eventFilters, setEventFilters] = useState<Set<string>>(new Set());
  const [loadStructuredLogs, setLoadStructuredLogs] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeletingJob, setIsDeletingJob] = useState(false);
  const [isResubmitting, setIsResubmitting] = useState(false);

  // Data hooks
  const { job, setJob, simulations, error, setError } = useJobData(id);
  const logs = useJobLogs(id, job, { showLogPanel, loadStructured: loadStructuredLogs });
  const { winTally, winTurns, gamesPlayed, simGamesCompleted } = useWinData(
    job, simulations, logs.structuredGames, logs.deckNames,
  );

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <Link to="/" className="text-blue-400 hover:underline">
          Back to browse
        </Link>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        Loading job...
      </div>
    );
  }

  const statusLabel =
    job.status === 'QUEUED'
      ? (job.retryCount ?? 0) > 0
        ? 'Retrying...'
        : 'Queued'
      : job.status === 'RUNNING'
        ? 'Running'
        : job.status === 'COMPLETED'
          ? 'Completed'
          : job.status === 'CANCELLED'
            ? 'Cancelled'
            : 'Failed';

  const queuedAgo = job.status === 'QUEUED' && job.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 1000))
    : null;

  const handleCancel = async () => {
    if (!id) return;
    setIsCancelling(true);
    try {
      const response = await fetchWithAuth(`${apiBase}/api/jobs/${id}/cancel`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to cancel');
      }
      setJob((prev) => prev ? { ...prev, status: 'CANCELLED' } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this job? This cannot be undone.')) return;
    setIsDeletingJob(true);
    try {
      await deleteJob(id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setIsDeletingJob(false);
    }
  };

  const handleRunAgain = async () => {
    if (!job.deckIds || job.deckIds.length !== 4) return;
    setIsResubmitting(true);
    try {
      const response = await fetchWithAuth(`${apiBase}/api/jobs`, {
        method: 'POST',
        body: JSON.stringify({
          deckIds: job.deckIds,
          simulations: job.simulations,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create job');
      }
      const data = await response.json();
      navigate(`/jobs/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resubmit failed');
    } finally {
      setIsResubmitting(false);
    }
  };

  const currentGame = logs.structuredGames?.[selectedGame];
  const maxTurns = Math.max(1, currentGame?.totalTurns ?? 1);
  const isTerminal = job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <span aria-hidden>←</span>
          Back to browse
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">
          {job.simulations} Game Simulation
        </h1>
        {isTerminal && job.deckIds?.length === 4 && (
          <button
            type="button"
            onClick={handleRunAgain}
            disabled={isResubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResubmitting ? 'Submitting...' : 'Run Again'}
          </button>
        )}
      </div>
      <p className="text-gray-500 text-xs mb-6">ID: {job.id}</p>

      {/* Deck Showcase */}
      {job.deckNames?.length > 0 && (
        <DeckShowcase
          deckNames={job.deckNames}
          colorIdentityByDeckName={logs.colorIdentityByDeckName}
          winTally={winTally}
          winTurns={winTurns}
          gamesPlayed={gamesPlayed}
          totalSimulations={job.simulations}
          deckLinks={job.deckLinks}
          jobStatus={job.status}
        />
      )}

      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        {/* Rich Queue Info Panel for QUEUED jobs */}
        {job.status === 'QUEUED' && (
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 space-y-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
              </span>
              <span className="text-yellow-400 font-semibold text-lg">
                {(job.retryCount ?? 0) > 0 ? 'Retrying \u2014 waiting for a worker' : 'Waiting in Queue'}
              </span>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                className="ml-auto px-3 py-1 text-xs rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Job'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-800/50 rounded p-3">
                <div className="text-gray-400 text-xs mb-1">Queue Position</div>
                <div className="text-white font-medium">
                  {job.queuePosition != null
                    ? job.queuePosition === 0
                      ? 'Next up'
                      : `#${job.queuePosition + 1} in queue (${job.queuePosition} job${job.queuePosition !== 1 ? 's' : ''} ahead)`
                    : 'Calculating...'}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded p-3">
                <div className="text-gray-400 text-xs mb-1">Workers</div>
                {job.workers ? (
                  (() => {
                    const updating = job.workers.updating ?? 0;
                    const active = job.workers.online - updating;
                    const hasActive = active > 0;
                    const hasOnlyUpdating = job.workers.online > 0 && !hasActive;
                    return hasActive ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-white font-medium">
                          {job.workers.online} online
                          {job.workers.idle > 0 && ` (${job.workers.idle} idle)`}
                          {updating > 0 && ` (${updating} updating)`}
                        </span>
                      </div>
                    ) : hasOnlyUpdating ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-amber-400 font-medium">
                          {updating} worker{updating !== 1 ? 's' : ''} updating
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-red-400 font-medium">No workers online</span>
                      </div>
                    );
                  })()
                ) : (
                  <span className="text-gray-500">Checking...</span>
                )}
              </div>
              <div className="bg-gray-800/50 rounded p-3">
                <div className="text-gray-400 text-xs mb-1">Time in Queue</div>
                <div className="text-white font-medium">
                  {queuedAgo != null
                    ? queuedAgo < 60
                      ? `${queuedAgo}s ago`
                      : `${Math.floor(queuedAgo / 60)}m ${queuedAgo % 60}s ago`
                    : '...'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Standard status display for non-QUEUED jobs */}
        {job.status !== 'QUEUED' && (
        <div>
          <span className="text-gray-400">Status: </span>
          <span
            className={
              job.status === 'COMPLETED'
                ? 'text-green-400'
                : job.status === 'FAILED'
                  ? 'text-red-400'
                  : job.status === 'CANCELLED'
                    ? 'text-orange-400'
                    : 'text-yellow-400'
            }
          >
            {statusLabel}
          </span>
          {job.status === 'RUNNING' && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="ml-4 px-3 py-1 text-xs rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Job'}
            </button>
          )}
        </div>
        )}
        <div>
          <span className="text-gray-400">Games: </span>
          <span>{job.simulations}</span>
        </div>
        {isTerminal && job.durationMs != null && job.durationMs >= 0 && (
          <div>
            <span className="text-gray-400">Total run time: </span>
            <span>{formatDurationMs(job.durationMs)}</span>
          </div>
        )}
        {job.dockerRunDurationsMs != null && job.dockerRunDurationsMs.length > 0 && (
          <div>
            <span className="text-gray-400">Docker runs: </span>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-300">
              {job.dockerRunDurationsMs.map((ms, i) => (
                <span key={i}>
                  Run {i + 1}: {formatDurationMs(ms)}
                </span>
              ))}
            </div>
          </div>
        )}
        {job.status === 'RUNNING' && (() => {
          const progressGames = simulations.length > 0
            ? simGamesCompleted
            : (job.gamesCompleted ?? 0);
          return progressGames > 0 ? (
          <div className="space-y-2">
            <div>
              <span className="text-gray-400">Progress: </span>
              <span className="text-white font-medium">
                {progressGames} / {job.simulations} games
              </span>
            </div>
            <div
              className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden"
              role="progressbar"
              aria-valuenow={progressGames}
              aria-valuemin={0}
              aria-valuemax={job.simulations}
            >
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (progressGames / job.simulations) * 100)}%`,
                }}
              />
            </div>
          </div>
          ) : null;
        })()}
        {/* Per-simulation grid */}
        {(job.status === 'RUNNING' || isTerminal) && simulations.length > 0 && (
          <SimulationGrid
            simulations={simulations}
            totalSimulations={job.simulations}
            workers={workers}
            userEmail={user?.email}
            onWorkerRefresh={refreshWorkers}
            isAuthenticated={!!user}
          />
        )}
        {job.status === 'FAILED' && job.errorMessage && (
          <div className="bg-red-900/30 border border-red-600 rounded p-3 text-red-200">
            {job.errorMessage}
          </div>
        )}

        {/* Deck Actions Section */}
        {isTerminal && (
          <div className="pt-4 border-t border-gray-600">
            <h3 className="text-lg font-semibold text-gray-200 mb-4">Deck Actions</h3>
            {logs.structuredError && (
              <p className="text-sm text-red-400 mb-2">{logs.structuredError}</p>
            )}
            {logs.structuredGames === null && !logs.structuredError && !loadStructuredLogs && (
              <button
                type="button"
                onClick={() => setLoadStructuredLogs(true)}
                className="px-4 py-2 text-sm bg-gray-700 text-gray-200 rounded hover:bg-gray-600 transition-colors"
              >
                Load Deck Actions
              </button>
            )}
            {logs.structuredGames === null && !logs.structuredError && loadStructuredLogs && (
              <p className="text-sm text-gray-500">Loading deck actions...</p>
            )}
            {logs.structuredGames && logs.structuredGames.length === 0 && !logs.structuredError && (
              <p className="text-sm text-gray-500">
                Logs not available.
              </p>
            )}
            {logs.structuredGames && logs.structuredGames.length > 0 && (
              <div>
                {/* Game and Turn selector */}
                <div className="flex flex-wrap gap-4 mb-4 items-center">
                  {logs.structuredGames.length > 1 && (
                    <div className="flex items-center gap-2">
                      <label htmlFor="game-select" className="text-sm text-gray-400">Game:</label>
                      <select
                        id="game-select"
                        value={selectedGame}
                        onChange={(e) => {
                          setSelectedGame(Number(e.target.value));
                          setSelectedTurn(1);
                        }}
                        className="bg-gray-700 text-white text-sm rounded px-2 py-1"
                      >
                        {logs.structuredGames.map((_, i) => (
                          <option key={i} value={i}>Game {i + 1}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label htmlFor="turn-slider" className="text-sm text-gray-400">Turn:</label>
                    <button
                      type="button"
                      onClick={() => setSelectedTurn((t) => Math.max(1, t - 1))}
                      disabled={selectedTurn <= 1}
                      className="px-2 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Previous turn"
                      aria-label="Previous turn"
                    >
                      Prev
                    </button>
                    <input
                      id="turn-slider"
                      type="range"
                      min={1}
                      max={maxTurns}
                      value={selectedTurn}
                      onChange={(e) => setSelectedTurn(Number(e.target.value))}
                      className="w-32"
                    />
                    <span className="text-sm text-white min-w-[3rem]">
                      {selectedTurn} / {maxTurns}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedTurn((t) => Math.min(maxTurns, t + 1))}
                      disabled={selectedTurn >= maxTurns}
                      className="px-2 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Next turn"
                      aria-label="Next turn"
                    >
                      Next
                    </button>
                  </div>
                </div>

                {/* Event type filter */}
                <div className="flex flex-wrap gap-2 mb-4 items-center">
                  <span className="text-sm text-gray-400">Filter:</span>
                  <button
                    type="button"
                    onClick={() => setEventFilters(new Set())}
                    aria-pressed={eventFilters.size === 0}
                    className={`px-2 py-1 text-xs rounded ${
                      eventFilters.size === 0
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    All
                  </button>
                  {EVENT_FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={eventFilters.has(opt.value)}
                      onClick={() => {
                        setEventFilters((prev) => {
                          const next = new Set(prev);
                          if (next.has(opt.value)) {
                            next.delete(opt.value);
                          } else {
                            next.add(opt.value);
                          }
                          return next;
                        });
                      }}
                      className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                        eventFilters.has(opt.value)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded"
                        style={{ backgroundColor: getEventColor(opt.value) }}
                      ></span>
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 4-Deck Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {currentGame?.decks.slice(0, 4).map((deck, i) => {
                    const turnActions = deck.turns.find(t => t.turnNumber === selectedTurn);
                    const label = logs.deckNames?.[i] ?? deck.deckLabel;
                    const isHero = i === 0;

                    const turnLifeTotals = currentGame?.lifePerTurn?.[selectedTurn];
                    const lifeTotal = turnLifeTotals ? (() => {
                      for (const [playerName, life] of Object.entries(turnLifeTotals)) {
                        if (matchesDeckName(playerName, label)) {
                          return life;
                        }
                      }
                      return undefined;
                    })() : undefined;

                    const filteredActions = turnActions?.actions.filter((action) => {
                      if (eventFilters.size === 0) return true;
                      if (eventFilters.has('land_played') && action.line.startsWith('Land:')) {
                        return true;
                      }
                      if (action.eventType && eventFilters.has(action.eventType)) {
                        return true;
                      }
                      return false;
                    }) ?? [];

                    return (
                      <div
                        key={i}
                        className={`rounded-lg p-3 border ${
                          isHero
                            ? 'bg-blue-900/30 border-blue-600'
                            : 'bg-gray-900 border-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={`text-sm font-semibold truncate flex items-center gap-1 ${
                            isHero ? 'text-blue-300' : 'text-gray-300'
                          }`}>
                            {isHero ? '(Hero) ' : ''}{label}
                            <ColorIdentity colorIdentity={logs.colorIdentityByDeckName[label]} />
                          </h4>
                          {lifeTotal !== undefined && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              lifeTotal <= 0
                                ? 'bg-red-900/50 text-red-400'
                                : lifeTotal <= 10
                                  ? 'bg-orange-900/50 text-orange-400'
                                  : 'bg-gray-700 text-gray-300'
                            }`}>
                              {lifeTotal} life
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {filteredActions.length === 0 ? (
                            <p className="text-xs text-gray-500 italic">
                              {eventFilters.size > 0 ? 'No matching actions' : 'No actions this turn'}
                            </p>
                          ) : (
                            filteredActions.map((action, j) => (
                              <div
                                key={j}
                                className="text-xs font-mono text-gray-300 py-0.5 border-l-2 pl-2"
                                style={{
                                  borderColor: getEventColor(action.eventType),
                                }}
                              >
                                {action.line}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Event type legend */}
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('spell_cast') }}></span>
                    Spell
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('spell_cast_high_cmc') }}></span>
                    High CMC
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('land_played') }}></span>
                    Land
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('life_change') }}></span>
                    Life Change
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('win_condition') }}></span>
                    Win
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor('combat') }}></span>
                    Combat
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded" style={{ backgroundColor: getEventColor(undefined) }}></span>
                    Other
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Detailed Game Logs Panel (collapsible) */}
        {isTerminal && (
          <div className="pt-4 border-t border-gray-600">
            <button
              type="button"
              onClick={() => setShowLogPanel((v) => !v)}
              className="text-sm text-gray-500 hover:text-gray-400"
              aria-expanded={showLogPanel}
              aria-controls="log-panel-section"
            >
              {showLogPanel ? 'Hide' : 'Show'} detailed game logs
            </button>

            {showLogPanel && (
              <div id="log-panel-section" className="mt-4">
                <div className="flex gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setLogViewTab('condensed')}
                    className={`px-3 py-1 rounded text-sm ${
                      logViewTab === 'condensed'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    Condensed (AI Input)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogViewTab('raw')}
                    className={`px-3 py-1 rounded text-sm ${
                      logViewTab === 'raw'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    Raw Logs
                  </button>
                </div>

                {/* Condensed Logs View */}
                {logViewTab === 'condensed' && (
                  <div>
                    {logs.condensedError && (
                      <p className="text-sm text-red-400 mb-2">{logs.condensedError}</p>
                    )}
                    {logs.condensedLogs && logs.condensedLogs.length === 0 && !logs.condensedError && (
                      <p className="text-sm text-gray-500">
                        Condensed logs not available.
                      </p>
                    )}
                    {logs.condensedLogs && logs.condensedLogs.length > 0 && (
                      <div className="space-y-4">
                        <p className="text-xs text-gray-400">
                          This is the condensed data sent to the AI for bracket analysis.
                        </p>
                        {logs.condensedLogs.map((game, i) => (
                          <div key={i} className="bg-gray-900 rounded p-3">
                            <h4 className="text-xs font-semibold text-gray-500 mb-2">
                              Game {i + 1}
                              {game.winner && ` - Winner: ${game.winner}`}
                              {game.winningTurn && ` (Turn ${game.winningTurn})`}
                            </h4>
                            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                              <div className="bg-gray-800 rounded p-2">
                                <span className="text-gray-400">Turn Count: </span>
                                <span className="text-white">{game.turnCount}</span>
                              </div>
                              <div className="bg-gray-800 rounded p-2">
                                <span className="text-gray-400">Events Kept: </span>
                                <span className="text-white">{game.keptEvents.length}</span>
                              </div>
                            </div>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {game.keptEvents.map((event, j) => (
                                <div
                                  key={j}
                                  className="text-xs font-mono py-0.5 border-l-2 pl-2"
                                  style={{ borderColor: getEventColor(event.type) }}
                                >
                                  <span className="text-gray-500">[{event.type}]</span>{' '}
                                  <span className="text-gray-300">{event.line}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Raw Logs View */}
                {logViewTab === 'raw' && (
                  <div>
                    {logs.rawLogsError && (
                      <p className="text-sm text-red-400 mb-2">{logs.rawLogsError}</p>
                    )}
                    {logs.rawLogs != null && logs.rawLogs.length === 0 && !logs.rawLogsError && (
                      <p className="text-sm text-gray-500">
                        Logs not available (job may still be running or logs were cleaned up).
                      </p>
                    )}
                    {logs.rawLogs != null && logs.rawLogs.length > 0 && (
                      <div className="space-y-4">
                        {logs.rawLogs.map((log, i) => (
                          <div key={i} className="bg-gray-900 rounded p-3">
                            <h4 className="text-xs font-semibold text-gray-500 mb-2">Game {i + 1}</h4>
                            <pre className="text-xs overflow-auto max-h-64 whitespace-pre-wrap text-gray-400 font-mono">
                              {log}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-4">
        <Link to="/" className="text-blue-400 hover:underline">
          Browse all simulations
        </Link>
        <Link to="/submit" className="text-blue-400 hover:underline">
          Submit another simulation
        </Link>
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeletingJob}
            className="ml-auto px-3 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeletingJob ? 'Deleting...' : 'Delete Job'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Returns a color for a given event type (for visual distinction in the UI).
 */
function getEventColor(eventType: string | undefined): string {
  switch (eventType) {
    case 'spell_cast':
      return '#60a5fa'; // blue-400
    case 'spell_cast_high_cmc':
      return '#a78bfa'; // violet-400
    case 'land_played':
      return '#34d399'; // emerald-400
    case 'life_change':
      return '#f87171'; // red-400
    case 'win_condition':
      return '#4ade80'; // green-400
    case 'zone_change_gy_to_bf':
      return '#fbbf24'; // amber-400
    case 'commander_cast':
      return '#c084fc'; // purple-400
    case 'draw_extra':
      return '#22d3ee'; // cyan-400
    case 'combat':
      return '#fb923c'; // orange-400
    default:
      return '#6b7280'; // gray-500
  }
}
