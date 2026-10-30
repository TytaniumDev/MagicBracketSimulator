/**
 * The seats of a new job: each deck id with the deck's name, link and colors
 * copied in for display, so job views never read the deck docs.
 */
import { getDeckById } from './deck-store-factory';
import type { JobSeat } from './types';

/** Seats for `deckIds` in order, and the ids that don't name a deck. */
export async function resolveJobSeats(deckIds: string[]): Promise<{ seats: JobSeat[]; errors: string[] }> {
  const decks = await Promise.all(deckIds.map((id) => getDeckById(id)));
  const seats: JobSeat[] = [];
  const errors: string[] = [];
  decks.forEach((deck, i) => {
    if (!deck) {
      errors.push(deckIds[i]!);
      return;
    }
    seats.push({
      deckId: deck.id,
      name: deck.name,
      link: deck.link ?? null,
      colorIdentity: deck.colorIdentity ?? [],
    });
  });
  return { seats, errors };
}
