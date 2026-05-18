# Flutter Worker — Create Simulations + Deck Management

Date: 2026-05-14
Status: design approved, ready for plan

## Problem

The Flutter worker app today is consumption-only: cloud mode browses jobs read-only, offline mode runs sims but only from bundled precons. Users have to bounce to the web frontend to submit simulations or save decks from a URL.

This spec adds full-parity deck management + sim creation to both modes. In cloud mode, decks sync live from Firestore. In offline mode, decks are stored locally in Drift.

## Goals

1. Submit new sims from the Flutter app in both cloud and offline mode.
2. Manage saved decks (list, add via URL, add via raw text paste, delete) in both modes.
3. Cloud-mode decks live in the existing Firestore `/decks` collection and stream live.
4. Offline-mode decks live in the local Drift DB, alongside bundled precons.
5. URL support in both modes covers all providers the web frontend supports (Moxfield, Archidekt, ManaBox, ManaPool).

## Non-goals

- Editing existing decks (web frontend doesn't support this either today).
- Bidirectional sync between offline Drift and cloud Firestore. Mode-switching does not migrate decks. Documented as a future plan.
- Importing the user's cloud decks into offline mode on first switch (same reason).

## Architecture

```
worker_flutter/lib/
├── ingestion/                  NEW — Dart port of api/lib/ingestion/
│   ├── parsed_deck.dart        ParsedDeck { name, dck, colorIdentity, link?, primaryCommander? }
│   ├── moxfield.dart
│   ├── archidekt.dart
│   ├── manabox.dart
│   ├── manapool.dart
│   ├── text_parser.dart
│   ├── to_dck.dart
│   ├── scryfall.dart           batch color-identity lookup
│   └── ingestion.dart          public API: fetchDeckFromUrl(url), parseDeckText(text)
├── decks/                      NEW
│   ├── deck_record.dart        UI-facing type (mode-agnostic)
│   ├── deck_repo.dart          abstract DeckRepo
│   ├── cloud_deck_repo.dart
│   ├── offline_deck_repo.dart
│   ├── decks_screen.dart
│   └── add_deck_screen.dart
├── sims/                       NEW
│   ├── new_sim_screen.dart     4-deck picker + sim-count slider
│   └── start_job.dart          StartJob = Future<String> Function(...); cloud vs offline impls
├── api_client.dart             NEW — small auth'd HTTP client (Firebase ID token)
└── offline/db/                 EXTEND — Decks table + DAO, migration v1→v2
```

### Mode-agnostic abstractions

```dart
abstract class DeckRepo {
  Stream<List<DeckRecord>> watchDecks();
  Future<DeckRecord> createFromUrl(String url);
  Future<DeckRecord> createFromText(String text, {String? name, String? link});
  Future<void> deleteDeck(String id);
}

typedef StartJob = Future<String> Function(List<DeckRecord> decks, int simCount);
// Returns the new job's id. In cloud mode this is the Firestore doc id;
// in offline mode the auto-increment int as a string.
```

Both `DecksScreen` and `NewSimScreen` take a `DeckRepo` (and `NewSimScreen` also takes a `StartJob`). They have no knowledge of cloud-vs-offline.

### CloudDeckRepo

- `watchDecks()` → Firestore stream of `decks` where `ownerId == currentUser.uid` OR `isPrecon == true`. Mirrors web frontend behavior.
- `createFromUrl(url)` → POST `/api/decks/create` with `Authorization: Bearer <Firebase ID token>`, body `{ deckUrl }`. Returns the deck doc from the response.
- `createFromText(text, name, link)` → POST `/api/decks/create` body `{ deckText, deckName, deckLink }`.
- `deleteDeck(id)` → DELETE `/api/decks/[id]` (existing route).

Decks are written by the server; the Firestore stream reflects the new doc within ~1s. We do not optimistically insert.

### OfflineDeckRepo

- `watchDecks()` → Drift `Decks` table watch, merged with `loadBundledPrecons(forgePath)` results at the top of the list. Bundled precons are read-only (delete is hidden).
- `createFromUrl(url)` → `ingestion.fetchDeckFromUrl(url)` → write a Drift row + materialize the `.dck` file under `config.decksPath` so the sim runner finds it by filename.
- `createFromText(...)` → same flow, skipping the HTTP fetch.
- `deleteDeck(id)` → Drift delete + remove the `.dck` from disk.

### Cloud-mode UI wiring

`Dashboard` (existing) currently has three tabs: Worker | Jobs | Leaderboard. We add two: **Decks** | **New simulation**. After successful job creation, push `CloudJobDetailScreen(jobId: …)`.

### Offline-mode UI wiring

`offline_app.dart`'s `_HomeScreen` becomes tabbed: **History** | **Decks** | **New simulation**. The existing "New simulation run" button is removed (replaced by the New tab). The existing `_JobScreen` is reused as the destination after starting.

### ParsedDeck contract

```dart
class ParsedDeck {
  final String name;
  final String dck;
  final List<String>? colorIdentity;
  final String? link;
  final String? primaryCommander;
}
```

Same shape as the TS `Deck` object returned by `api/lib/ingestion/index.ts` so both implementations stay portable.

### Scryfall lookup

`scryfall.dart` exposes `Future<List<String>> colorIdentityForCards(List<String> cardNames)` using `POST https://api.scryfall.com/cards/collection`. Failure is non-fatal — caller sets `colorIdentity = null` and the deck still saves.

## Data flow

**Cloud add-deck:** AddDeckScreen → CloudDeckRepo → POST `/api/decks/create` → API ingestion → Firestore write → Firestore stream emits new doc → DecksScreen updates.

**Cloud start-sim:** NewSimScreen picks 4 → POST `/api/jobs { deckIds, simulations }` → API creates job doc + sim subcollection → workers pick up via `claim-sim` polling → navigate to `CloudJobDetailScreen`.

**Offline add-deck:** AddDeckScreen → OfflineDeckRepo → `ingestion.fetchDeckFromUrl` → write Drift row + write `.dck` to disk → Drift watch emits → DecksScreen updates.

**Offline start-sim:** NewSimScreen picks 4 → ensure all 4 `.dck` files are on disk (precons may need materialization) → `AppDb.createJob(deckNames, simCount)` → `OfflineRunner.run(jobId)` → navigate to `_JobScreen`.

## Drift schema (v2)

```dart
@DataClassName('DeckRow')
class Decks extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get filename => text().unique()(); // <slug>.dck
  TextColumn get dckContent => text()();
  TextColumn get colorIdentity => text().nullable()(); // "WUB"
  TextColumn get link => text().nullable()();
  TextColumn get primaryCommander => text().nullable()();
  BoolColumn get isPrecon => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
}
```

Migration v1→v2: `CREATE TABLE decks (…)`. No backfill of bundled precons — they're listed live from assets.

## Error handling

| Failure | Surface |
|---|---|
| URL fetch HTTP error | Inline error in AddDeckScreen, with provider name + status code |
| URL not a recognized provider | "Use a Moxfield, Archidekt, ManaBox, or ManaPool URL" |
| Private/deleted deck | "Deck is private or doesn't exist — make it public and try again" |
| Scryfall lookup failure | Save with `colorIdentity = null`, log a debug breadcrumb |
| Firebase ID token expired | Catch 401, prompt re-sign-in via existing AuthGate route |
| Rate limit (cloud) | Surface API's `error` field verbatim with a 429 badge |
| Drift write failure | Toast + log; don't leave a half-written `.dck` (write to a temp path, rename on commit) |

## Testing

- Per-provider unit tests with real-response fixtures from the existing TS tests where possible (`api/test/ingestion*`). Verify `ParsedDeck` shape matches.
- `to_dck` round-trip on a known card list.
- Drift v1→v2 migration test using the existing `app_db_test` pattern.
- Widget test for `NewSimScreen` with a fake `DeckRepo`: picks 4, slider, taps Start, `StartJob` callback fires with the right args.
- One end-to-end widget test per mode wiring the screen into its tab host (cloud Dashboard, offline _HomeScreen).

## Open follow-ups (deferred)

- One-way migration from offline → cloud on mode switch ("import these decks to your cloud library").
- Editing decks (web frontend doesn't either, so this is a cross-cutting feature).
- Precon multi-pick auto-selection (e.g. "pick 4 random precons") — out of scope for this spec.
