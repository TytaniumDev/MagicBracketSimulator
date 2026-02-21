import { useState, useEffect, useCallback } from 'react';
import { getApiBase, fetchPublic } from '../api';

interface LeaderboardEntry {
  deckId: string;
  name: string;
  setName: string | null;
  isPrecon: boolean;
  primaryCommander: string | null;
  mu: number;
  sigma: number;
  rating: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

type SortKey = 'rating' | 'mu' | 'winRate' | 'gamesPlayed';

function ConfidenceBadge({ sigma }: { sigma: number }) {
  if (sigma < 4) {
    return (
      <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-green-900/60 text-green-300 border border-green-700">
        stable
      </span>
    );
  }
  if (sigma > 7) {
    return (
      <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-yellow-900/60 text-yellow-300 border border-yellow-700">
        unsettled
      </span>
    );
  }
  return null;
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={`px-3 py-2 text-right cursor-pointer select-none whitespace-nowrap ${
        active ? 'text-blue-400' : 'text-gray-400 hover:text-gray-200'
      }`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="ml-1">↓</span>}
    </th>
  );
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minGames, setMinGames] = useState(5);
  const [preconOnly, setPreconOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rating');

  const apiBase = getApiBase();

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchPublic(`${apiBase}/api/leaderboard?minGames=${minGames}&limit=500`);
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      const data = await res.json();
      setEntries(data.decks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setIsLoading(false);
    }
  }, [apiBase, minGames]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const filtered = entries
    .filter((e) => !preconOnly || e.isPrecon)
    .sort((a, b) => {
      if (sortKey === 'rating') return b.rating - a.rating;
      if (sortKey === 'mu') return b.mu - a.mu;
      if (sortKey === 'winRate') return b.winRate - a.winRate;
      if (sortKey === 'gamesPlayed') return b.gamesPlayed - a.gamesPlayed;
      return 0;
    });

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-2">Power Rankings</h1>
      <p className="text-gray-400 text-center mb-6">
        TrueSkill ratings from Commander simulation results.{' '}
        <span className="text-gray-500 text-sm">
          Rating = μ − 3σ (conservative estimate, higher is stronger)
        </span>
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4 bg-gray-800 rounded-lg px-4 py-3 border border-gray-700">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={preconOnly}
            onChange={(e) => setPreconOnly(e.target.checked)}
            className="accent-blue-500"
          />
          Precons only
        </label>

        <div className="flex items-center gap-2 text-sm text-gray-300">
          <span>Min games:</span>
          {[0, 5, 10, 20, 50].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMinGames(n)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                minGames === n
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {n === 0 ? 'All' : `${n}+`}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-gray-500">
          {filtered.length} deck{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
          Loading rankings...
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
          No decks with {minGames > 0 ? `${minGames}+ ` : ''}games yet.
          Ratings populate automatically as simulations complete.
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-gray-400 w-10">#</th>
                <th className="px-3 py-2 text-left text-gray-400">Deck</th>
                <SortHeader label="Rating" sortKey="rating" currentSort={sortKey} onSort={setSortKey} />
                <SortHeader label="μ" sortKey="mu" currentSort={sortKey} onSort={setSortKey} />
                <th className="px-3 py-2 text-right text-gray-400">σ</th>
                <SortHeader label="Win Rate" sortKey="winRate" currentSort={sortKey} onSort={setSortKey} />
                <SortHeader label="Games" sortKey="gamesPlayed" currentSort={sortKey} onSort={setSortKey} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {filtered.map((entry, idx) => (
                <tr
                  key={entry.deckId}
                  className="bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                >
                  <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-white">{entry.name}</span>
                          {!entry.isPrecon && (
                            <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-900/60 text-purple-300 border border-purple-700">
                              custom
                            </span>
                          )}
                          <ConfidenceBadge sigma={entry.sigma} />
                        </div>
                        {entry.setName && (
                          <div className="text-xs text-gray-500 truncate">{entry.setName}</div>
                        )}
                        {!entry.isPrecon && entry.primaryCommander && (
                          <div className="text-xs text-gray-500 truncate">
                            {entry.primaryCommander}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">
                    {entry.rating.toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-300">
                    {entry.mu.toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-400">
                    {entry.sigma.toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-300">
                    {(entry.winRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{entry.gamesPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-600 text-center">
        TrueSkill ratings update automatically after each completed simulation job.
        More games played → lower σ → more reliable Rating.
      </p>
    </div>
  );
}
