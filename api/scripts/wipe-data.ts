#!/usr/bin/env npx tsx
/**
 * Irreversibly delete every job (with its simulations and logs), pod run,
 * rating, match result, card stat, idempotency key and user-imported deck.
 * Precons, workers, allowed users and config are kept. Works one bounded
 * batch at a time, so it can be stopped and re-run to finish.
 *
 * Usage (from api directory). GCP mode uses Application Default Credentials:
 *   GOOGLE_CLOUD_PROJECT=magic-bracket-simulator npm run wipe-data -- --yes
 * Without GOOGLE_CLOUD_PROJECT it wipes the local SQLite database instead.
 */

import { wipeNextStep } from '../lib/data-wipe';

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('This permanently deletes every run and custom deck. Re-run with --yes to confirm.');
    process.exit(1);
  }

  const totals: Record<string, number> = {};
  for (;;) {
    const step = await wipeNextStep();
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
