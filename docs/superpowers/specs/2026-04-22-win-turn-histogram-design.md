# Power Rankings: Average Win Turn + Histogram

**Status:** Approved (brainstorming phase)
**Date:** 2026-04-22

## Summary

Add an "Avg Win Turn" column to the Power Rankings leaderboard and, on hover of an info icon, show a histogram of wins per game turn (bins 1–15 plus "16+"). The column is sortable. Existing `match_results` are backfilled so the feature is meaningful on ship day.

## Motivation

The leaderboard currently summarizes deck strength only as a rating / win rate / games-played triple. Commander players care not just whether a deck wins but *how fast* it wins — a deck that wins on turn 7 plays a very different game than one that wins on turn 14. Exposing average win turn (sortable) gives a quick read across decks, and the histogram gives the shape of the distribution for anyone who wants to dig in.

## Non-goals

- No changes to `DeckShowcase` (per-job view already has its own win-turn display via `useWinData`).
- No additional filters on the leaderboard based on avg win turn.
- No server-side cap on what gets shown in the histogram beyond the existing bin scheme (long tails fold into the 16+ bin).

## Bin scheme

16 bins, fixed:

- Index 0 = turn 1
- Index 1 = turn 2
- …
- Index 14 = turn 15
- Index 15 = turn 16 or later ("16+")

Any recorded `turnCount ≤ 0` clamps up to bin 0 (turn 1). Any `turnCount ≥ 16` falls into bin 15. `null`/missing `turnCount` is skipped entirely (no bin, does not count in `winTurnSum`).

## Data model

Extend `DeckRating` in `api/lib/types.ts`:

```ts
export interface DeckRating {
  deckId: string;
  mu: number;
  sigma: number;
  gamesPlayed: number;
  wins: number;
  /** Sum of winning turnCounts across all recorded wins. avg = winTurnSum / <wins with a turn recorded>. */
  winTurnSum?: number;
  /** Count of wins that contributed to winTurnSum (≤ wins; missing turnCounts are excluded). */
  winTurnWins?: number;
  /** 16 bins — indexes 0..14 map to turns 1..15, index 15 is "16+". */
  winTurnHistogram?: number[];
  lastUpdated: string;
  deckName?: string;
  setName?: string | null;
  isPrecon?: boolean;
  primaryCommander?: string | null;
}
```

`winTurnWins` is separate from `wins` because historical match_results may have `turnCount === null`; if we divided by `wins`, decks with missing data would report a too-low average. All three new fields are optional so existing rating docs (pre-backfill) still deserialize.

### Persistence

**Firestore:** just new fields on `ratings/{deckId}` documents. No schema migration, no new index required. Backfill queries `matchResults` full-scan (not filtered by winner) and groups in memory.

**SQLite:** add three columns to `ratings` table, with a migration in `api/lib/db.ts`:

```sql
ALTER TABLE ratings ADD COLUMN win_turn_sum INTEGER;
ALTER TABLE ratings ADD COLUMN win_turn_wins INTEGER;
ALTER TABLE ratings ADD COLUMN win_turn_histogram TEXT;  -- JSON-encoded 16-element array
```

`rating-store-sqlite.ts` read/write paths serialize/deserialize the histogram column as JSON.

## Ingestion / aggregation

In `api/lib/trueskill-service.ts`, inside the existing per-game loop that already updates `gamesPlayed`/`wins` on the winner (see `processJobMatchResults`, ~lines 82–128), add:

```ts
if (game.winningTurn != null && winnerIdx !== -1) {
  const current = currentRatings[winnerIdx]!;
  const bin = Math.min(Math.max(game.winningTurn, 1), 16) - 1;
  const hist = [...(current.winTurnHistogram ?? new Array(16).fill(0))];
  hist[bin] += 1;
  currentRatings[winnerIdx] = {
    ...current,
    winTurnSum: (current.winTurnSum ?? 0) + game.winningTurn,
    winTurnWins: (current.winTurnWins ?? 0) + 1,
    winTurnHistogram: hist,
  };
}
```

This piggy-backs on the existing `store.updateRatings(currentRatings)` call; both store backends already use set/upsert semantics so the added fields serialize through unchanged.

## Backfill

New admin-gated route: `POST /api/admin/backfill-win-turns`, modeled on `api/app/api/admin/backfill-ratings/route.ts`.

Algorithm:

1. Scan all `matchResults` where `winnerDeckId != null` and `turnCount != null`.
2. Group in memory by `winnerDeckId`; for each deck accumulate `{ sum, count, histogram[16] }` using the same bin rule as live ingestion.
3. For each aggregated `deckId`, read the current rating doc; if it exists, overwrite only `winTurnSum`, `winTurnWins`, `winTurnHistogram`. Ratings missing a deck doc are skipped (no deck ⇒ nothing to show).
4. Decks with existing ratings but no matching match_results leave these fields unset — they naturally render as "—" in the UI.

Idempotent — re-running recomputes from match_results and overwrites with the same result.

## API

Extend `LeaderboardEntry` in `api/app/api/leaderboard/route.ts`:

