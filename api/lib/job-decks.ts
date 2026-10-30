/**
 * The decklists a worker needs to run a job.
 *
 * Job docs record each seat's deck id and name, not its .dck content. The
 * content is read from the deck by id and cached briefly, since every sim
 * of a job asks for the same 4 decks.
 */
import { readDeckContent } from './deck-store-factory';
import { lruEvictIfFull, lruTouch } from './lru';
import type { DeckSlot, Job } from './types';

const REQUIRED_DECK_COUNT = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

const contentCache = new Map<string, { dck: string; at: number }>();

async function deckContent(deckId: string): Promise<string | null> {
  const cached = lruTouch(contentCache, deckId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.dck;
  const content = await readDeckContent(deckId);
  if (!content) return null;
  lruEvictIfFull(contentCache, CACHE_MAX);
  contentCache.set(deckId, { dck: content.dck, at: Date.now() });
  return content.dck;
}

/**
 * The job's 4 decks with their .dck content, keeping the names recorded on
 * the job (winner matching uses them). Null when a deck can't be found.
 */
export async function resolveJobDecks(job: Pick<Job, 'seats'>): Promise<DeckSlot[] | null> {
  if (job.seats.length !== REQUIRED_DECK_COUNT) return null;
  const contents = await Promise.all(job.seats.map((s) => deckContent(s.deckId)));
  if (contents.some((dck) => dck === null)) return null;
  return job.seats.map((s, i) => ({ name: s.name, dck: contents[i]! }));
}
