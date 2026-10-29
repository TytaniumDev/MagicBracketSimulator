/**
 * One-time move of deck stats from the old top-level collections to the
 * per-deck docs in deck-stats-refs.ts (GCP mode):
 *
 *   ratings/{deckId}     -> decks/{deckId}/stats/rating
 *   matchResults/*       -> pairGames on those rating docs, and
 *                           appliedStats.ratings on each rated job
 *   cardStats/{deckId}   -> decks/{deckId}/stats/cards
 *
 * The stat stores await ensureLegacyDeckStatsMigrated() before every read
 * and write, so the first touch after deploy runs it and nothing reads a
 * half-moved state. Re-running is safe: each deck is marked as it moves,
 * and `config/legacyDeckStatsMigration` records completion. The old
 * collections are left in place; deleting them, and this module, is a
 * later cleanup.
 */
import { FieldValue } from '@google-cloud/firestore';
import { getFirestore } from './firestore-client';
import { USE_FIRESTORE } from './env';
import { deckStatsRef } from './deck-stats-refs';
import { addPodPairGames } from './rating-store';
import { createLogger } from './logger';

const log = createLogger('LegacyDeckStatsMigration');

const PAGE_SIZE = 1000;
const BATCH_SIZE = 400;
/** Decks moved at once; each is its own transaction. */
const PARALLEL_DECKS = 20;
/** gRPC status code Firestore returns when create() finds a doc. */
const ALREADY_EXISTS = 6;

/** Run `fn` over `items`, PARALLEL_DECKS at a time. */
async function inChunks<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += PARALLEL_DECKS) {
    await Promise.all(items.slice(i, i + PARALLEL_DECKS).map(fn));
  }
}

function markerRef() {
  return getFirestore().collection('config').doc('legacyDeckStatsMigration');
}

let migrated: Promise<void> | null = null;

/** Resolve once the legacy stats are moved, migrating on first call. */
export function ensureLegacyDeckStatsMigrated(): Promise<void> {
  if (!USE_FIRESTORE) return Promise.resolve();
  migrated ??= migrateIfNeeded().catch((err) => {
    migrated = null; // let the next call retry
    throw err;
  });
  return migrated;
}

async function migrateIfNeeded(): Promise<void> {
  if ((await markerRef().get()).exists) return;

  const { pairGames, ratedJobIds } = await readMatchResults();
  const ratingDecks = await migrateRatings(pairGames);
  const cardDecks = await migrateCardStats();
  const markedJobs = await markRatedJobs(ratedJobIds);

  await markerRef().set({ migratedAt: FieldValue.serverTimestamp(), ratingDecks, cardDecks, markedJobs });
  log.info('Legacy deck stats migrated', { ratingDecks, cardDecks, markedJobs });
}

/** Per-deck games against each other deck, and the jobs already rated, from matchResults. */
async function readMatchResults(): Promise<{
  pairGames: Map<string, Record<string, number>>;
  ratedJobIds: Set<string>;
}> {
  const pairGames = new Map<string, Record<string, number>>();
  const ratedJobIds = new Set<string>();
  const col = getFirestore().collection('matchResults');
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const query = col.select('deckIds', 'jobId').orderBy('__name__').limit(PAGE_SIZE);
    const snap = await (last ? query.startAfter(last) : query).get();
    for (const doc of snap.docs) {
      addPodPairGames(pairGames, (doc.get('deckIds') as string[] | undefined) ?? []);
      const jobId = doc.get('jobId');
      if (typeof jobId === 'string') ratedJobIds.add(jobId);
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return { pairGames, ratedJobIds };
}

/**
 * Copy each legacy rating and its pair counts under its deck. A deck whose
 * new doc already exists (a job applied before this ran) keeps its values
 * and adds the legacy pair counts, which cover only older jobs.
 */
async function migrateRatings(legacyPairGames: Map<string, Record<string, number>>): Promise<number> {
  const firestore = getFirestore();
  const legacy = await firestore.collection('ratings').get();
  const legacyById = new Map(legacy.docs.map((d) => [d.id, d.data()]));
  const deckIds = new Set([...legacyById.keys(), ...legacyPairGames.keys()]);

  await inChunks([...deckIds], async (deckId) => {
    const ref = deckStatsRef(deckId, 'rating');
    await firestore.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get('migratedLegacy') === true) return;
      const pairGames: Record<string, number> = { ...((current.get('pairGames') as Record<string, number>) ?? {}) };
      for (const [other, games] of Object.entries(legacyPairGames.get(deckId) ?? {})) {
        pairGames[other] = (pairGames[other] ?? 0) + games;
      }
      const base = current.exists ? current.data() : legacyById.get(deckId);
      tx.set(ref, { ...base, kind: 'rating', pairGames, migratedLegacy: true });
    });
  });
  return deckIds.size;
}

/** Copy each legacy card stats doc under its deck unless the deck already has one. */
async function migrateCardStats(): Promise<number> {
  const firestore = getFirestore();
  const legacy = await firestore.collection('cardStats').get();
  let copied = 0;
  await inChunks(legacy.docs, async (doc) => {
    try {
      await deckStatsRef(doc.id, 'cards').create({ ...doc.data(), kind: 'cards' });
      copied++;
    } catch (err) {
      // ALREADY_EXISTS: another instance's migration copied it first.
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
    }
  });
  return copied;
}

/** Record appliedStats.ratings on every job the legacy store already rated. */
async function markRatedJobs(jobIds: Set<string>): Promise<number> {
  const firestore = getFirestore();
  const ids = [...jobIds];
  let marked = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const refs = ids.slice(i, i + BATCH_SIZE).map((id) => firestore.collection('jobs').doc(id));
    const snaps = await firestore.getAll(...refs);
    const batch = firestore.batch();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      batch.update(snap.ref, { 'appliedStats.ratings': true });
      marked++;
    }
    await batch.commit();
  }
  return marked;
}
