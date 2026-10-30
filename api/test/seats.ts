/** Job seats for tests: each deck named as given, with its name as its id. */
import type { JobSeat } from '../lib/types';

export function testSeats(names: string[]): JobSeat[] {
  return names.map((name) => ({ deckId: name, name, link: null, colorIdentity: [] }));
}
