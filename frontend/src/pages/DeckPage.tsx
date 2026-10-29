import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DeckStats } from '@shared/types/deck';
import { CardImpactTable } from '../components/CardImpactTable';
import { ColorIdentity } from '../components/ColorIdentity';
import { DeckList } from '../components/DeckList';
import { Spinner } from '../components/Spinner';
import { WinTurnTooltip } from '../components/WinTurnTooltip';
import { useDeck, useDeckCardImpact, useScryfallCards } from '../hooks/useDeck';
import { onlyDeckCards } from '../utils/card-impact';

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</div>
      {detail && <div className="text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

function DeckStatsPanel({ stats }: { stats: DeckStats | null }) {
  if (!stats) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 text-sm text-gray-400">
        No games recorded yet. Stats appear once this deck has played in a finished simulation.
      </div>
    );
  }

  const totalHistogramWins = stats.winTurnHistogram?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3 flex-1">
        <StatTile label="Rating" value={`${stats.rating.toFixed(1)}%`} detail="Win rate adjusted for sample size" />
        <StatTile label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} detail={`${stats.wins} of ${stats.gamesPlayed} games`} />
        <StatTile label="Games" value={String(stats.gamesPlayed)} />
        <StatTile
          label="Avg win turn"
          value={stats.avgWinTurn != null ? stats.avgWinTurn.toFixed(1) : '—'}
        />
      </div>
      {stats.winTurnHistogram && stats.avgWinTurn != null && totalHistogramWins > 0 && (
        <WinTurnTooltip
          histogram={stats.winTurnHistogram}
          avgWinTurn={stats.avgWinTurn}
          totalWins={totalHistogramWins}
        />
      )}
    </div>
  );
}

/**
 * Deck page: metadata, results across every recorded game, and the decklist
 * with hover card previews.
 */
export default function DeckPage() {
  const { id } = useParams<{ id: string }>();
  const deckQuery = useDeck(id);
  const cardImpact = useDeckCardImpact(id);
  const data = deckQuery.data;

  const cardNames = useMemo(
    () => (data ? [...data.commanders, ...data.cards].map((c) => c.name) : []),
    [data],
  );
  const scryfall = useScryfallCards(cardNames);
  const impactCards = useMemo(
    () => {
      if (!cardImpact.data) return [];
      // Without a decklist there's nothing to filter against, so show every card.
      if (!data?.decklistAvailable) return cardImpact.data.cards;
      return onlyDeckCards(cardImpact.data.cards, cardNames, scryfall.data);
    },
    [cardImpact.data, data?.decklistAvailable, cardNames, scryfall.data],
  );

  if (deckQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
        <Spinner /> Loading deck...
      </div>
    );
  }

  if (deckQuery.isError || !data) {
    return (
      <div className="max-w-2xl mx-auto text-center text-gray-400">
        <p className="mb-4">{deckQuery.error?.message ?? 'Deck not found'}.</p>
        <Link to="/leaderboard" className="text-blue-400 hover:underline">
          Back to the leaderboard
        </Link>
      </div>
    );
  }

  const { deck, decklistAvailable, commanders, cards, stats } = data;
  const cardCount = [...commanders, ...cards].reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-white">{deck.name}</h1>
          <ColorIdentity colorIdentity={deck.colorIdentity} />
          {deck.isPrecon ? (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300 border border-gray-600">
              precon
            </span>
          ) : (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-900/60 text-purple-300 border border-purple-700">
              custom
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-gray-400">
          {deck.primaryCommander && <span>{deck.primaryCommander}</span>}
          {deck.setName && <span>{deck.setName}</span>}
          {deck.link && (
            <a href={deck.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              View original list
            </a>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Results</h2>
        <DeckStatsPanel stats={stats} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Most game-swinging cards</h2>
        <p className="mb-3 text-sm text-gray-400">
          Cards after which games end quickly in this deck's favor, compared with how the deck
          usually does from the same turn. Good candidates to swap out to lower its power.
        </p>
        {cardImpact.isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner /> Loading card stats...</div>
        )}
        {cardImpact.isError && <p className="text-sm text-gray-400">Card stats are unavailable right now.</p>}
        {cardImpact.data && (
          <CardImpactTable games={cardImpact.data.games} cards={impactCards} lookup={scryfall.data} />
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Decklist</h2>
          {decklistAvailable && (
            <span className="text-xs text-gray-500">
              {cardCount} cards
              {scryfall.isError && ' · card details unavailable'}
            </span>
          )}
        </div>
        {decklistAvailable ? (
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-3">
            <DeckList commanders={commanders} cards={cards} lookup={scryfall.data} />
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            This deck is no longer in the deck library, so its list isn't available. Its results above are kept.
          </p>
        )}
      </section>
    </div>
  );
}
