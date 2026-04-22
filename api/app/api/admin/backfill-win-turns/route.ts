import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { getRatingStore } from '@/lib/rating-store-factory';
import { aggregateMatchResultsByWinner } from '@/lib/match-results-scan';
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
 * Behaviour:
 *   - Decks with no matching match_results are left untouched.
 *   - Decks with no existing rating doc are skipped (nothing to attach to).
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    console.error('[BackfillWinTurns] Admin verification failed:', err);
    return unauthorizedResponse('Admin access required');
  }

  try {
    const allResults = await loadAllMatchResults();
    const aggByDeck = aggregateMatchResultsByWinner(allResults);

    const store = getRatingStore();
    const missingRatings: string[] = [];
    const updates: DeckRating[] = [];

    for (const [deckId, agg] of aggByDeck.entries()) {
      const current = await store.getRating(deckId);
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
      totalMatchResults: allResults.length,
    });
  } catch (err) {
    console.error('[BackfillWinTurns] Fatal error:', err);
    Sentry.captureException(err, { tags: { component: 'backfill-win-turns' } });
    return errorResponse(err instanceof Error ? err.message : 'Backfill failed', 500);
  }
}

async function loadAllMatchResults(): Promise<MatchResult[]> {
  const isGcp = !!process.env.GOOGLE_CLOUD_PROJECT;
  if (isGcp) {
    const { getFirestore } = await import('@/lib/firestore-client');
    const { Timestamp } = await import('@google-cloud/firestore');
    const snap = await getFirestore().collection('matchResults').get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      const playedAt =
        d.playedAt instanceof Timestamp
          ? d.playedAt.toDate().toISOString()
          : String(d.playedAt ?? '');
      return {
        id: doc.id,
        jobId: d.jobId as string,
        gameIndex: d.gameIndex as number,
        deckIds: (d.deckIds as string[]) ?? [],
        winnerDeckId: (d.winnerDeckId as string | null) ?? null,
        turnCount: typeof d.turnCount === 'number' ? d.turnCount : null,
        playedAt,
      };
    });
  }

  // LOCAL / SQLite
  const { getDb } = await import('@/lib/db');
  const rows = getDb()
    .prepare(
      'SELECT id, job_id, game_index, deck_ids, winner_deck_id, turn_count, played_at FROM match_results',
    )
    .all() as Array<{
      id: string;
      job_id: string;
      game_index: number;
      deck_ids: string;
      winner_deck_id: string | null;
      turn_count: number | null;
      played_at: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    gameIndex: row.game_index,
    deckIds: safeJsonArray(row.deck_ids),
    winnerDeckId: row.winner_deck_id,
    turnCount: row.turn_count,
    playedAt: row.played_at,
  }));
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
