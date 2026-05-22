import { getRatingStore } from './rating-store-factory';
import { getDeckById } from './deck-store-factory';
import { updateRating, MatchOutcome, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL } from './glicko2';
import { applyDecay } from './glicko2-decay';
import { DeckRating, MatchResult } from './types';
import { addWinTurn, emptyWinTurnAggregate } from './win-turn-aggregate';

export async function rebuildRatingsFromHistory() {
  const store = getRatingStore();
  if (!store.getAllMatchResults || !store.clearAllRatings) {
    throw new Error('Store does not support rebuild');
  }

  console.log('[Rebuild] Fetching all match results...');
  const matches = await store.getAllMatchResults();
  console.log(`[Rebuild] Found ${matches.length} matches`);

  // Group by job/period
  const matchesByJob = new Map<string, MatchResult[]>();
  for (const m of matches) {
    let arr = matchesByJob.get(m.jobId);
    if (!arr) {
      arr = [];
      matchesByJob.set(m.jobId, arr);
    }
    arr.push(m);
  }

  await store.clearAllRatings();
  console.log('[Rebuild] Cleared ratings');

  const ratingsMap = new Map<string, DeckRating>();

  async function getRatingForDeck(deckId: string): Promise<DeckRating> {
    if (ratingsMap.has(deckId)) return ratingsMap.get(deckId)!;
    
    const deck = await getDeckById(deckId);
    const dr: DeckRating = {
      deckId,
      mu: 25,
      sigma: 25/3,
      gamesPlayed: 0,
      wins: 0,
      lastUpdated: new Date(0).toISOString(),
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
      volatility: DEFAULT_VOL,
      deckName: deck?.name,
      setName: deck?.setName,
      isPrecon: deck?.isPrecon,
      primaryCommander: deck?.primaryCommander
    };
    ratingsMap.set(deckId, dr);
    return dr;
  }

  // Iterate jobs chronologically
  for (const [_jobId, jobMatches] of matchesByJob.entries()) {
    if (jobMatches.length === 0) continue;
    
    // Sort matches in job by playedAt if needed, though they usually have same playedAt
    const jobTimestamp = jobMatches[0].playedAt;
    
    // Decks involved in this job
    const deckIds = jobMatches[0].deckIds;
    if (!deckIds || deckIds.length !== 4) continue;

    const currentDecks = await Promise.all(deckIds.map(id => getRatingForDeck(id)));

    // Apply decay to pre-ratings
    const preRatings = currentDecks.map(deck => {
      const rd = deck.lastUpdated !== new Date(0).toISOString() 
        ? applyDecay(deck.rd ?? DEFAULT_RD, deck.volatility ?? DEFAULT_VOL, deck.lastUpdated, jobTimestamp)
        : (deck.rd ?? DEFAULT_RD);
      return {
        rating: deck.rating ?? DEFAULT_RATING,
        rd,
        vol: deck.volatility ?? DEFAULT_VOL
      };
    });

    const glickoMatches: MatchOutcome[][] = deckIds.map(() => []);
    
    for (const m of jobMatches) {
      if (!m.winnerDeckId) continue;
      const winnerIdx = deckIds.indexOf(m.winnerDeckId);
      if (winnerIdx === -1) continue;

      for (let p1 = 0; p1 < deckIds.length; p1++) {
        for (let p2 = 0; p2 < deckIds.length; p2++) {
          if (p1 === p2) continue;
          let score: number;
          if (p1 === winnerIdx) score = 1;
          else if (p2 === winnerIdx) score = 0;
          else score = 0.5;

          glickoMatches[p1].push({
            opponentRating: preRatings[p2].rating,
            opponentRd: preRatings[p2].rd,
            score
          });
        }
      }

      // Update basic stats
      
      for (let j = 0; j < deckIds.length; j++) {
        const current = currentDecks[j];
        current.gamesPlayed++;
        if (j === winnerIdx) {
          current.wins++;
          if (m.turnCount != null) {
            const nextAgg = addWinTurn({
              winTurnSum: current.winTurnSum ?? 0,
              winTurnWins: current.winTurnWins ?? 0,
              winTurnHistogram: current.winTurnHistogram ?? emptyWinTurnAggregate().winTurnHistogram
            }, m.turnCount);
            current.winTurnSum = nextAgg.winTurnSum;
            current.winTurnWins = nextAgg.winTurnWins;
            current.winTurnHistogram = nextAgg.winTurnHistogram;
          }
        }
      }
    }

    // Apply Glicko-2 updates
    for (let j = 0; j < deckIds.length; j++) {
      const updated = updateRating(preRatings[j], glickoMatches[j]);
      currentDecks[j].rating = updated.rating;
      currentDecks[j].rd = updated.rd;
      currentDecks[j].volatility = updated.vol;
      currentDecks[j].lastUpdated = jobTimestamp;
    }
  }

  const allRatings = Array.from(ratingsMap.values());
  // Write in chunks to avoid firestore limits
  const chunkSize = 100;
  for (let i = 0; i < allRatings.length; i += chunkSize) {
    const chunk = allRatings.slice(i, i + chunkSize);
    await store.updateRatings(chunk);
  }
  console.log(`[Rebuild] Finished. Wrote ${allRatings.length} ratings.`);
}
