# Worker SimulateScreen — combined deck management + run simulation

**Status:** Approved
**Author:** Tyler (via Claude)
**Date:** 2026-05-19

## Problem

The worker_flutter app currently splits deck interaction across two tabs:

- **Decks** — lists all decks (precons first, then user decks alphabetical), with a FAB to add via URL or pasted text.
- **New** — a deck picker for starting a simulation (search box + flat list).

Both screens show the same deck list ordered with precons first. The user's own decks sit at the very bottom of a long precon catalog, which makes them easy to miss on first launch. The two-tab split also forces a context switch between "manage decks" and "start a sim" even though every realistic interaction involves both.

The web frontend solved the same problem by combining everything into a single page (`frontend/src/pages/Home.tsx`): add a deck, see your community decks grouped above precons, pick four, set sim count, submit.

## Goals

1. Combine the worker's **Decks** and **New** tabs into one screen with the same flow as the web frontend.
2. Put **custom decks above precons** so the user sees their own decks first.
3. Make the deck list **searchable** and split it into **collapsible sections** (Custom open by default, Precons closed) so a long precon catalog doesn't bury the user's decks.
4. Apply the change to **both cloud and offline modes** since both share `DecksScreen` and `NewSimScreen`.

## Non-goals

- Changing how decks are persisted or how `CloudDeckRepo` / `OfflineDeckRepo` fetch them.
- Adding offline-mode sign-in or cloud-to-offline deck syncing (initially considered, ruled out).
- Adding the web frontend's "View source" link or owner email — the worker only ever shows the user's own decks in cloud mode, so owner info isn't useful here.

## Architecture

### Tab restructure

Cloud mode `Dashboard` (`lib/ui/dashboard.dart`) and offline mode `OfflineApp` (`lib/offline/offline_app.dart`) both drop two tabs and gain one:

```
Cloud   was: Worker | Jobs | Leaderboard | Decks | New
        now: Worker | Jobs | Leaderboard | Simulate

Offline was: History | Decks | New
        now: History | Simulate
```

Tab label: **"Simulate"**. Icon: `Icons.play_arrow` (carried over from the old "New" tab).

### Files affected

**New:**
- `lib/sims/simulate_screen.dart` — the combined screen (stateful, top-level entry).
- `lib/sims/deck_ingest_form.dart` — inline Add Deck form (URL + paste fallback).
- `lib/sims/deck_picker_section.dart` — one `ExpansionTile`-based collapsible section.
- `lib/sims/deck_row.dart` — single selectable row used by both sections.
- `lib/sims/simulation_controls.dart` — sticky bottom panel: picked chips, sim slider, Start button.

**Modified:**
- `lib/ui/dashboard.dart` — drop two `Tab`s + tab bodies, add one for `SimulateScreen`.
- `lib/offline/offline_app.dart` — same change.

**Deleted:**
- `lib/decks/decks_screen.dart` — superseded.
- `lib/decks/add_deck_screen.dart` — folded into `deck_ingest_form.dart`.
- `lib/sims/new_sim_screen.dart` — superseded.

`DeckRepo`, `CloudDeckRepo`, `OfflineDeckRepo`, and `DeckRecord` are unchanged — the new screen consumes the same `Stream<List<DeckRecord>>` API.

### `SimulateScreen` layout

A `Column` with a scrollable middle and a sticky bottom panel:

```
SimulateScreen (Scaffold)
├── body: Column
│   ├── Expanded(child: ListView)         ← scroll region
│   │   ├── DeckIngestForm                ← inline add-deck card
│   │   ├── Padding (header + search input)
│   │   ├── DeckPickerSection(custom)     ← ExpansionTile
│   │   └── DeckPickerSection(precons)    ← ExpansionTile
│   └── SimulationControls                ← sticky bottom (Container with shadow)
```

Background colors match the existing app: `Color(0xFF1F2937)` for the scaffold, `Color(0xFF111827)` for elevated panels and rows.

### State management

`SimulateScreen` is a `StatefulWidget` owning:

