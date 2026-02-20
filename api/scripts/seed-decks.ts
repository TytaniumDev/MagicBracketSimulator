/**
 * Seed precons into the deck store by syncing from Archidekt.
 * Run: npx tsx scripts/seed-decks.ts
 *
 * Works in both LOCAL (SQLite) and GCP (Firestore) modes.
 */
import { syncPrecons } from '../lib/archidekt-sync';

async function main() {
  console.log('Syncing precons from Archidekt...');
  const result = await syncPrecons();
  console.log(`Done: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged`);
  if (result.errors.length > 0) {
    console.error(`Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
