import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getApiBase, getLogAnalyzerBase, fetchWithAuth } from '../api';
import { ColorIdentity } from '../components/ColorIdentity';

type JobStatusValue = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

interface DeckBracketResult {
  deck_name: string;
  bracket: number;
  confidence: string;
  reasoning: string;
  weaknesses?: string;
}

interface AnalysisResult {
  results: DeckBracketResult[];
}

interface Job {
  id: string;
  name: string;
  deckNames: string[];
  status: JobStatusValue;
  simulations: number;
  parallelism?: number;
  createdAt: string;
  errorMessage?: string;
  resultJson?: AnalysisResult;
  gamesCompleted?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  dockerRunDurationsMs?: number[] | null;
}

// Types for Log Analyzer responses
interface GameEvent {
  type: string;
  line: string;
  turn?: number;
  player?: string;
}

interface CondensedGame {
  keptEvents: GameEvent[];
  manaPerTurn: Record<string, { manaEvents: number }>;
  cardsDrawnPerTurn: Record<string, number>;
  turnCount: number;
  winner?: string;
  winningTurn?: number;
}

interface DeckAction {
  line: string;
  eventType?: string;
}

interface DeckTurnActions {
  turnNumber: number;
  actions: DeckAction[];
}

interface DeckHistory {
  deckLabel: string;
  turns: DeckTurnActions[];
}

