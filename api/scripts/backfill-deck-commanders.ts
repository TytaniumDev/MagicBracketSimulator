#!/usr/bin/env npx tsx
/**
 * Fill in the commander of user decks imported before deck creation saved
 * it, so the Decks page stops showing "No commander" for them. Also sets it
 * on each deck's rating doc, which the leaderboard reads. Only touches decks
 * with no stored commander, so it is safe to re-run. Local mode needs no
 * backfill: it reads the commander from each saved .dck file.
 *
 * Usage (from api directory). Production, with the service account from
 * Doppler (needs `doppler login`):
 *   npm run backfill-deck-commanders
 * See what would change without writing:
 *   npm run backfill-deck-commanders -- --dry-run
 */

import { useDopplerCredentials } from './doppler-credentials';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  useDopplerCredentials();
  console.log(`Backfilling deck commanders in project ${process.env.GOOGLE_CLOUD_PROJECT}${dryRun ? ' (dry run)' : ''}`);

  // Imported only now: lib modules pick their storage mode when they load.
  const { getFirestore } = await import('../lib/firestore-client');
  const { deckStatsRef } = await import('../lib/deck-stats-refs');
  const { commanderFixes } = await import('../lib/deck-commander-backfill');

  const firestore = getFirestore();
  const snapshot = await firestore.collection('decks').where('isPrecon', '==', false).get();
  const fixes = commanderFixes(
    snapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.get('name') as string,
      dck: doc.get('dck') as string,
      primaryCommander: doc.get('primaryCommander') as string | null | undefined,
    })),
  );

  for (const fix of fixes) console.log(`${fix.name} (${fix.id}) -> ${fix.primaryCommander}`);
  if (dryRun || fixes.length === 0) {
    console.log(`Done. ${fixes.length} of ${snapshot.size} user decks ${dryRun ? 'would be' : 'were'} updated.`);
    return;
  }

  const ratingSnaps = await firestore.getAll(...fixes.map((f) => deckStatsRef(f.id, 'rating')));
  const writer = firestore.bulkWriter();
  fixes.forEach((fix, i) => {
    writer.update(firestore.collection('decks').doc(fix.id), { primaryCommander: fix.primaryCommander });
    if (ratingSnaps[i]?.exists) writer.update(ratingSnaps[i].ref, { primaryCommander: fix.primaryCommander });
  });
  await writer.close();
  console.log(`Done. ${fixes.length} of ${snapshot.size} user decks updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
