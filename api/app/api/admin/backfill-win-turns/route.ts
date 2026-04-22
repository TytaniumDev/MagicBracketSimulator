import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { getRatingStore } from '@/lib/rating-store-factory';
import { addWinTurn, emptyWinTurnAggregate, type WinTurnAggregate } from '@/lib/win-turn-aggregate';
import type { MatchResult, DeckRating } from '@/lib/types';
import * as Sentry from '@sentry/nextjs';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/backfill-win-turns — Rebuild winTurnSum/winTurnWins/
 * winTurnHistogram for every deck from the match_results store.
 *
 * Admin-only. Idempotent: re-running produces the same values because
 * the aggregate is recomputed from match_results, not incremented.
 *
 * Implementation notes:
 *   - Match results are streamed in bounded-size pages and aggregated
 *     on the fly, so working set stays small as history grows.
 *   - Rating docs are read in a single batched leaderboard fetch instead
 *     of one getRating call per deck, avoiding N+1 reads.
 *   - Decks with no matching match_results are left untouched.
 *   - Decks with no existing rating doc are skipped.
 */

const FIRESTORE_PAGE_SIZE = 1000;
const SQLITE_PAGE_SIZE = 5000;

export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    console.error('[BackfillWinTurns] Admin verification failed:', err);
    return unauthorizedResponse('Admin access required');
  }

  try {
    const aggByDeck = new Map<string, WinTurnAggregate>();
    let totalScanned = 0;

    for await (const batch of iterateMatchResults()) {
      totalScanned += batch.length;
      for (const r of batch) {
        if (!r.winnerDeckId || r.turnCount == null) continue;
        const prev = aggByDeck.get(r.winnerDeckId) ?? emptyWinTurnAggregate();
        aggByDeck.set(r.winnerDeckId, addWinTurn(prev, r.turnCount));
      }
    }

    const store = getRatingStore();

    // Single batched fetch — avoids N+1 getRating calls.
    const existingRatings = await store.getLeaderboard({ limit: 10_000 });
    const ratingByDeckId = new Map(existingRatings.map((r) => [r.deckId, r]));

    const missingRatings: string[] = [];
    const updates: DeckRating[] = [];

    for (const [deckId, agg] of aggByDeck.entries()) {
      const current = ratingByDeckId.get(deckId);
      if (!current) {
        missingRatings.push(deckId);
        continue;
      }
      updates.push({
        ...current,
        winTurnSum: agg.winTurnSum,
        winTurnWins: agg.winTurnWins,
        winTurnHistogram: agg.winTurnHistogram,
      });
    }

    if (updates.length > 0) {
      await store.updateRatings(updates);
    }

    return NextResponse.json({
      updated: updates.length,
      missingRatings: missingRatings.length,
      missingRatingsIds: missingRatings,
      totalMatchResults: totalScanned,
    });
  } catch (err) {
    console.error('[BackfillWinTurns] Fatal error:', err);
    Sentry.captureException(err, { tags: { component: 'backfill-win-turns' } });
    return errorResponse(err instanceof Error ? err.message : 'Backfill failed', 500);
  }
}

/** Yields match_results in bounded-size pages; works for both SQLite and Firestore. */
async function* iterateMatchResults(): AsyncGenerator<MatchResult[]> {
  const isGcp = !!process.env.GOOGLE_CLOUD_PROJECT;
  if (isGcp) {
    yield* iterateFirestoreMatchResults();
  } else {
    yield* iterateSqliteMatchResults();
  }
}

async function* iterateFirestoreMatchResults(): AsyncGenerator<MatchResult[]> {
  const { getFirestore } = await import('@/lib/firestore-client');
  const col = getFirestore().collection('matchResults');

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q = col.orderBy('__name__').limit(FIRESTORE_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) return;
    const batch: MatchResult[] = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        jobId: d.jobId as string,
        gameIndex: d.gameIndex as number,
        deckIds: (d.deckIds as string[]) ?? [],
        winnerDeckId: (d.winnerDeckId as string | null) ?? null,
        turnCount: typeof d.turnCount === 'number' ? d.turnCount : null,
        playedAt: firestoreTimestampToIso(d.playedAt),
      };
    });
    yield batch;
    if (snap.docs.length < FIRESTORE_PAGE_SIZE) return;
    cursor = snap.docs[snap.docs.length - 1]!;
  }
}

/**
 * Convert a Firestore Timestamp-like value to an ISO string.
 * Uses duck-typing rather than `instanceof Timestamp` because dynamic imports
 * of @google-cloud/firestore can yield a module namespace where Timestamp is
 * not the same constructor the SDK internally attaches, making the instanceof
 * check throw "Right-hand side of 'instanceof' is not an object".
 */
function firestoreTimestampToIso(value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as { toDate?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
    if (typeof v.toDate === 'function') {
      const d = (v.toDate as () => Date)();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
    // Serialized POJO form (e.g., after JSON round-trip): { _seconds, _nanoseconds }
    if (typeof v._seconds === 'number') {
      const nanos = typeof v._nanoseconds === 'number' ? v._nanoseconds : 0;
      const d = new Date(v._seconds * 1000 + Math.floor(nanos / 1e6));
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return String(value ?? '');
}

async function* iterateSqliteMatchResults(): AsyncGenerator<MatchResult[]> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();
  let offset = 0;
  while (true) {
    const rows = db
      .prepare(
        'SELECT id, job_id, game_index, deck_ids, winner_deck_id, turn_count, played_at FROM match_results ORDER BY id LIMIT ? OFFSET ?',
      )
      .all(SQLITE_PAGE_SIZE, offset) as Array<{
        id: string;
        job_id: string;
        game_index: number;
        deck_ids: string;
        winner_deck_id: string | null;
        turn_count: number | null;
        played_at: string;
      }>;
    if (rows.length === 0) return;
    const batch: MatchResult[] = rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      gameIndex: row.game_index,
      deckIds: safeJsonArray(row.deck_ids),
      winnerDeckId: row.winner_deck_id,
      turnCount: row.turn_count,
      playedAt: row.played_at,
    }));
    yield batch;
    if (rows.length < SQLITE_PAGE_SIZE) return;
    offset += rows.length;
  }
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
