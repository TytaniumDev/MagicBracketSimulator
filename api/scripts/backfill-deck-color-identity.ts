#!/usr/bin/env npx tsx
/**
 * One-time backfill: populate color identity for all precons and saved decks
 * that don't have it yet in the unified deck metadata (.cache/deck-metadata.json).
 * Idempotent: skips entries that already have colorIdentity. Safe to re-run
 * after adding new precons or decks.
 *
 * Usage (from api directory):
 *   npx tsx scripts/backfill-deck-color-identity.ts
 */

import { listSavedDecks, readSavedDeckContent, parseCommanderFromContent } from '../lib/saved-decks';
import { getColorIdentityByKey, setColorIdentity } from '../lib/deck-metadata';
import { getColorIdentity } from '../lib/scryfall';

async function main() {
  let decksFilled = 0;

  // Precons now get color identity from Archidekt sync, skip them.
  // Only backfill saved decks.
  const decks = listSavedDecks();
  for (const deck of decks) {
    if (getColorIdentityByKey(deck.filename) != null) {
      continue;
    }
    const content = readSavedDeckContent(deck.filename);
    if (!content) {
      continue;
    }
    const commander = parseCommanderFromContent(content.dck);
    if (!commander) {
      continue;
    }
    const colorIdentity = await getColorIdentity(commander);
    if (colorIdentity.length > 0) {
      setColorIdentity(deck.filename, colorIdentity);
      decksFilled++;
      console.log(`Deck "${deck.name}" -> ${colorIdentity.join('')}`);
    }
  }

  console.log(`Done. Saved decks: ${decksFilled} filled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