interface StructuredGame {
  totalTurns: number;
  players: string[];
  decks: DeckHistory[];
  lifePerTurn?: Record<number, Record<string, number>>;
  winner?: string;
  winningTurn?: number;
}

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
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [logViewTab, setLogViewTab] = useState<LogViewTab>('condensed');
  
  // Log data states
  const [rawLogs, setRawLogs] = useState<string[] | null>(null);
  const [rawLogsError, setRawLogsError] = useState<string | null>(null);
  const [condensedLogs, setCondensedLogs] = useState<CondensedGame[] | null>(null);
  const [condensedError, setCondensedError] = useState<string | null>(null);
  const [structuredGames, setStructuredGames] = useState<StructuredGame[] | null>(null);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const [deckNames, setDeckNames] = useState<string[] | null>(null);
  const [colorIdentityByDeckName, setColorIdentityByDeckName] = useState<Record<string, string[]>>({});
  
  // Turn viewer state
  const [selectedGame, setSelectedGame] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState(1);
  
  // Event type filter state - empty set means show all
  const [eventFilters, setEventFilters] = useState<Set<string>>(new Set());
  
  // Analyze payload and trigger state
  const [analyzePayload, setAnalyzePayload] = useState<object | null>(null);
  const [analyzePayloadError, setAnalyzePayloadError] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [promptPreview, setPromptPreview] = useState<{ system_prompt: string; user_prompt: string } | null>(null);
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  
  const apiBase = getApiBase();
  const logAnalyzerBase = getLogAnalyzerBase();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch job status
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const fetchJob = () => {
      fetchWithAuth(`${apiBase}/api/jobs/${id}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) throw new Error('Job not found');
            throw new Error('Failed to load job');
          }
          return res.json();
        })
        .then((data) => {
          setJob(data);
          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setError(err.message);
        });
    };
    fetchJob();
    intervalRef.current = setInterval(fetchJob, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      controller.abort();
    };
  }, [id, apiBase]);

  // Fetch structured logs for Deck Actions when job is completed/failed
  useEffect(() => {
    if (!id || !job) return;
    if (job.status !== 'COMPLETED' && job.status !== 'FAILED') return;
    if (structuredGames !== null) return; // Already fetched
    
    setStructuredError(null);
    fetchWithAuth(`${logAnalyzerBase}/jobs/${id}/logs/structured`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) return { games: [], deckNames: [] };
          throw new Error('Failed to load structured logs');
        }
        return res.json();
      })
      .then((data) => {
        setStructuredGames(data.games ?? []);
        setDeckNames(data.deckNames ?? null);
      })
      .catch((err) => setStructuredError(err instanceof Error ? err.message : 'Unknown error'));
  }, [id, logAnalyzerBase, job, structuredGames]);

  // Fetch color identity for deck names (job.deckNames, deckNames from logs, result.results)
  useEffect(() => {
    if (!job) return;
    const names = new Set<string>();
    job.deckNames?.forEach((n) => names.add(n));
    deckNames?.forEach((n) => names.add(n));
    const result = job.resultJson;
    result?.results?.forEach((r) => r.deck_name && names.add(r.deck_name));
    const list = Array.from(names);
    if (list.length === 0) return;
    const params = new URLSearchParams({ names: list.join(',') });
    fetchWithAuth(`${apiBase}/api/deck-color-identity?${params}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, string[]>) => setColorIdentityByDeckName(data))
      .catch(() => {});
  }, [apiBase, job?.id, job?.deckNames, deckNames, job?.resultJson?.results]);

  // Fetch analyze payload when job is completed (for on-demand analysis)
  useEffect(() => {
    if (!id || !job) return;
    if (job.status !== 'COMPLETED' && job.status !== 'FAILED') return;
    if (analyzePayload !== null) return; // Already fetched
    
    setAnalyzePayloadError(null);
    fetchWithAuth(`${logAnalyzerBase}/jobs/${id}/logs/analyze-payload`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) return null;
          throw new Error('Failed to load analyze payload');
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setAnalyzePayload(data);
        }
      })
      .catch((err) => setAnalyzePayloadError(err instanceof Error ? err.message : 'Unknown error'));
  }, [id, logAnalyzerBase, job, analyzePayload]);

  // Fetch exact prompt preview when user expands "data sent to Gemini"
  useEffect(() => {
    if (!id || !showPayload || !analyzePayload) return;
    setPromptPreviewError(null);
    setPromptPreview(null);
    fetchWithAuth(`${logAnalyzerBase}/jobs/${id}/logs/analyze-prompt-preview`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          let msg: string;
          try {
            const d = JSON.parse(text) as { error?: string; details?: string };
            msg = d.details || d.error || text || `Preview failed: ${res.status}`;
          } catch {
            msg = text || `Preview failed: ${res.status}`;
          }
          throw new Error(msg);
        }
        return res.json() as Promise<{ system_prompt: string; user_prompt: string }>;
      })
      .then((data) => {
        setPromptPreview(data);
      })
      .catch((err) => setPromptPreviewError(err instanceof Error ? err.message : 'Unknown error'));
  }, [id, logAnalyzerBase, showPayload, analyzePayload]);

  // Fetch raw and condensed logs when log panel is opened
  useEffect(() => {
    if (!id || !showLogPanel) return;
    
    // Fetch raw logs
    if (rawLogs === null) {
      setRawLogsError(null);
      fetchWithAuth(`${logAnalyzerBase}/jobs/${id}/logs/raw`)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) return { gameLogs: [] };
            throw new Error('Failed to load raw logs');
          }
          return res.json();
        })
        .then((data) => setRawLogs(data.gameLogs ?? []))
        .catch((err) => setRawLogsError(err instanceof Error ? err.message : 'Unknown error'));
    }
    
    // Fetch condensed logs
    if (condensedLogs === null) {
      setCondensedError(null);
      fetchWithAuth(`${logAnalyzerBase}/jobs/${id}/logs/condensed`)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) return { condensed: [] };
            throw new Error('Failed to load condensed logs');
          }
          return res.json();
        })
        .then((data) => setCondensedLogs(data.condensed ?? []))
        .catch((err) => setCondensedError(err instanceof Error ? err.message : 'Unknown error'));
    }
  }, [id, logAnalyzerBase, showLogPanel, rawLogs, condensedLogs]);

  // Compute win tally and winning turns from structured games (must be before early returns)
  const { winTally, winTurns } = useMemo(() => {
    if (!structuredGames || structuredGames.length === 0) {
      return { winTally: null, winTurns: null };
    }
    
    const tally: Record<string, number> = {};
    const turns: Record<string, number[]> = {};
    
    // Initialize tally and turns for all known decks
    if (deckNames) {
      for (const name of deckNames) {
        tally[name] = 0;
        turns[name] = [];
      }
    }
    
    // Count wins and track winning turns
    for (const game of structuredGames) {
      if (game.winner) {
        // Try to match winner to deck name
        // Winner might be in format "Ai(N)-DeckName" or just "DeckName"
        let matchedDeck = game.winner;
        if (deckNames) {
          const found = deckNames.find(
            (name) => game.winner === name || game.winner?.endsWith(`-${name}`)
          );
          if (found) {
            matchedDeck = found;
          }
        }
        tally[matchedDeck] = (tally[matchedDeck] || 0) + 1;
        
        // Track the turn this deck won on
        if (game.winningTurn !== undefined) {
          if (!turns[matchedDeck]) {
            turns[matchedDeck] = [];
          }
          turns[matchedDeck].push(game.winningTurn);
        }
      }
    }
    
    // Sort winning turns for each deck
    for (const deck of Object.keys(turns)) {
      turns[deck].sort((a, b) => a - b);
    }
    
    return { winTally: tally, winTurns: turns };
  }, [structuredGames, deckNames]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <Link to="/" className="text-blue-400 hover:underline">
          Back to home
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
      ? 'Queued'
      : job.status === 'RUNNING'
        ? 'Running'
        : job.status === 'ANALYZING'
          ? 'Analyzing results...'
          : job.status === 'COMPLETED'
            ? 'Completed'
            : 'Failed';

  const result = job.resultJson;
  
  // Handler to trigger on-demand AI analysis
  const handleAnalyze = async () => {
    if (!id) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    
    try {
      const response = await fetchWithAuth(`${apiBase}/api/jobs/${id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Analysis failed');
      }
      
      const analysisResult = await response.json();
      // Update job state with the new result
      setJob((prev) => prev ? { ...prev, resultJson: analysisResult } : null);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Get current structured game
  const currentGame = structuredGames?.[selectedGame];
  // Ensure maxTurns is at least 1 for display (prevents "1/0" if backend returns 0)
  const maxTurns = Math.max(1, currentGame?.totalTurns ?? 1);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <span aria-hidden>←</span>
          Back to home
        </Link>
      </div>
      <h1 className="text-3xl font-bold mb-2">
        {job.name || `${job.simulations} games - ${job.id.slice(0, 8)}`}
      </h1>
      <p className="text-gray-400 text-sm mb-2">
        {job.deckNames?.join(', ')}
      </p>
      <p className="text-gray-500 text-xs mb-6">ID: {job.id}</p>

      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div>
          <span className="text-gray-400">Status: </span>
          <span
            className={
              job.status === 'COMPLETED'
                ? 'text-green-400'
                : job.status === 'FAILED'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }
          >
            {statusLabel}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Simulations: </span>
          <span>{job.simulations}</span>
        </div>
        {job.parallelism != null && (
          <div>
            <span className="text-gray-400">Parallel runs: </span>
            <span>{job.parallelism}</span>
          </div>
        )}
        {(job.status === 'COMPLETED' || job.status === 'FAILED') && job.durationMs != null && job.durationMs >= 0 && (
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
        {(job.status === 'RUNNING' || job.status === 'ANALYZING') && job.gamesCompleted != null && (
          <div className="space-y-2">
            <div>
              <span className="text-gray-400">Progress: </span>
              <span className="text-white font-medium">
                {job.gamesCompleted} / {job.simulations} games
              </span>
            </div>
            <div
              className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden"
              role="progressbar"
              aria-valuenow={job.gamesCompleted}
              aria-valuemin={0}
              aria-valuemax={job.simulations}
            >
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (job.gamesCompleted / job.simulations) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        {job.deckNames?.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-gray-400">Decks: </span>
            {job.deckNames.map((name) => (
              <span key={name} className="inline-flex items-center gap-1">
                {name}
                <ColorIdentity colorIdentity={colorIdentityByDeckName[name]} />
              </span>
            ))}
          </div>
        )}
        {job.status === 'FAILED' && job.errorMessage && (
          <div className="bg-red-900/30 border border-red-600 rounded p-3 text-red-200">
            {job.errorMessage}
          </div>
        )}
        {/* Win summary - shown for any completed/failed job with game data */}
        {(job.status === 'COMPLETED' || job.status === 'FAILED') && winTally && Object.keys(winTally).length > 0 && (
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              Games Won ({structuredGames?.length ?? 0} games played)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(winTally)
                .sort(([, a], [, b]) => b - a)
                .map(([deck, wins]) => {
                  const deckWinTurns = winTurns?.[deck] ?? [];
                  return (
                    <div
                      key={deck}
                      className="bg-gray-800/50 rounded p-3 text-center"
                    >
                      <div className="text-lg font-bold text-blue-400">{wins}</div>
                      <div className="flex items-center justify-center gap-1 text-xs text-gray-400 truncate" title={deck}>
                        <span className="truncate">{deck}</span>
                        <ColorIdentity colorIdentity={colorIdentityByDeckName[deck]} />
                      </div>
                      {deckWinTurns.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {deckWinTurns.length === 1
                            ? `Won on turn ${deckWinTurns[0]}`
                            : `Turns: ${deckWinTurns.join(', ')}`}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* AI Analysis Section - shown for completed jobs */}
        {job.status === 'COMPLETED' && (
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
            <h3 className="text-lg font-semibold text-gray-200 mb-3">AI Analysis</h3>
            
            {/* No analysis yet - show analyze button */}
            {!result && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Simulations complete. Review the data below and click to analyze with Gemini.
                </p>
                {/* Analyze Error */}
                {analyzeError && (
                  <div className="bg-red-900/30 border border-red-600 rounded p-3 text-red-200 text-sm">
                    {analyzeError}
                  </div>
                )}
                {/* Analyze Button */}
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || analyzePayload === null}
                  className={`w-full py-3 rounded-md font-semibold ${
                    isAnalyzing || analyzePayload === null
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {isAnalyzing ? 'Analyzing with Gemini...' : 'Send to Gemini to Analyze'}
                </button>
              </div>
            )}
            
            {/* Exact data and prompt sent to Gemini - always visible for completed jobs */}
            <div className={result ? 'mt-4 pt-4 border-t border-gray-600' : ''}>
              <button
                type="button"
                onClick={() => setShowPayload((v) => !v)}
                className="text-sm text-blue-400 hover:text-blue-300 mb-2"
              >
                {showPayload ? 'Hide' : 'Show'} exact data and prompt sent to Gemini
              </button>
              {showPayload && (
                <div className="mt-2 space-y-4">
                  {analyzePayloadError && (
                    <p className="text-sm text-red-400">{analyzePayloadError}</p>
                  )}
                  {analyzePayload === null && !analyzePayloadError && (
                    <p className="text-sm text-gray-500">Loading...</p>
                  )}
                  {analyzePayload && (
                    <>
                      {Array.isArray((analyzePayload as { decks?: { decklist?: string }[] }).decks) &&
                        (analyzePayload as { decks: { decklist?: string }[] }).decks.some(
                          (d) => !d.decklist || d.decklist.trim() === ''
                        ) && (
                        <p className="text-xs text-amber-400/90">
                          This job was run before decklists were stored. Decklists below may be missing. Re-run the simulation to include full decklists in the payload.
                        </p>
                      )}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 mb-1">
                          1. Request body sent to Analysis Service (then used to build the prompt)
                        </h4>
                        <pre className="text-xs overflow-auto max-h-80 p-3 bg-gray-900 rounded whitespace-pre-wrap text-gray-400 font-mono border border-gray-700">
                          {JSON.stringify(analyzePayload, null, 2)}
                        </pre>
                      </div>
                      {promptPreviewError && (
                        <div className="text-sm text-red-400 space-y-1">
                          <p>{promptPreviewError}</p>
                          <p className="text-xs text-gray-400">
                            If the prompt preview fails, ensure the Analysis Service is running (default port 8000).
                          </p>
                        </div>
                      )}
                      {promptPreview === null && !promptPreviewError && (
                        <p className="text-sm text-gray-500">Loading prompt preview...</p>
                      )}
                      {promptPreview && (
                        <>
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 mb-1">
                              2. System instruction (sent to Gemini)
                            </h4>
                            <pre className="text-xs overflow-auto max-h-80 p-3 bg-gray-900 rounded whitespace-pre-wrap text-gray-300 font-mono border border-gray-700">
                              {promptPreview.system_prompt}
                            </pre>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 mb-1">
                              3. User message (sent to Gemini — includes rubric, decklists, outcomes)
                            </h4>
                            <pre className="text-xs overflow-auto max-h-96 p-3 bg-gray-900 rounded whitespace-pre-wrap text-gray-300 font-mono border border-gray-700">
                              {promptPreview.user_prompt}
                            </pre>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* Analysis result exists - show bracket for each deck */}
            {result && result.results && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {result.results.map((deckResult, idx) => (
                    <div
                      key={deckResult.deck_name || idx}
                      className="bg-gray-800/50 rounded-lg p-4 border border-gray-600"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-200 truncate flex items-center gap-1" title={deckResult.deck_name}>
                          {deckResult.deck_name}
                          <ColorIdentity colorIdentity={colorIdentityByDeckName[deckResult.deck_name]} />
                        </h4>
                        <span className="text-xl font-bold text-green-400 shrink-0">
                          B{deckResult.bracket}
                        </span>
                      </div>
                      {deckResult.confidence && (
                        <p className="text-xs text-gray-400 mb-2">
                          Confidence: {deckResult.confidence}
                        </p>
                      )}
                      {deckResult.reasoning && (
                        <div className="mb-2">
                          <p className="text-xs text-gray-300 line-clamp-3">
                            {deckResult.reasoning}
                          </p>
                        </div>
                      )}
                      {deckResult.weaknesses && (
                        <div>
                          <p className="text-xs text-gray-500">
                            <span className="text-gray-400">Weaknesses: </span>
                            {deckResult.weaknesses}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setShowRawJson((v) => !v)}
                    className="text-sm text-gray-500 hover:text-gray-400"
                  >
                    {showRawJson ? 'Hide' : 'Show'} raw JSON
                  </button>
                  {showRawJson && (
                    <pre className="mt-2 text-xs overflow-auto max-h-64 p-3 bg-gray-900 rounded whitespace-pre-wrap text-gray-400">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Deck Actions Section - shown by default for completed jobs */}
        {(job.status === 'COMPLETED' || job.status === 'FAILED') && (
          <div className="pt-4 border-t border-gray-600">
            <h3 className="text-lg font-semibold text-gray-200 mb-4">Deck Actions</h3>
            {structuredError && (
              <p className="text-sm text-red-400 mb-2">{structuredError}</p>
            )}
            {structuredGames === null && !structuredError && (
              <p className="text-sm text-gray-500">Loading deck actions...</p>
            )}
            {structuredGames && structuredGames.length === 0 && !structuredError && (
              <p className="text-sm text-gray-500">
                Logs not available.
              </p>
            )}
            {structuredGames && structuredGames.length > 0 && (
              <div>
                {/* Game and Turn selector */}
                <div className="flex flex-wrap gap-4 mb-4 items-center">
                  {structuredGames.length > 1 && (
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">Game:</label>
                      <select
                        value={selectedGame}
                        onChange={(e) => {
                          setSelectedGame(Number(e.target.value));
                          setSelectedTurn(1);
                        }}
                        className="bg-gray-700 text-white text-sm rounded px-2 py-1"
                      >
                        {structuredGames.map((_, i) => (
                          <option key={i} value={i}>Game {i + 1}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-400">Turn:</label>
                    <button
                      type="button"
                      onClick={() => setSelectedTurn((t) => Math.max(1, t - 1))}
                      disabled={selectedTurn <= 1}
                      className="px-2 py-1 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Previous turn"
                    >
                      Prev
                    </button>
                    <input
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
                    const label = deckNames?.[i] ?? deck.deckLabel;
                    const isHero = i === 0;
                    
                    // Get life total for this player at the selected turn
                    // Match deck label to player key (e.g. "Doran Big Butts" -> "Ai(1)-Doran Big Butts")
                    const turnLifeTotals = currentGame?.lifePerTurn?.[selectedTurn];
                    const lifeTotal = turnLifeTotals ? (() => {
                      for (const [playerName, life] of Object.entries(turnLifeTotals)) {
                        // Match "Ai(1)-Doran Big Butts" to label "Doran Big Butts"
                        if (playerName === label || playerName.endsWith('-' + label)) {
                          return life;
                        }
                      }
                      return undefined;
                    })() : undefined;
                    
                    // Filter actions based on selected event types
                    const filteredActions = turnActions?.actions.filter((action) => {
                      if (eventFilters.size === 0) return true; // No filter = show all
                      // Check for land_played (line starts with "Land:")
                      if (eventFilters.has('land_played') && action.line.startsWith('Land:')) {
                        return true;
                      }
                      // Check for matching eventType
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
                            <ColorIdentity colorIdentity={colorIdentityByDeckName[label]} />
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
        {(job.status === 'COMPLETED' || job.status === 'FAILED') && (
          <div className="pt-4 border-t border-gray-600">
            <button
              type="button"
              onClick={() => setShowLogPanel((v) => !v)}
              className="text-sm text-gray-500 hover:text-gray-400"
            >
              {showLogPanel ? 'Hide' : 'Show'} detailed game logs
            </button>
            
            {showLogPanel && (
              <div className="mt-4">
                {/* Tab buttons */}
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
                    {condensedError && (
                      <p className="text-sm text-red-400 mb-2">{condensedError}</p>
                    )}
                    {condensedLogs && condensedLogs.length === 0 && !condensedError && (
                      <p className="text-sm text-gray-500">
                        Condensed logs not available.
                      </p>
                    )}
                    {condensedLogs && condensedLogs.length > 0 && (
                      <div className="space-y-4">
                        <p className="text-xs text-gray-400">
                          This is the condensed data sent to the AI for bracket analysis.
                        </p>
                        {condensedLogs.map((game, i) => (
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
                    {rawLogsError && (
                      <p className="text-sm text-red-400 mb-2">{rawLogsError}</p>
                    )}
                    {rawLogs != null && rawLogs.length === 0 && !rawLogsError && (
                      <p className="text-sm text-gray-500">
                        Logs not available (job may still be running or logs were cleaned up).
                      </p>
                    )}
                    {rawLogs != null && rawLogs.length > 0 && (
                      <div className="space-y-4">
                        {rawLogs.map((log, i) => (
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

      <div className="mt-6">
        <Link to="/" className="text-blue-400 hover:underline">
          Submit another deck
        </Link>
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
