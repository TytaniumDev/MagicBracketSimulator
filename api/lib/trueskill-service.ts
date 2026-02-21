/**
 * TrueSkill rating service.
 *
 * Implements the TrueSkill algorithm (Herbrich et al.) for 4-player Commander
 * games with win/loss only (no placement data).
 *
 * For each game with one winner and three tied losers:
 *   - Winner vs each loser is treated as a pairwise TrueSkill win update
 *   - Loser vs loser updates cancel out (symmetric tie) so are skipped
 *   - All pairwise updates use initial ratings (computed simultaneously)
 *
 * TrueSkill defaults (matching Microsoft/ts-trueskill conventions):
 *   mu_0    = 25        (initial mean skill)
 *   sigma_0 = 25/3      (initial uncertainty ≈ 8.333)
 *   beta    = 25/6      (performance noise ≈ 4.167)
 *   tau     = 25/300    (dynamics factor ≈ 0.0833)
 *
 * Conservative display rating = mu - 3*sigma (starts near 0, rises with wins).
 */
import type { DeckRating, MatchResult, StructuredGame } from './types';
import { matchesDeckName } from './condenser/deck-match';
import { getDeckById } from './deck-store-factory';
import { getRatingStore } from './rating-store-factory';

// ─── TrueSkill constants ──────────────────────────────────────────────────────

const MU_0 = 25;
const SIGMA_0 = 25 / 3;
const BETA = 25 / 6;
const TAU = 25 / 300;

// ─── Gaussian utilities ───────────────────────────────────────────────────────

/** Approximation of the error function (Abramowitz & Stegun 7.1.26, max error ≤ 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-a * a));
}

/** Standard normal PDF */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF */
function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/**
 * TrueSkill win-condition mean factor v(t).
 * v(t) = φ(t) / Φ(t), clamped to prevent division by near-zero.
 */
function vWin(t: number): number {
  const denom = normCdf(t);
  if (denom < 1e-10) return -t; // prevent divide-by-zero
  return normPdf(t) / denom;
}

/**
 * TrueSkill win-condition variance factor w(t).
 * w(t) = v(t) * (v(t) + t), clamped to [0, 1).
 */
function wWin(t: number): number {
  const v = vWin(t);
  const w = v * (v + t);
  return Math.min(Math.max(w, 0), 1 - 1e-10);
}

// ─── Rating update ────────────────────────────────────────────────────────────

interface RatingSnapshot {
  mu: number;
  sigma: number;
}

/**
 * Compute TrueSkill updates for a 4-player game.
 *
 * @param winnerIdx  Index of the winning deck in `ratings`.
 * @param ratings    Current ratings for all 4 decks.
 * @returns          New mu and sigma values for each deck (same order as input).
 */