- `final TextEditingController _searchCtrl`
- `String _search = ''`
- `final List<String> _picked = []` (deck ids, insertion order, max 4)
- `int _sims = 10`
- `bool _customOpen = true`
- `bool _preconOpen = false`
- `bool _busy = false`
- `String? _error`

`SimulateScreen` subscribes to `widget.repo.watchDecks()` via `StreamBuilder`. The stream produces the full deck list; the screen partitions into `custom` and `precons` and filters by `_search` in-place during build. Filtering uses the lower-cased `_search` against `name`, `primaryCommander`, and `ownerEmail` (matches web filter behavior).

### Search-driven expansion override

When `_search` is non-empty, both sections are force-expanded if they have at least one match; sections with zero matches stay closed (the header still renders with "(0)" so the user knows they were excluded).

Implementation: `DeckPickerSection` takes an `expanded` bool. When `_search.isEmpty`, the parent passes `_customOpen`/`_preconOpen` (user-controlled). When `_search.isNotEmpty`, the parent passes `matchCount > 0` so any section with results auto-opens. Toggling the section header (`onExpansionChanged`) always updates the appropriate `_customOpen`/`_preconOpen` state, but during an active search the externally-driven `expanded` prop wins on the next `didUpdateWidget` rebuild — so user clicks during search are effectively ignored until the search clears.

`ExpansionTile` does not natively support external control of its expanded state; we use the `controller: ExpansionTileController()` API (Flutter 3.13+) to call `expand()` / `collapse()` from `didUpdateWidget` when the `expanded` prop changes.

### `DeckIngestForm` (inline add-deck)

Compact card at the top of the scroll region:

```
┌────────────────────────────────────────────┐
│ Add a deck                                 │
│ ┌──────────────────────────┐ ┌──────────┐  │
│ │ https://moxfield.com/…   │ │ Add deck │  │
│ └──────────────────────────┘ └──────────┘  │
│ Or paste a deck list ▾                     │  ← TextButton.icon
└────────────────────────────────────────────┘
```

When "Or paste a deck list" is tapped, the card expands to also show:
- Optional name input
- Optional external link input
- Multi-line paste textarea
- Second "Add deck" button (operates on the paste form, not the URL)

