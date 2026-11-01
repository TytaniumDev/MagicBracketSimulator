#!/usr/bin/env npx tsx
/**
 * Irreversibly delete every job (with its simulations and logs), pod run,
 * rating, match result, card stat, idempotency key and user-imported deck.
 * Precons, workers, allowed users and config are kept, and so are
 * user-imported decks with --keep-decks. Works one bounded batch at a time,
 * so it can be stopped and re-run to finish.
 *
 * Usage (from api directory). Production, with the service account from
 * Doppler (needs `doppler login`):
 *   npm run wipe-data -- --yes
 * Only runs and their stats, keeping imported decks:
 *   npm run wipe-data -- --yes --keep-decks
 * Local SQLite database instead:
 *   npm run wipe-data -- --yes --local
 */

import { useDopplerCredentials } from './doppler-credentials';

async function main() {
  const keepDecks = process.argv.includes('--keep-decks');
  if (!process.argv.includes('--yes')) {
    const what = keepDecks ? 'every run and its stats' : 'every run and custom deck';
    console.error(`This permanently deletes ${what}. Re-run with --yes to confirm.`);
    process.exit(1);
  }

  if (process.argv.includes('--local')) {
    delete process.env.GOOGLE_CLOUD_PROJECT;
  } else {
    useDopplerCredentials();
    console.log(`Wiping project ${process.env.GOOGLE_CLOUD_PROJECT}`);
  }

  // Imported only now: lib modules pick their storage mode when they load.
  const { wipeNextStep } = await import('../lib/data-wipe');

  const totals: Record<string, number> = {};
  for (;;) {
    const step = await wipeNextStep({ keepDecks });
    if (!step) break;
    totals[step.kind] = (totals[step.kind] ?? 0) + step.deleted;
    console.log(`Deleted ${step.deleted} ${step.kind} (${totals[step.kind]} so far)`);
  }
  console.log('Done.', totals);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