function computeTrueSkillUpdate(
  winnerIdx: number,
  ratings: RatingSnapshot[],
): RatingSnapshot[] {
  // Accumulate mu deltas (winner gets +, losers get -)
  const muDeltas: number[] = ratings.map(() => 0);
  // Accumulate w deltas for sigma (always positive reduction)
  const wDeltas: number[] = ratings.map(() => 0);

  const winnerRating = ratings[winnerIdx]!;

  for (let i = 0; i < ratings.length; i++) {
    if (i === winnerIdx) continue; // Skip winner vs winner

    const loser = ratings[i]!;

    const c = Math.sqrt(winnerRating.sigma ** 2 + loser.sigma ** 2 + 2 * BETA ** 2);
    const t = (winnerRating.mu - loser.mu) / c;
    const v = vWin(t);
    const w = wWin(t);

    // Winner gets a positive mu boost from each loser comparison
    muDeltas[winnerIdx] = (muDeltas[winnerIdx] ?? 0) + (winnerRating.sigma ** 2 / c) * v;
    wDeltas[winnerIdx] = (wDeltas[winnerIdx] ?? 0) + (winnerRating.sigma ** 4 / c ** 2) * w;

    // Loser gets a negative mu update from losing to the winner
    muDeltas[i] = (muDeltas[i] ?? 0) - (loser.sigma ** 2 / c) * v;
    wDeltas[i] = (wDeltas[i] ?? 0) + (loser.sigma ** 4 / c ** 2) * w;
  }

  return ratings.map((r, idx) => {
    const newMu = r.mu + (muDeltas[idx] ?? 0);
    // sigma update: subtract skill info gained, then add dynamics tau^2
    const newSigma2 = Math.max(r.sigma ** 2 - (wDeltas[idx] ?? 0) + TAU ** 2, 0.01);
    return { mu: newMu, sigma: Math.sqrt(newSigma2) };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process all games in a completed job and update TrueSkill ratings.
 *
 * This is fire-and-forget — called from aggregateJobResults with a .catch()
 * so failures never break job completion.
 *
 * @param jobId    The job ID (for idempotency).
 * @param deckIds  4 deck IDs (same order used throughout the job).
 * @param games    Structured game data (already ingested by ingestLogs).
 */
export async function processJobForRatings(
  jobId: string,
  deckIds: string[],
  games: StructuredGame[],
): Promise<void> {
  const store = getRatingStore();

  // Idempotency: skip if we've already processed this job
  if (await store.hasMatchResultsForJob(jobId)) {
    console.log(`[TrueSkill] Job ${jobId} already rated, skipping`);
    return;
  }

  // Resolve deck names for winner matching (fallback to null if deck not found)
  const deckInfos = await Promise.all(
    deckIds.map(async (id) => {
      const deck = await getDeckById(id);
      return { id, name: deck?.name ?? null };
    }),
  );

  // Fetch initial ratings for all 4 decks
  const initialStoredRatings = await Promise.all(deckIds.map((id) => store.getRating(id)));

  // Build in-memory state, starting from stored values (or TrueSkill defaults)
  const currentRatings: DeckRating[] = deckIds.map((id, idx) => {
    const stored = initialStoredRatings[idx];
    return (
      stored ?? {
        deckId: id,
        mu: MU_0,
        sigma: SIGMA_0,
        gamesPlayed: 0,
        wins: 0,
        lastUpdated: new Date().toISOString(),
      }
    );
  });

  const matchResults: MatchResult[] = [];
  let updatedAtLeastOne = false;

  for (let i = 0; i < games.length; i++) {
    const game = games[i]!;
    const winner = game.winner;

    // Resolve winner string → deck ID
    let winnerDeckId: string | null = null;
    if (winner) {
      for (const { id, name } of deckInfos) {
        if (name && matchesDeckName(winner, name)) {
          winnerDeckId = id;
          break;
        }
      }
    }

    matchResults.push({
      id: `${jobId}_${i}`,
      jobId,
      gameIndex: i,
      deckIds,
      winnerDeckId,
      turnCount: game.winningTurn ?? null,
      playedAt: new Date().toISOString(),
    });

    if (!winnerDeckId) {
      // No winner resolved — record the match but skip rating update
      continue;
    }

    const winnerIdx = deckIds.indexOf(winnerDeckId);
    if (winnerIdx === -1) continue;

    // Compute TrueSkill update using current in-memory ratings
    const snapshots: RatingSnapshot[] = currentRatings.map((r) => ({
      mu: r.mu,
      sigma: r.sigma,
    }));
    const updated = computeTrueSkillUpdate(winnerIdx, snapshots);

    // Apply updates to in-memory state
    for (let j = 0; j < deckIds.length; j++) {
      const updatedRating = updated[j]!;
      const current = currentRatings[j]!;
      currentRatings[j] = {
        ...current,
        mu: updatedRating.mu,
        sigma: updatedRating.sigma,
        gamesPlayed: current.gamesPlayed + 1,
        wins: current.wins + (j === winnerIdx ? 1 : 0),
        lastUpdated: new Date().toISOString(),
      };
    }
    updatedAtLeastOne = true;
  }

  // Save match results first (idempotency guard)
  for (const result of matchResults) {
    await store.recordMatchResult(result);
  }

  // Save updated ratings only if at least one game was resolved
  if (updatedAtLeastOne) {
    await store.updateRatings(currentRatings);
    console.log(
      `[TrueSkill] Job ${jobId}: rated ${games.length} game(s) for decks [${deckIds.join(', ')}]`,
    );
  }
}
