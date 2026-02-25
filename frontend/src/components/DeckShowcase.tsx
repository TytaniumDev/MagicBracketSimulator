import { ColorIdentity } from './ColorIdentity';
import type { JobStatus } from '@shared/types/job';

type JobStatusValue = JobStatus;

interface DeckShowcaseProps {
  deckNames: string[];
  colorIdentityByDeckName: Record<string, string[]>;
  winTally: Record<string, number> | null;
  winTurns: Record<string, number[]> | null;
  gamesPlayed: number;
  totalSimulations: number;
  deckLinks?: Record<string, string | null>;
  jobStatus: JobStatusValue;
}

const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
const ACCENT_COLORS: Record<string, string> = {
  W: '#fcd34d', // amber-300
  U: '#60a5fa', // blue-400
  B: '#9ca3af', // gray-400
  R: '#f87171', // red-400
  G: '#4ade80', // green-400
};

function getAccentColor(colorIdentity?: string[]): string {
  if (!colorIdentity?.length) return '#6b7280'; // gray-500
  const primary = WUBRG_ORDER.find((c) => colorIdentity.includes(c));
  return primary ? ACCENT_COLORS[primary] : '#6b7280';
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

export function DeckShowcase({
  deckNames,
  colorIdentityByDeckName,
  winTally,
  winTurns,
  gamesPlayed,
  totalSimulations,
  deckLinks,
  jobStatus,
}: DeckShowcaseProps) {
  const isLive = jobStatus === 'RUNNING';
  const isTerminal = jobStatus === 'COMPLETED' || jobStatus === 'FAILED' || jobStatus === 'CANCELLED';
  const isPartial = (jobStatus === 'FAILED' || jobStatus === 'CANCELLED') && gamesPlayed < totalSimulations;

  // Sort by wins descending when we have data, otherwise preserve original order
  const sorted = [...deckNames].sort((a, b) => {
    if (!winTally) return 0;
    return (winTally[b] ?? 0) - (winTally[a] ?? 0);
  });

  const maxWins = winTally
    ? Math.max(...Object.values(winTally), 0)
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {sorted.map((name) => {
        const colorIdentity = colorIdentityByDeckName[name];
        const wins = winTally?.[name] ?? 0;
        const turns = winTurns?.[name] ?? [];
        const link = deckLinks?.[name];
        const accentColor = getAccentColor(colorIdentity);
        const isLeader = isTerminal && maxWins > 0 && wins === maxWins;
        const winPct = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(0) : null;
        const avgTurn = turns.length > 0
          ? (turns.reduce((s, t) => s + t, 0) / turns.length).toFixed(1)
          : null;

        return (
          <div
            key={name}
            className={`
              relative rounded-xl p-5
              bg-gray-800/70 border border-gray-600/50
              transition-all duration-200
              ${isLeader ? 'ring-1 ring-blue-500/30 border-blue-500/40' : ''}
            `}
            style={{ borderLeftWidth: '3px', borderLeftColor: accentColor }}
          >
            {/* Color identity + link row */}
            <div className="flex items-center justify-between mb-2">
              <ColorIdentity colorIdentity={colorIdentity} className="gap-1 [&_img]:w-5 [&_img]:h-5" />
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm inline-flex items-center gap-1 transition-colors"
                >
                  <ExternalLinkIcon />
                  Decklist
                </a>
              )}
            </div>

            {/* Deck name */}
            <h3 className="text-xl font-bold text-white mb-3 truncate" title={name}>
              {name}
            </h3>

            {/* Win stats */}
            <div className="flex items-baseline gap-3 flex-wrap">
              {jobStatus === 'QUEUED' ? (
                <span className="text-2xl font-bold text-gray-500">--</span>
              ) : (
                <>
                  <span className="text-2xl font-bold text-blue-400">{wins}</span>
                  <span className="text-sm text-gray-400">
                    {gamesPlayed > 0
                      ? `wins / ${gamesPlayed} games`
                      : 'wins'}
                  </span>
                  {winPct !== null && (
                    <span className="text-sm text-gray-500">({winPct}%)</span>
                  )}
                  {isLive && (
                    <span className="text-xs text-blue-400 font-medium">(live)</span>
                  )}
                  {isPartial && gamesPlayed > 0 && (
                    <span className="text-xs text-amber-400 font-medium">(partial)</span>
                  )}
                </>
              )}
            </div>

            {/* Win turns detail */}
            {turns.length > 0 && (
              <div className="text-xs text-gray-500 mt-2">
                {avgTurn && <span>Avg win turn {avgTurn}</span>}
                {avgTurn && turns.length > 0 && <span className="mx-1.5">·</span>}
                {turns.length <= 5
                  ? `Turns: ${turns.join(', ')}`
                  : `Turns: ${turns.slice(0, 5).join(', ')} (+${turns.length - 5} more)`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
