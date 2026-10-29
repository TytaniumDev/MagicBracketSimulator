import { REQUIRED_DECK_COUNT } from '@shared/types/job';
import type { DeckStanding } from '@shared/types/pod-run';

/** Win rate an evenly matched deck would have in a pod. */
const EVEN_WIN_RATE = 1 / REQUIRED_DECK_COUNT;

/** A pod run's standings, best deck first. */
export function PodStandingsTable({ standings }: { standings: readonly DeckStanding[] }) {
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 border-b border-gray-700">
            <tr>
              <th className="px-3 py-2 text-left text-gray-400 w-10">#</th>
              <th className="px-3 py-2 text-left text-gray-400">Deck</th>
              <th className="px-3 py-2 text-right text-gray-400">Win Rate</th>
              <th className="px-3 py-2 text-right text-gray-400">Wins</th>
              <th className="px-3 py-2 text-right text-gray-400">Games</th>
              <th className="px-3 py-2 text-right text-gray-400">Pods</th>
              <th className="px-3 py-2 text-right text-gray-400">Avg Win Turn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {standings.map((s, idx) => (
              <tr key={s.key} className="bg-gray-800/50">
                <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{idx + 1}</td>
                <td className="px-3 py-2.5 font-medium text-white">{s.name}</td>
                <td
                  className={`px-3 py-2.5 text-right font-mono font-semibold ${
                    s.winRate >= EVEN_WIN_RATE ? 'text-green-400' : 'text-gray-300'
                  }`}
                >
                  {(s.winRate * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-right text-gray-300">{s.wins}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{s.gamesPlayed}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{s.pods}</td>
                <td className="px-3 py-2.5 text-right text-gray-300 font-mono">
                  {s.avgWinTurn != null ? s.avgWinTurn.toFixed(1) : <span className="text-gray-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        An evenly matched deck wins about {(EVEN_WIN_RATE * 100).toFixed(0)}% of its games.
      </p>
    </>
  );
}
