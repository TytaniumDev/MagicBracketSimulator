/**
 * Coverage service: computes pair coverage from match_results and generates
 * optimal 4-player pods using a greedy algorithm.
 */
import { listAllDecks, type DeckListItem } from './deck-store-factory';
import { getFirestore } from './firestore-client';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

const getFirestoreClient = getFirestore;

/** Canonical key for a pair of deck IDs (alphabetically sorted). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Extract all C(4,2) = 6 pairs from a 4-deck game. */
function extractPairs(deckIds: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < deckIds.length; i++) {
    for (let j = i + 1; j < deckIds.length; j++) {
      pairs.push(pairKey(deckIds[i], deckIds[j]));
    }
  }
  return pairs;
}

export interface CoverageStatus {
  totalPairs: number;
  coveredPairs: number;
  underCoveredPairs: number;
  targetGamesPerPair: number;
  percentComplete: number;
}

export interface PairCoverageMap {
  counts: Map<string, number>;
  allDeckIds: string[];
  allDecks: DeckListItem[];
}

// In-memory cache to avoid re-reading all match_results on every request
let coverageCache: { data: PairCoverageMap; ts: number } | null = null;
const COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compute pair coverage from match_results.
 * Returns a map of pair -> game count and the full list of deck IDs.
 * Results are cached for 5 minutes to reduce database load.
 */
