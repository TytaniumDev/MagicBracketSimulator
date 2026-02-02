#!/usr/bin/env npx tsx
/**
 * One-time backfill: populate color identity for all precons and saved decks
 * that don't have it yet in the unified deck metadata (.cache/deck-metadata.json).
 * Idempotent: skips entries that already have colorIdentity. Safe to re-run
 * after adding new precons or decks.
 *
 * Usage (from orchestrator-service directory):
 *   npx tsx scripts/backfill-deck-color-identity.ts
 */

import { loadPrecons } from '../lib/precons';
import { listSavedDecks, readSavedDeckContent, parseCommanderFromContent } from '../lib/saved-decks';
import { getColorIdentityByKey, setColorIdentity } from '../lib/deck-metadata';
import { getColorIdentity } from '../lib/scryfall';

function commanderNameFromPrimary(primaryCommander: string): string {
  const trimmed = primaryCommander.trim();
  const pipeIndex = trimmed.indexOf('|');
  return pipeIndex >= 0 ? trimmed.substring(0, pipeIndex).trim() : trimmed;
}

async function main() {
  let preconsFilled = 0;
  let decksFilled = 0;

  // 1. Precons
  const precons = loadPrecons();
  for (const precon of precons) {
    if (getColorIdentityByKey(precon.id) != null) {
      continue;
    }
    const commander = commanderNameFromPrimary(precon.primaryCommander);
    if (!commander) {
      continue;
    }
    const colorIdentity = await getColorIdentity(commander);
    if (colorIdentity.length > 0) {
      setColorIdentity(precon.id, colorIdentity);
      preconsFilled++;
      console.log(`Precon "${precon.name}" -> ${colorIdentity.join('')}`);
    }
  }

  // 2. Saved decks
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

  console.log(`Done. Precons: ${preconsFilled} filled. Saved decks: ${decksFilled} filled.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