```ts
export interface LeaderboardEntry {
  // ... existing fields
  /** Mean of winning turnCount across resolved wins. null when no data (winTurnWins === 0 or undefined). */
  avgWinTurn: number | null;
  /** 16 bins; null when no data (histogram undefined or all zeros). */
  winTurnHistogram: number[] | null;
}
```

Route fills these from the rating doc:

```ts
const winTurnWins = r.winTurnWins ?? 0;
avgWinTurn: winTurnWins > 0 ? (r.winTurnSum ?? 0) / winTurnWins : null,
winTurnHistogram: (r.winTurnHistogram?.some(n => n > 0) ? r.winTurnHistogram : null) ?? null,
```

Cache (5-min TTL) behaviour unchanged; cache key does not need updating because the new fields ride inside existing cached entries. After deploying, a single cache miss repopulates with the enriched payload.

Payload impact: ~140 bytes/deck × 500 decks ≈ 70 KB. Acceptable.

## Frontend

### Column

`frontend/src/pages/Leaderboard.tsx`:

- Extend `LeaderboardEntry` with `avgWinTurn: number | null` and `winTurnHistogram: number[] | null`.
- Extend `SortKey` union to `'rating' | 'winRate' | 'gamesPlayed' | 'avgWinTurn'`.
- Add `<SortHeader label="Avg Win Turn" sortKey="avgWinTurn" ... />` between "Win Rate" and "Games".
- Sort comparator for `avgWinTurn`: decks with `null` sort to the bottom regardless of direction. Among non-null, ascending (fastest wins first) — unlike rating/winRate which sort descending, because "fastest" is generally desirable. Use `(a ?? Infinity) - (b ?? Infinity)`.
- Cell renders: `{entry.avgWinTurn != null ? entry.avgWinTurn.toFixed(1) : '—'}` followed by an `ⓘ` info icon only when `entry.winTurnHistogram != null`.

### Histogram tooltip

New component at `frontend/src/components/WinTurnTooltip.tsx`. **Takes only the data it needs to render** — no passing the whole leaderboard entry:

```ts
interface WinTurnTooltipProps {
  histogram: number[];   // length 16
  avgWinTurn: number;    // avg turn (non-null; parent decides whether to render)
  totalWins: number;     // sum of histogram — shown as "N wins"
}
```

Structure:

- Absolutely positioned floating div, shown on `onMouseEnter`/`onMouseLeave` (or `onFocus`/`onBlur` for keyboard) of the icon.
- Small header: `Avg: {avg.toFixed(1)} · {totalWins} wins`.
- 16-bar chart: each bar's height = `count / max(histogram)`, with 0 rendered as an empty slot (still reserving width so x-axis alignment is stable). Labels under each bar: 1, 2, …, 15, "16+".
- Pure flex/CSS; no chart library.
- Styling follows the existing Tailwind palette (e.g., `bg-gray-800`, `border-gray-700`, bars in `bg-blue-500` fading to `bg-blue-700`).

Parent (`Leaderboard.tsx`) handles hover state per row and passes only `entry.winTurnHistogram`, `entry.avgWinTurn`, and the histogram sum down.

### Empty state

- `avgWinTurn === null` → render `—`, no info icon, no tooltip.
- Sortable column with such decks sinks them to the bottom.

## Testing

- **`api/test/trueskill-service.test.ts`** (create if it doesn't already exist for rating updates): feed a job with three games at turns 4, 8, 20, assert winner's `winTurnSum === 32`, `winTurnWins === 3`, and histogram bins `[0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,1]`. Include a case where `winningTurn === null` and assert only `wins` increments, no histogram/sum change.
- **`api/test/backfill-win-turns.test.ts`** (new): seed match_results with known winners/turnCounts, run the backfill, assert exact `winTurnSum`/`winTurnWins`/`winTurnHistogram` values on each affected rating doc; assert decks without match_results are untouched; assert idempotency (run twice, same result).
- **Frontend**: extend existing `Leaderboard` fixtures with `avgWinTurn` + `winTurnHistogram`. Add a test that the column renders the value and the info icon, hovering the icon mounts the tooltip with correct avg/wins text and correct bar count. Add a test for the empty state (`avgWinTurn: null` ⇒ dash, no icon).
- **Sort test**: clicking the "Avg Win Turn" header sorts ascending, and null entries stay at the bottom.

## Rollout

1. Ship data-model + live-ingestion changes + SQLite migration in one PR; backfill endpoint + trigger it in staging; verify aggregates on a handful of decks against spot-checked match_results.
2. Ship the API change (new leaderboard fields) — safe to land before frontend since clients ignore unknown fields.
3. Ship frontend column + tooltip. Run the backfill on production rating store as part of release.

## Open risks

- **Sort direction for avg win turn is unlike other columns.** If users click expecting "sort by slowest first" by default, we'd want to support direction toggling. Out of scope for v1; revisit if feedback comes in.
- **Existing match_results with weird turn values** (e.g., 0 or negative from log-parse edge cases) will fall into bin 1. Acceptable noise; would be flagged by live data sampling if it became meaningful.