export async function computePairCoverage(): Promise<PairCoverageMap> {
  if (coverageCache && Date.now() - coverageCache.ts < COVERAGE_CACHE_TTL_MS) {
    return coverageCache.data;
  }

  const allDecks = await listAllDecks();
  const allDeckIds = allDecks.map((d) => d.id);
  const counts = new Map<string, number>();

  const incrementPairs = (deckIds: string[]): void => {
    if (!Array.isArray(deckIds)) return;
    for (const pair of extractPairs(deckIds)) {
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
  };

  await forEachMatchResult(incrementPairs);

  const data = { counts, allDeckIds, allDecks };
  coverageCache = { data, ts: Date.now() };
  return data;
}

/**
 * Build a priority score per deck, biased toward recently-added custom decks.
 * Custom decks get a rank-based score (newest = highest); precons get 0.
 * This is used as a tiebreaker when many pairs/decks tie on coverage metrics.
 */
function buildDeckPriority(allDecks: DeckListItem[]): Map<string, number> {
  const customDecks = allDecks
    .filter((d) => !d.isPrecon)
    .map((d) => ({ id: d.id, ts: d.createdAt ? Date.parse(d.createdAt) : 0 }))
    .sort((a, b) => b.ts - a.ts); // newest first

  const priority = new Map<string, number>();
  const n = customDecks.length;
  customDecks.forEach((d, rank) => {
    priority.set(d.id, n - rank); // newest gets n, oldest gets 1
  });
  for (const d of allDecks) {
    if (!priority.has(d.id)) priority.set(d.id, 0);
  }
  return priority;
}

/**
 * Weighted random choice. `weights` must be >= 0 and at least one must be > 0.
 * Falls back to uniform if all weights are 0.
 */
function weightedRandomIndex(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Get coverage status summary.
 */
export async function getCoverageStatus(targetGamesPerPair: number): Promise<CoverageStatus> {
  const { counts, allDeckIds } = await computePairCoverage();
  const n = allDeckIds.length;
  const totalPairs = n >= 2 ? (n * (n - 1)) / 2 : 0;

  let coveredPairs = 0;
  for (let i = 0; i < allDeckIds.length; i++) {
    for (let j = i + 1; j < allDeckIds.length; j++) {
      const key = pairKey(allDeckIds[i], allDeckIds[j]);
      if ((counts.get(key) ?? 0) >= targetGamesPerPair) {
        coveredPairs++;
      }
    }
  }

  return {
    totalPairs,
    coveredPairs,
    underCoveredPairs: totalPairs - coveredPairs,
    targetGamesPerPair,
    percentComplete: totalPairs > 0 ? Math.round((coveredPairs / totalPairs) * 10000) / 100 : 100,
  };
}

/**
 * Generate the next optimal pod of 4 decks using the greedy algorithm.
 * Returns null if all pairs meet the target or fewer than 4 decks exist.
 */
export async function generateNextPod(targetGamesPerPair: number): Promise<string[] | null> {
  const { counts, allDeckIds, allDecks } = await computePairCoverage();

  if (allDeckIds.length < 4) return null;

  // Build set of under-covered pairs with their counts
  const underCovered = new Map<string, number>();
  for (let i = 0; i < allDeckIds.length; i++) {
    for (let j = i + 1; j < allDeckIds.length; j++) {
      const key = pairKey(allDeckIds[i], allDeckIds[j]);
      const count = counts.get(key) ?? 0;
      if (count < targetGamesPerPair) {
        underCovered.set(key, count);
      }
    }
  }

  if (underCovered.size === 0) return null;

  const priority = buildDeckPriority(allDecks);
  // +1 ensures precons (priority 0) still have a non-zero chance.
  const deckWeight = (id: string): number => (priority.get(id) ?? 0) + 1;

  // Step 1: Among pairs with the fewest games played, weight-random by priority
  // so newly-added custom decks are favored but every under-covered pair can still
  // be picked.
  let minCount = Infinity;
  for (const count of underCovered.values()) {
    if (count < minCount) minCount = count;
  }
  const candidatePairs: Array<[string, string]> = [];
  const pairWeights: number[] = [];
  for (const [key, count] of underCovered) {
    if (count !== minCount) continue;
    const [a, b] = key.split('|');
    candidatePairs.push([a, b]);
    pairWeights.push(deckWeight(a) + deckWeight(b));
  }
  const [bestA, bestB] = candidatePairs[weightedRandomIndex(pairWeights)];

  const pod = [bestA, bestB];
  const podSet = new Set(pod);

  // Steps 2 & 3: among decks tied for max new-under-covered-pair score,
  // weight-random by priority.
  const pickNextDeck = (): string => {
    let bestScore = -1;
    const scores = new Map<string, number>();
    for (const deckId of allDeckIds) {
      if (podSet.has(deckId)) continue;
      let score = 0;
      for (const existing of pod) {
        if (underCovered.has(pairKey(deckId, existing))) score++;
      }
      scores.set(deckId, score);
      if (score > bestScore) bestScore = score;
    }
    const candidates: string[] = [];
    const weights: number[] = [];
    for (const [id, score] of scores) {
      if (score !== bestScore) continue;
      candidates.push(id);
      weights.push(deckWeight(id));
    }
    return candidates[weightedRandomIndex(weights)];
  };

  const bestC = pickNextDeck();
  pod.push(bestC);
  podSet.add(bestC);

  const bestD = pickNextDeck();
  pod.push(bestD);

  return pod;
}

/**
 * Check if there is already a QUEUED or RUNNING coverage job.
 * Used to prevent race conditions when multiple workers request coverage work.
 */
export async function hasActiveCoverageJob(): Promise<boolean> {
  if (USE_FIRESTORE) {
    const snapshot = await getFirestoreClient()
      .collection('jobs')
      .where('source', '==', 'coverage')
      .where('status', 'in', ['QUEUED', 'RUNNING'])
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const row = db
    .prepare("SELECT 1 FROM jobs WHERE source = 'coverage' AND status IN ('QUEUED', 'RUNNING') LIMIT 1")
    .get();
  return row !== undefined;
}

/**
 * Page size for Firestore match_results scans. Keeps per-RPC memory bounded
 * so the coverage computation never loads the entire collection at once.
 */
const MATCH_RESULTS_PAGE_SIZE = 1000;

/**
 * Stream every match_results document through `visit`. In GCP mode this
 * uses cursor-based pagination so the in-memory working set is at most
 * MATCH_RESULTS_PAGE_SIZE docs; in LOCAL mode the SQLite row count is
 * small enough that we load all rows eagerly.
 */
async function forEachMatchResult(visit: (deckIds: string[]) => void): Promise<void> {
  if (USE_FIRESTORE) {
    const ref = getFirestoreClient().collection('matchResults');
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    while (true) {
      let query = ref.select('deckIds').orderBy('__name__').limit(MATCH_RESULTS_PAGE_SIZE);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) return;
      for (const doc of snapshot.docs) {
        visit(doc.data().deckIds as string[]);
      }
      if (snapshot.size < MATCH_RESULTS_PAGE_SIZE) return;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }
  }

  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const rows = db
    .prepare('SELECT deck_ids FROM match_results')
    .all() as { deck_ids: string }[];
  for (const row of rows) {
    visit(JSON.parse(row.deck_ids) as string[]);
  }
}