Error message and progress spinner replace the relevant button while a submission is in-flight. Error state is per-form (URL form and paste form don't share `_error`).

Validation mirrors the deleted `AddDeckScreen`:
- URL form: non-empty + `isSupportedDeckUrl(url)` from `ingestion.dart`.
- Paste form: non-empty body text.

On success: clears its own input, surfaces a transient `SnackBar` ("Added: <name>") via the parent — `DeckIngestForm` takes an `onAdded(String name)` callback. The new deck appears in the stream automatically.

### `DeckPickerSection`

A single `ExpansionTile` wrapper:

- `title`: `"<section name> (<count>)"` — count reflects the filtered count when search is active, total otherwise.
- `initiallyExpanded`: controlled externally as described above.
- `onExpansionChanged`: callback to parent (ignored during search).
- Children: empty-state widget if `decks.isEmpty`, otherwise a `Column` of `DeckRow`s.
- Section header styling: subtle gray background (`0xFF111827`), white title text.

Empty state per section:
- Custom: "No custom decks yet — add one above." (or, with search: "No custom decks match.")
- Precons: "No precons available." (or, with search: "No precons match.")

### `DeckRow`

Selectable row used in both sections. Constructed with the minimum the row renders, per the project's "Keep component props narrow" rule:

```dart
class DeckRow extends StatelessWidget {
  const DeckRow({
    required this.name,
    required this.colorIdentity,
    required this.subtitle,        // primaryCommander OR ownerEmail OR null
    required this.isPrecon,
    required this.pickIndex,       // null = unpicked, 1-4 = pick order
    required this.canDelete,
    required this.onTap,
    required this.onDelete,        // ignored when canDelete is false
  });
}
```

Visual structure:
- Leading: 28px circle. If `pickIndex != null` → solid blue circle with the number; else an outlined empty circle.
- Title: deck name + `_ColorPips` (color identity dots, ported from existing `decks_screen.dart`).
- Subtitle (if non-null): 11px gray text.
- Trailing: delete icon button (only when `canDelete && pickIndex == null`).
- Whole row is an `InkWell` with `onTap = onTap`. The delete icon's `IconButton.onPressed` stops propagation by not bubbling.

Row background:
- Unpicked: `Color(0xFF111827)`.
- Picked: `Color(0xFF1E3A8A)` (deep blue, matches the existing chip color).

### `SimulationControls` (sticky bottom)

Mirror of the existing bottom panel in `NewSimScreen`:

- "Picked (n/4)" header.
- Wrap of `Chip`s for picked decks, with delete buttons that call back to the parent to un-pick.
- "Simulations: $_sims" label.
- `Slider` (1–200, 199 divisions) updating `_sims`.
- Error message (red) if `_error != null`.
- `FilledButton` "Start simulation", enabled only when 4 decks are picked and not busy.

`SimulationControls` takes:
- `List<DeckRecord> picked` (just for chip rendering — narrow props)
- `int sims`
- `ValueChanged<int> onSimsChanged`
- `String? error`
- `bool busy`
- `VoidCallback onUnpick(String deckId)`
- `VoidCallback onStart`

### Deletion-while-picked

The delete icon on a row is hidden while that row is picked (see `DeckRow`), so deletion from the same screen while picked isn't possible. But a deck can still disappear out from under `_picked` for two reasons:

1. Cloud mode: another client (the web frontend, another worker) deletes the deck and the Firestore stream emits the new list.
2. The stream's first emission after sign-in or relaunch may not include a deck that was in a saved `_picked` list — though we don't currently persist `_picked` across launches, so this is theoretical.

In either case, the `StreamBuilder` build path partitions the new list and finds the picked id missing. Schedule a `WidgetsBinding.instance.addPostFrameCallback` to drop the missing id(s) from `_picked` and `setState`. This is a strict improvement over the existing `NewSimScreen`, which leaves `_picked` containing the dead id and renders a `?` placeholder chip.

### Data flow on Start

Unchanged from the current screens — `SimulateScreen` takes a `StartJob` typedef and `onJobCreated` callback identical to the existing `NewSimScreen`. Both modes pass in their own implementations:
- Cloud: POSTs to `/api/jobs` and navigates to `CloudJobDetailScreen`.
- Offline: writes to local Drift via `runner.run(jobId)` and navigates to the offline `_JobScreen`.

## Error handling

- Failed deck creation (network error, bad URL, parse error): error message shown inline in `DeckIngestForm`, button re-enabled. Existing `DeckRepo` exception messages already include the user-actionable string.
- Failed job submission: error shown above the Start button (existing pattern from `NewSimScreen`).
- Stream error: shows a centered "Couldn't load decks: ${error}" message — same as current `DecksScreen`.

## Testing

- **Widget test** for `SimulateScreen`:
  - Renders sections with counts.
  - Search input filters decks across both sections and auto-expands sections with matches.
  - Tapping a deck row toggles selection and renders a numbered pick badge.
  - Start button is disabled until exactly 4 decks are picked.
- **Widget test** for `DeckPickerSection`:
  - Renders empty state when given an empty list.
  - Respects `expanded` prop and surfaces `onExpansionChanged`.
- **Widget test** for `DeckRow`:
  - Tap triggers `onTap`.
  - Delete icon only renders when `canDelete && pickIndex == null`.
- **Widget test** for `DeckIngestForm`:
  - URL submission calls `onAdded` on success.
  - Paste section toggles open.

Run `flutter analyze` (zero warnings) and `flutter test` in `worker_flutter/` to confirm. No existing test should regress.

## Migration notes

- The deleted screens are not exported anywhere else in the repo (`DecksScreen`, `NewSimScreen`, and `AddDeckScreen` are only constructed from the two app shells). Safe to remove their files outright.
- The `decks_screen.dart` file contains a `_ColorPips` widget. Move it to a new `lib/sims/color_pips.dart` as a public `ColorPips` widget consumed by `DeckRow`; deletion of `decks_screen.dart` must happen after the move, not before.
- Tray menu / dashboard wiring elsewhere does not reference the dropped tabs.
