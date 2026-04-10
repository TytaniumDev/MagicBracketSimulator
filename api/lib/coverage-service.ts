/**
 * Coverage service: computes pair coverage from match_results and generates
 * optimal 4-player pods using a greedy algorithm.
 */
import { Firestore } from '@google-cloud/firestore';
import { listAllDecks } from './deck-store-factory';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let _firestore: Firestore | null = null;
function getFirestoreClient(): Firestore {
  if (!_firestore) {
    _firestore = new Firestore({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
    });
  }
  return _firestore;
}

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

  const [allDecks, matchResults] = await Promise.all([
    listAllDecks(),
    getAllMatchResults(),
  ]);

  const allDeckIds = allDecks.map((d) => d.id);
  const counts = new Map<string, number>();

  for (const result of matchResults) {
    const pairs = extractPairs(result.deckIds);
    for (const pair of pairs) {
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
  }

  const data = { counts, allDeckIds };
  coverageCache = { data, ts: Date.now() };
  return data;
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
  const { counts, allDeckIds } = await computePairCoverage();

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

  // Step 1: Pick the pair (A, B) with the fewest games played
  let minCount = Infinity;
  let bestA = '';
  let bestB = '';
  for (const [key, count] of underCovered) {
    if (count < minCount) {
      minCount = count;
      const [a, b] = key.split('|');
      bestA = a;
      bestB = b;
    }
  }

  const pod = [bestA, bestB];
  const podSet = new Set(pod);

  // Step 2: Pick deck C that maximizes new under-covered pairs
  let bestC = '';
  let bestCScore = -1;
  for (const deckId of allDeckIds) {
    if (podSet.has(deckId)) continue;
    let score = 0;
    for (const existing of pod) {
      const key = pairKey(deckId, existing);
      if (underCovered.has(key)) score++;
    }
    if (score > bestCScore) {
      bestCScore = score;
      bestC = deckId;
    }
  }
  pod.push(bestC);
  podSet.add(bestC);

  // Step 3: Pick deck D that maximizes new under-covered pairs
  let bestD = '';
  let bestDScore = -1;
  for (const deckId of allDeckIds) {
    if (podSet.has(deckId)) continue;
    let score = 0;
    for (const existing of pod) {
      const key = pairKey(deckId, existing);
      if (underCovered.has(key)) score++;
    }
    if (score > bestDScore) {
      bestDScore = score;
      bestD = deckId;
    }
  }
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
 * Get all match results (deck_ids arrays) from the database.
 */
async function getAllMatchResults(): Promise<{ deckIds: string[] }[]> {
  if (USE_FIRESTORE) {
    const snapshot = await getFirestoreClient().collection('matchResults').select('deckIds').get();
    return snapshot.docs.map((doc) => ({
      deckIds: doc.data().deckIds as string[],
    }));
  }

  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const rows = db
    .prepare('SELECT deck_ids FROM match_results')
    .all() as { deck_ids: string }[];
  return rows.map((r) => ({
    deckIds: JSON.parse(r.deck_ids) as string[],
  }));
}
