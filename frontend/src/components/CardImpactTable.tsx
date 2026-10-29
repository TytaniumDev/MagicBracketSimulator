import { memo, useMemo, useState } from 'react';
import type { CardImpact } from '@shared/types/card-impact';
import { cardKey, type ScryfallCard } from '../scryfall';
import { formatLift, isPermanent, MIN_CASTS_TO_RANK, topSwingCards } from '../utils/card-impact';
import { useCardPreview } from './CardPreview';
import { CardName } from './CardName';

interface CardImpactTableProps {
  games: number;
  cards: CardImpact[];
  /** Scryfall data keyed by `cardKey`; undefined while loading. */
  lookup: Record<string, ScryfallCard> | undefined;
}

function liftClass(lift: number): string {
  if (lift >= 0.1) return 'text-red-300';
  if (lift <= -0.1) return 'text-blue-300';
  return 'text-gray-300';
}

/** Horizontal bar for close lift, centered on zero, ±50 pts at full width. */
function LiftBar({ lift }: { lift: number }) {
  const pct = Math.min(Math.abs(lift) * 2, 1) * 50;
  return (
    <div className="relative h-1.5 w-20 rounded-full bg-gray-700" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px bg-gray-500" />
      <div
        className={`absolute inset-y-0 rounded-full ${lift >= 0 ? 'bg-red-400' : 'bg-blue-400'}`}
        style={lift >= 0 ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The deck's most game-swinging cards: the ones after which games end
 * quickly in the deck's favor, compared with the deck's usual pace from the
 * same turn. "Show all cards" lists every card the deck has cast.
 */
export const CardImpactTable = memo(function CardImpactTable({ games, cards, lookup }: CardImpactTableProps) {
  const [showAll, setShowAll] = useState(false);
  const { previewHandlers, previewElement } = useCardPreview();

  const top = useMemo(() => {
    const isLand = (name: string) =>
      (lookup?.[cardKey(name)]?.typeLine.split(' // ')[0] ?? '').includes('Land');
    return topSwingCards(cards, isLand);
  }, [cards, lookup]);
  const rows = showAll ? [...cards].sort((a, b) => b.closeLift - a.closeLift) : top;

  if (games === 0) {
    return (
      <p className="text-sm text-gray-400">
        No card stats yet. They fill in as this deck finishes simulations.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 border-b border-gray-700 text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Card</th>
              <th className="px-3 py-2 text-left" title="How much more often the deck wins within 3 of its turns after casting this, vs. its usual rate from the same turn">
                Ends games
              </th>
              <th className="px-3 py-2 text-right" title="How much more often the deck wins after casting this, vs. its usual rate from the same turn">
                Win lift
              </th>
              <th className="px-3 py-2 text-right" title="Share of games where the deck cast it">Cast in</th>
              <th className="px-3 py-2 text-right" title="Average of the deck's own turn when first cast">Turn</th>
              <th className="px-3 py-2 text-right" title="Damage to players per game it was cast">Dmg</th>
              <th className="px-3 py-2 text-right" title="Share of games where it left the battlefield (died, sacrificed or exiled). Permanents only.">
                Answered
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {rows.map((card) => {
              const info = lookup?.[cardKey(card.name)];
              const permanent = info ? isPermanent(info.typeLine) : true;
              return (
                <tr key={card.name} className="bg-gray-800/50 hover:bg-gray-700/50">
                  <td className="px-3 py-1.5">
                    <CardName
                      name={card.name}
                      info={info}
                      previewHandlers={previewHandlers}
                      className="text-left text-gray-100 hover:text-white focus:outline-none focus:underline"
                    />
                    {card.cast < MIN_CASTS_TO_RANK && (
                      <span className="ml-1.5 text-xs text-gray-500">few games</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <LiftBar lift={card.closeLift} />
                      <span className={`tabular-nums ${liftClass(card.closeLift)}`}>{formatLift(card.closeLift)}</span>
                    </div>
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${liftClass(card.winLift)}`}>
                    {formatLift(card.winLift)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                    {Math.round(card.castRate * 100)}%
                    <span className="text-gray-500"> ({card.cast})</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">{card.avgCastTurn.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                    {card.avgDamageToPlayers > 0 ? card.avgDamageToPlayers.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-300">
                    {permanent ? `${Math.round(card.leftBattlefieldRate * 100)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs text-gray-500">
        <span>
          From {games} games. Cards need {MIN_CASTS_TO_RANK}+ casts to rank. Red means games end faster
          than usual once it lands.
        </span>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="shrink-0 text-blue-400 hover:text-blue-300"
        >
          {showAll ? 'Show top 10' : `Show all ${cards.length} cards`}
        </button>
      </div>
      {previewElement}
    </div>
  );
});
