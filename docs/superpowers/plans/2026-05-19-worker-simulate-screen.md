# Worker SimulateScreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the worker's separate `Decks` and `New` tabs with a single `Simulate` tab that combines deck management and deck-picker into one screen, with inline add-deck form, collapsible Custom/Precons sections (Custom open, Precons closed by default), and a search box that auto-expands sections with matches. Apply to both cloud and offline modes.

**Architecture:** A new `SimulateScreen` (in `lib/sims/`) composes five smaller widgets: `DeckIngestForm`, `DeckPickerSection` × 2, `DeckRow`, and `SimulationControls`. Each widget takes narrow props (only what it renders). The existing `DeckRepo` abstraction is unchanged — both modes already converge on `Stream<List<DeckRecord>>`. The old `DecksScreen`, `AddDeckScreen`, and `NewSimScreen` are deleted.

**Tech Stack:** Flutter (Material), `ExpansionTile` with `ExpansionTileController`, existing `DeckRepo` / `DeckRecord` types, `flutter_test` widget tests.

---

## File Structure

**Create:**
- `worker_flutter/lib/sims/color_pips.dart` — 5-color WUBRG dots
- `worker_flutter/lib/sims/deck_row.dart` — Selectable row with optional delete
- `worker_flutter/lib/sims/deck_picker_section.dart` — Collapsible section wrapper
- `worker_flutter/lib/sims/deck_ingest_form.dart` — Inline "Add a deck" card
- `worker_flutter/lib/sims/simulation_controls.dart` — Sticky bottom panel
- `worker_flutter/lib/sims/simulate_screen.dart` — Combined screen entry point
- `worker_flutter/test/sims/simulate_screen_test.dart` — Widget tests for the screen
- `worker_flutter/test/sims/deck_picker_section_test.dart` — Section behavior
- `worker_flutter/test/sims/deck_row_test.dart` — Row behavior
- `worker_flutter/test/sims/deck_ingest_form_test.dart` — Ingest form behavior

**Modify:**
- `worker_flutter/lib/ui/dashboard.dart` — Drop Decks + New tabs; add Simulate
- `worker_flutter/lib/offline/offline_app.dart` — Same change for offline mode

**Delete:**
- `worker_flutter/lib/decks/decks_screen.dart`
- `worker_flutter/lib/decks/add_deck_screen.dart`
- `worker_flutter/lib/sims/new_sim_screen.dart`
- `worker_flutter/test/sims/new_sim_screen_test.dart`

---

## Task 1: Extract `ColorPips` widget

**Files:**
- Create: `worker_flutter/lib/sims/color_pips.dart`

`_ColorPips` from `lib/decks/decks_screen.dart` is used to render WUBRG color identity dots. We move it to its own file (public `ColorPips`) so the new `DeckRow` can use it without depending on the soon-to-be-deleted `decks_screen.dart`.

- [ ] **Step 1: Write `lib/sims/color_pips.dart`**

```dart
import 'package:flutter/material.dart';

/// WUBRG color-identity dots rendered as a 5-color circle row.
/// Used by deck rows in the Simulate screen.
class ColorPips extends StatelessWidget {
  const ColorPips({super.key, required this.colors});

  /// Single-letter codes: W, U, B, R, G. Unknown codes render gray.
  final List<String> colors;

  @override
  Widget build(BuildContext context) {
    const map = {
      'W': Color(0xFFFEF3C7),
      'U': Color(0xFF60A5FA),
      'B': Color(0xFF374151),
      'R': Color(0xFFF87171),
      'G': Color(0xFF34D399),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final c in colors)
          Padding(
            padding: const EdgeInsets.only(left: 3),
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: map[c] ?? Colors.grey,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFF111827)),
              ),
            ),
          ),
      ],
    );
  }
}
```

- [ ] **Step 2: Run analyzer**

```bash
cd worker_flutter && flutter analyze lib/sims/color_pips.dart
```
Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add worker_flutter/lib/sims/color_pips.dart
git commit -m "feat(worker_flutter): extract ColorPips widget for reuse"
```

---

## Task 2: `DeckRow` widget + test

**Files:**
- Create: `worker_flutter/lib/sims/deck_row.dart`
- Create: `worker_flutter/test/sims/deck_row_test.dart`

A single selectable row used inside both Custom and Precons sections. Takes narrow props — no `DeckRecord` — so it can render any source.

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/sims/deck_row_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/sims/deck_row.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders name and subtitle; tap fires onTap', (tester) async {
    var tapped = 0;
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'Edgar Markov',
      colorIdentity: const ['W', 'B', 'R'],
      subtitle: 'Edgar Markov',
      isPrecon: false,
      pickIndex: null,
      canDelete: true,
      onTap: () => tapped += 1,
      onDelete: () {},
    )));

    expect(find.text('Edgar Markov'), findsWidgets);
    await tester.tap(find.text('Edgar Markov').first);
    expect(tapped, 1);
  });

  testWidgets('renders pick index when selected', (tester) async {
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'Atraxa',
      colorIdentity: const [],
      subtitle: null,
      isPrecon: false,
      pickIndex: 2,
      canDelete: true,
      onTap: () {},
      onDelete: () {},
    )));

    expect(find.text('2'), findsOneWidget);
  });

  testWidgets('delete icon only when canDelete && pickIndex == null', (tester) async {
    // canDelete=false hides the icon
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'P',
      colorIdentity: const [],
      subtitle: null,
      isPrecon: true,
      pickIndex: null,
      canDelete: false,
      onTap: () {},
      onDelete: () {},
    )));
    expect(find.byIcon(Icons.delete_outline), findsNothing);

    // picked hides the icon
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'C',
      colorIdentity: const [],
      subtitle: null,
      isPrecon: false,
      pickIndex: 1,
      canDelete: true,
      onTap: () {},
      onDelete: () {},
    )));
    expect(find.byIcon(Icons.delete_outline), findsNothing);

    // unpicked + canDelete shows the icon
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'D',
      colorIdentity: const [],
      subtitle: null,
      isPrecon: false,
      pickIndex: null,
      canDelete: true,
      onTap: () {},
      onDelete: () {},
    )));
    expect(find.byIcon(Icons.delete_outline), findsOneWidget);
  });

  testWidgets('delete icon tap fires onDelete, not onTap', (tester) async {
    var taps = 0;
    var deletes = 0;
    await tester.pumpWidget(_wrap(DeckRow(
      name: 'Combo',
      colorIdentity: const [],
      subtitle: null,
      isPrecon: false,
      pickIndex: null,
      canDelete: true,
      onTap: () => taps += 1,
      onDelete: () => deletes += 1,
    )));

    await tester.tap(find.byIcon(Icons.delete_outline));
    expect(taps, 0);
    expect(deletes, 1);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker_flutter && flutter test test/sims/deck_row_test.dart
```
Expected: fails — `DeckRow` not defined.

- [ ] **Step 3: Write `lib/sims/deck_row.dart`**

```dart
import 'package:flutter/material.dart';

import 'color_pips.dart';

/// Selectable deck row used in both Custom and Precons sections.
///
/// Props are kept narrow — `DeckRow` doesn't know about [DeckRecord]
/// so the parent decides how to map fields.
class DeckRow extends StatelessWidget {
  const DeckRow({
    super.key,
    required this.name,
    required this.colorIdentity,
    required this.subtitle,
    required this.isPrecon,
    required this.pickIndex,
    required this.canDelete,
    required this.onTap,
    required this.onDelete,
  });

  final String name;
  final List<String> colorIdentity;
  final String? subtitle;
  final bool isPrecon;

  /// 1..4 when picked (rendered as a numbered badge); null when unpicked.
  final int? pickIndex;

  /// Whether the trailing delete icon is allowed. Even when true, the
  /// icon is hidden while the row is picked (avoids accidental
  /// destruction during selection).
  final bool canDelete;

  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final picked = pickIndex != null;
    final showDelete = canDelete && !picked;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: picked ? const Color(0xFF1E3A8A) : const Color(0xFF111827),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: picked
                ? const Color(0xFF60A5FA)
                : const Color(0xFF374151),
          ),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 28,
              child: picked
                  ? CircleAvatar(
                      radius: 10,
                      backgroundColor: const Color(0xFF60A5FA),
                      child: Text(
                        '$pickIndex',
                        style: const TextStyle(
                          fontSize: 11,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : const Icon(
                      Icons.radio_button_unchecked,
                      size: 18,
                      color: Colors.white54,
                    ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      if (isPrecon)
                        const Padding(
                          padding: EdgeInsets.only(right: 6),
                          child: Icon(
                            Icons.inventory_2_outlined,
                            size: 14,
                            color: Color(0xFF9CA3AF),
                          ),
                        ),
                      Expanded(
                        child: Text(
                          name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (colorIdentity.isNotEmpty)
                        ColorPips(colors: colorIdentity),
                    ],
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (showDelete)
              IconButton(
                tooltip: 'Delete',
                icon: const Icon(
                  Icons.delete_outline,
                  color: Color(0xFFF87171),
                  size: 18,
                ),
                onPressed: onDelete,
              ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd worker_flutter && flutter test test/sims/deck_row_test.dart
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/sims/deck_row.dart worker_flutter/test/sims/deck_row_test.dart
git commit -m "feat(worker_flutter): add DeckRow widget with selection + delete"
```

---

## Task 3: `DeckPickerSection` widget + test

**Files:**
- Create: `worker_flutter/lib/sims/deck_picker_section.dart`
- Create: `worker_flutter/test/sims/deck_picker_section_test.dart`

A collapsible section wrapper around `ExpansionTile` that supports externally-controlled expansion state (so the parent can force-expand on search).

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/sims/deck_picker_section_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/sims/deck_picker_section.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders title with count', (tester) async {
    await tester.pumpWidget(_wrap(DeckPickerSection(
      title: 'Your decks',
      count: 3,
      expanded: true,
      onExpansionChanged: (_) {},
      emptyText: 'none',
      children: const [Text('A'), Text('B'), Text('C')],
    )));

    expect(find.text('Your decks (3)'), findsOneWidget);
    expect(find.text('A'), findsOneWidget);
    expect(find.text('B'), findsOneWidget);
    expect(find.text('C'), findsOneWidget);
  });

  testWidgets('shows emptyText when count is 0', (tester) async {
    await tester.pumpWidget(_wrap(DeckPickerSection(
      title: 'Precons',
      count: 0,
      expanded: true,
      onExpansionChanged: (_) {},
      emptyText: 'No precons match.',
      children: const [],
    )));

    expect(find.text('Precons (0)'), findsOneWidget);
    expect(find.text('No precons match.'), findsOneWidget);
  });

  testWidgets('onExpansionChanged fires when header tapped', (tester) async {
    bool? captured;
    await tester.pumpWidget(_wrap(DeckPickerSection(
      title: 'X',
      count: 1,
      expanded: false,
      onExpansionChanged: (v) => captured = v,
      emptyText: '',
      children: const [Text('item')],
    )));

    await tester.tap(find.text('X (1)'));
    await tester.pumpAndSettle();
    expect(captured, true);
  });

  testWidgets('externally-driven expanded prop is honored on rebuild',
      (tester) async {
    Widget build(bool expanded) => _wrap(DeckPickerSection(
          title: 'X',
          count: 1,
          expanded: expanded,
          onExpansionChanged: (_) {},
          emptyText: '',
          children: const [Text('hidden-or-shown')],
        ));

    await tester.pumpWidget(build(false));
    expect(find.text('hidden-or-shown'), findsNothing);

    await tester.pumpWidget(build(true));
    await tester.pumpAndSettle();
    expect(find.text('hidden-or-shown'), findsOneWidget);

    await tester.pumpWidget(build(false));
    await tester.pumpAndSettle();
    expect(find.text('hidden-or-shown'), findsNothing);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker_flutter && flutter test test/sims/deck_picker_section_test.dart
```
Expected: fails — `DeckPickerSection` not defined.

- [ ] **Step 3: Write `lib/sims/deck_picker_section.dart`**

```dart
import 'package:flutter/material.dart';

/// Collapsible section header used by [SimulateScreen]. Wraps
/// [ExpansionTile] with externally-controlled expansion so the parent
/// can force-expand during an active search.
class DeckPickerSection extends StatefulWidget {
  const DeckPickerSection({
    super.key,
    required this.title,
    required this.count,
    required this.expanded,
    required this.onExpansionChanged,
    required this.emptyText,
    required this.children,
  });

  final String title;

  /// Shown in the header as "$title ($count)". When 0, the body
  /// renders [emptyText] instead of [children].
  final int count;

  /// Externally-controlled expansion state. When this prop changes,
  /// the underlying [ExpansionTile] is told to expand/collapse to
  /// match. User-initiated toggles still call [onExpansionChanged] but
  /// the visible state is reconciled back to this prop on the next
  /// rebuild.
  final bool expanded;

  final ValueChanged<bool> onExpansionChanged;

  /// Text shown in the body when [count] is 0.
  final String emptyText;

  final List<Widget> children;

  @override
  State<DeckPickerSection> createState() => _DeckPickerSectionState();
}

class _DeckPickerSectionState extends State<DeckPickerSection> {
  late final ExpansionTileController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = ExpansionTileController();
  }

  @override
  void didUpdateWidget(covariant DeckPickerSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.expanded != widget.expanded) {
      // Defer to avoid manipulating the tile mid-build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (widget.expanded) {
          _ctrl.expand();
        } else {
          _ctrl.collapse();
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        controller: _ctrl,
        initiallyExpanded: widget.expanded,
        onExpansionChanged: widget.onExpansionChanged,
        iconColor: Colors.white70,
        collapsedIconColor: Colors.white70,
        title: Text(
          '${widget.title} (${widget.count})',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        children: widget.count == 0
            ? [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    widget.emptyText,
                    style: const TextStyle(color: Colors.white54),
                  ),
                ),
              ]
            : widget.children,
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd worker_flutter && flutter test test/sims/deck_picker_section_test.dart
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/sims/deck_picker_section.dart worker_flutter/test/sims/deck_picker_section_test.dart
git commit -m "feat(worker_flutter): add DeckPickerSection collapsible wrapper"
```

---

## Task 4: `DeckIngestForm` widget + test

**Files:**
- Create: `worker_flutter/lib/sims/deck_ingest_form.dart`
- Create: `worker_flutter/test/sims/deck_ingest_form_test.dart`

Inline add-deck card. URL input + Add button at top; "Or paste a deck list" disclosure that expands to show name/link/textarea + a second Add button.

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/sims/deck_ingest_form_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/decks/deck_record.dart';
import 'package:worker_flutter/decks/deck_repo.dart';
import 'package:worker_flutter/sims/deck_ingest_form.dart';

class _FakeRepo implements DeckRepo {
  String? lastUrl;
  String? lastText;
  String? lastName;
  @override
  Stream<List<DeckRecord>> watchDecks() => Stream.value(const []);
  @override
  Future<DeckRecord> createFromUrl(String url) async {
    lastUrl = url;
    return DeckRecord(
      id: 'u1', name: 'From URL', filename: 'u1.dck', isPrecon: false,
    );
  }
  @override
  Future<DeckRecord> createFromText(String text, {String? name, String? link}) async {
    lastText = text;
    lastName = name;
    return DeckRecord(
      id: 't1', name: name ?? 'From Text', filename: 't1.dck', isPrecon: false,
    );
  }
  @override
  Future<void> deleteDeck(DeckRecord deck) async {}
}

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('URL submit calls repo.createFromUrl and onAdded', (tester) async {
    final repo = _FakeRepo();
    String? added;

    await tester.pumpWidget(_wrap(DeckIngestForm(
      repo: repo,
      onAdded: (name) => added = name,
    )));

    await tester.enterText(
      find.widgetWithText(TextField, 'https://moxfield.com/decks/...'),
      'https://moxfield.com/decks/abcd',
    );
    // First Add button is the URL form's
    await tester.tap(find.widgetWithText(FilledButton, 'Add deck').first);
    await tester.pumpAndSettle();

    expect(repo.lastUrl, 'https://moxfield.com/decks/abcd');
    expect(added, 'From URL');
  });

  testWidgets('paste section toggles open and submits', (tester) async {
    final repo = _FakeRepo();
    String? added;

    await tester.pumpWidget(_wrap(DeckIngestForm(
      repo: repo,
      onAdded: (name) => added = name,
    )));

    // Disclosure starts closed
    expect(find.byKey(const ValueKey('paste-textarea')), findsNothing);

    await tester.tap(find.text('Or paste a deck list'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('paste-textarea')), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('paste-name')),
      'My Deck',
    );
    await tester.enterText(
      find.byKey(const ValueKey('paste-textarea')),
      '1 Sol Ring',
    );
    // Second Add button (in the paste section)
    await tester.tap(find.widgetWithText(FilledButton, 'Add deck').last);
    await tester.pumpAndSettle();

    expect(repo.lastText, '1 Sol Ring');
    expect(repo.lastName, 'My Deck');
    expect(added, 'My Deck');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker_flutter && flutter test test/sims/deck_ingest_form_test.dart
```
Expected: fails — `DeckIngestForm` not defined.

- [ ] **Step 3: Write `lib/sims/deck_ingest_form.dart`**

```dart
import 'package:flutter/material.dart';

import '../decks/deck_repo.dart';
import '../ingestion/ingestion.dart';

/// Inline "Add a deck" card. URL form is always visible; a disclosure
/// toggles a paste form below for users who can't share a public URL.
class DeckIngestForm extends StatefulWidget {
  const DeckIngestForm({
    super.key,
    required this.repo,
    required this.onAdded,
  });

  final DeckRepo repo;

  /// Called with the new deck's name after a successful save.
  final ValueChanged<String> onAdded;

  @override
  State<DeckIngestForm> createState() => _DeckIngestFormState();
}

class _DeckIngestFormState extends State<DeckIngestForm> {
  final _urlCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _linkCtrl = TextEditingController();
  final _textCtrl = TextEditingController();
  bool _pasteOpen = false;
  bool _urlBusy = false;
  bool _pasteBusy = false;
  String? _urlError;
  String? _pasteError;

  @override
  void dispose() {
    _urlCtrl.dispose();
    _nameCtrl.dispose();
    _linkCtrl.dispose();
    _textCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Add a deck',
            style: TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _urlCtrl,
                  enabled: !_urlBusy,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    hintText: 'https://moxfield.com/decks/...',
                    isDense: true,
                    filled: true,
                    fillColor: Color(0xFF1F2937),
                    border: OutlineInputBorder(borderSide: BorderSide.none),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _urlBusy ? null : _submitUrl,
                child: _urlBusy
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Add deck'),
              ),
            ],
          ),
          if (_urlError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _urlError!,
                style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
              ),
            ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _pasteOpen = !_pasteOpen),
              icon: Icon(
                _pasteOpen ? Icons.expand_less : Icons.expand_more,
                color: const Color(0xFF9CA3AF),
                size: 18,
              ),
              label: const Text(
                'Or paste a deck list',
                style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
              ),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                minimumSize: const Size(0, 28),
              ),
            ),
          ),
          if (_pasteOpen) ...[
            const SizedBox(height: 4),
            TextField(
              key: const ValueKey('paste-name'),
              controller: _nameCtrl,
              enabled: !_pasteBusy,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Deck name (optional)',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const ValueKey('paste-link'),
              controller: _linkCtrl,
              enabled: !_pasteBusy,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'External link (optional)',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              key: const ValueKey('paste-textarea'),
              controller: _textCtrl,
              enabled: !_pasteBusy,
              minLines: 4,
              maxLines: 10,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                color: Colors.white,
                fontFamily: 'Menlo',
                fontSize: 12,
              ),
              decoration: const InputDecoration(
                hintText: '1 Sol Ring\n1 Arcane Signet\n...\n\nCommander\n1 Atraxa',
                isDense: true,
                filled: true,
                fillColor: Color(0xFF1F2937),
                border: OutlineInputBorder(borderSide: BorderSide.none),
              ),
            ),
            if (_pasteError != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _pasteError!,
                  style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _pasteBusy ? null : _submitText,
              child: _pasteBusy
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Add deck'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _submitUrl() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) {
      setState(() => _urlError = 'Please enter a URL.');
      return;
    }
    if (!isSupportedDeckUrl(url)) {
      setState(() =>
          _urlError = 'Use a Moxfield, Archidekt, ManaBox, or ManaPool URL.');
      return;
    }
    setState(() {
      _urlBusy = true;
      _urlError = null;
    });
    try {
      final rec = await widget.repo.createFromUrl(url);
      if (!mounted) return;
      _urlCtrl.clear();
      widget.onAdded(rec.name);
    } catch (e) {
      if (!mounted) return;
      setState(() => _urlError = e.toString());
    } finally {
      if (mounted) setState(() => _urlBusy = false);
    }
  }

  Future<void> _submitText() async {
    final text = _textCtrl.text.trim();
    if (text.isEmpty) {
      setState(() => _pasteError = 'Paste a deck list first.');
      return;
    }
    setState(() {
      _pasteBusy = true;
      _pasteError = null;
    });
    try {
      final rec = await widget.repo.createFromText(
        text,
        name: _nameCtrl.text.trim().isEmpty ? null : _nameCtrl.text.trim(),
        link: _linkCtrl.text.trim().isEmpty ? null : _linkCtrl.text.trim(),
      );
      if (!mounted) return;
      _textCtrl.clear();
      _nameCtrl.clear();
      _linkCtrl.clear();
      widget.onAdded(rec.name);
    } catch (e) {
      if (!mounted) return;
      setState(() => _pasteError = e.toString());
    } finally {
      if (mounted) setState(() => _pasteBusy = false);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd worker_flutter && flutter test test/sims/deck_ingest_form_test.dart
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/sims/deck_ingest_form.dart worker_flutter/test/sims/deck_ingest_form_test.dart
git commit -m "feat(worker_flutter): add inline DeckIngestForm"
```

---

## Task 5: `SimulationControls` widget

**Files:**
- Create: `worker_flutter/lib/sims/simulation_controls.dart`

The sticky bottom panel: picked-chips row, sim count slider, Start button. Pulled from the existing `NewSimScreen` bottom panel.

- [ ] **Step 1: Write `lib/sims/simulation_controls.dart`**

```dart
import 'package:flutter/material.dart';

import '../decks/deck_record.dart';

/// Sticky bottom panel for [SimulateScreen]: picked-deck chips,
/// simulation count slider, and the Start button. State lives in the
/// parent — this widget is purely presentational.
class SimulationControls extends StatelessWidget {
  const SimulationControls({
    super.key,
    required this.picked,
    required this.sims,
    required this.onSimsChanged,
    required this.error,
    required this.busy,
    required this.onUnpick,
    required this.onStart,
  });

  /// Currently-picked decks, ordered as the user picked them.
  final List<DeckRecord> picked;

  final int sims;
  final ValueChanged<int> onSimsChanged;

  final String? error;
  final bool busy;

  /// Called when the user taps the delete icon on a chip.
  final ValueChanged<String> onUnpick;

  /// Called when the user taps Start (only enabled when picked.length == 4).
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final ready = picked.length == 4 && !busy;
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF111827),
        border: Border(
          top: BorderSide(color: Color(0xFF374151)),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Picked (${picked.length}/4)',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
          if (picked.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final d in picked)
                  Chip(
                    label: Text(d.name),
                    backgroundColor: const Color(0xFF1F2937),
                    labelStyle: const TextStyle(color: Colors.white),
                    deleteIconColor: Colors.white70,
                    onDeleted: busy ? null : () => onUnpick(d.id),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 8),
          Text(
            'Simulations: $sims',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
          Slider(
            value: sims.toDouble().clamp(1, 200),
            min: 1,
            max: 200,
            divisions: 199,
            label: '$sims',
            onChanged: busy ? null : (v) => onSimsChanged(v.round()),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                error!,
                style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
              ),
            ),
          FilledButton(
            onPressed: ready ? onStart : null,
            child: busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Start simulation'),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Run analyzer**

```bash
cd worker_flutter && flutter analyze lib/sims/simulation_controls.dart
```
Expected: `No issues found!`

- [ ] **Step 3: Commit**

```bash
git add worker_flutter/lib/sims/simulation_controls.dart
git commit -m "feat(worker_flutter): add SimulationControls sticky bottom panel"
```

---

## Task 6: `SimulateScreen` (combined entry point) + test

**Files:**
- Create: `worker_flutter/lib/sims/simulate_screen.dart`
- Create: `worker_flutter/test/sims/simulate_screen_test.dart`

The parent screen that wires everything together. Owns the search state, expansion state, pick state, sim count, and busy/error flags. Subscribes to `repo.watchDecks()` via `StreamBuilder`.

- [ ] **Step 1: Write the failing test**

`worker_flutter/test/sims/simulate_screen_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/decks/deck_record.dart';
import 'package:worker_flutter/decks/deck_repo.dart';
import 'package:worker_flutter/sims/simulate_screen.dart';

class _FakeRepo implements DeckRepo {
  _FakeRepo(this.decks);
  final List<DeckRecord> decks;
  @override
  Stream<List<DeckRecord>> watchDecks() => Stream.value(decks);
  @override
  Future<DeckRecord> createFromUrl(String url) => throw UnimplementedError();
  @override
  Future<DeckRecord> createFromText(String text, {String? name, String? link}) =>
      throw UnimplementedError();
  @override
  Future<void> deleteDeck(DeckRecord deck) => throw UnimplementedError();
}

DeckRecord _deck(String id, String name, {bool isPrecon = false, String? commander}) =>
    DeckRecord(
      id: id,
      name: name,
      filename: '$id.dck',
      isPrecon: isPrecon,
      primaryCommander: commander,
    );

void main() {
  testWidgets('renders Custom and Precons section headers with counts',
      (tester) async {
    final repo = _FakeRepo([
      _deck('p1', 'Eldrazi Tribal', isPrecon: true),
      _deck('p2', 'Slivers', isPrecon: true),
      _deck('c1', 'My Atraxa', commander: 'Atraxa'),
    ]);

    await tester.pumpWidget(MaterialApp(
      home: SimulateScreen(
        repo: repo,
        onStart: (_, __) async => '1',
        onJobCreated: (_, __) {},
      ),
    ));
    await tester.pump();

    expect(find.text('Your decks (1)'), findsOneWidget);
    expect(find.text('Precons (2)'), findsOneWidget);
  });

  testWidgets(
      'picking 4 decks enables Start; Start fires onStart with picked decks',
      (tester) async {
    final repo = _FakeRepo([
      for (var i = 0; i < 5; i++) _deck('d$i', 'Deck $i'),
    ]);

    List<DeckRecord>? captured;
    String? jobId;

    await tester.pumpWidget(MaterialApp(
      home: SimulateScreen(
        repo: repo,
        onStart: (decks, n) async {
          captured = decks;
          return 'job-42';
        },
        onJobCreated: (_, id) => jobId = id,
      ),
    ));
    await tester.pump();

    final startBtn = find.widgetWithText(FilledButton, 'Start simulation');
    expect(tester.widget<FilledButton>(startBtn).onPressed, isNull);

    for (var i = 0; i < 4; i++) {
      await tester.tap(find.text('Deck $i'));
      await tester.pump();
    }

    expect(tester.widget<FilledButton>(startBtn).onPressed, isNotNull);

    await tester.tap(startBtn);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(captured?.length, 4);
    expect(jobId, 'job-42');
  });

  testWidgets('search filters across both sections and auto-expands precons',
      (tester) async {
    final repo = _FakeRepo([
      _deck('p1', 'Eldrazi Tribal', isPrecon: true),
      _deck('p2', 'Slivers', isPrecon: true),
      _deck('c1', 'My Atraxa', commander: 'Atraxa'),
    ]);

    await tester.pumpWidget(MaterialApp(
      home: SimulateScreen(
        repo: repo,
        onStart: (_, __) async => '1',
        onJobCreated: (_, __) {},
      ),
    ));
    await tester.pump();

    // Initially: Custom open (My Atraxa visible), Precons closed.
    expect(find.text('My Atraxa'), findsOneWidget);
    expect(find.text('Slivers'), findsNothing);

    // Type a search that matches a precon.
    await tester.enterText(
      find.byKey(const ValueKey('search-field')),
      'sliver',
    );
    await tester.pumpAndSettle();

    expect(find.text('Slivers'), findsOneWidget);
    expect(find.text('Your decks (0)'), findsOneWidget);
    expect(find.text('Precons (1)'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker_flutter && flutter test test/sims/simulate_screen_test.dart
```
Expected: fails — `SimulateScreen` not defined.

- [ ] **Step 3: Write `lib/sims/simulate_screen.dart`**

```dart
import 'package:flutter/material.dart';

import '../decks/deck_record.dart';
import '../decks/deck_repo.dart';
import 'deck_ingest_form.dart';
import 'deck_picker_section.dart';
import 'deck_row.dart';
import 'simulation_controls.dart';

/// Returns the new job's id once the start action succeeds. Cloud
/// mode returns the Firestore doc id; offline mode returns the
/// auto-increment row id stringified.
typedef StartJob =
    Future<String> Function(List<DeckRecord> decks, int simCount);

/// Combined deck-management + simulation-picker screen. Replaces the
/// old `DecksScreen` + `NewSimScreen` + `AddDeckScreen` trio.
class SimulateScreen extends StatefulWidget {
  const SimulateScreen({
    super.key,
    required this.repo,
    required this.onStart,
    required this.onJobCreated,
  });

  final DeckRepo repo;
  final StartJob onStart;

  /// Navigate to the new job's detail screen. Kept as a callback so
  /// cloud mode can push `CloudJobDetailScreen` while offline mode
  /// pushes its own job screen.
  final void Function(BuildContext context, String jobId) onJobCreated;

  @override
  State<SimulateScreen> createState() => _SimulateScreenState();
}

class _SimulateScreenState extends State<SimulateScreen> {
  final _searchCtrl = TextEditingController();
  String _search = '';
  final List<String> _picked = []; // deck ids, insertion order
  int _sims = 10;

  // User-controlled section state, honored only when search is empty.
  bool _customOpen = true;
  bool _preconOpen = false;

  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  bool _matches(DeckRecord d, String q) {
    if (d.name.toLowerCase().contains(q)) return true;
    if (d.primaryCommander?.toLowerCase().contains(q) ?? false) return true;
    if (d.ownerEmail?.toLowerCase().contains(q) ?? false) return true;
    return false;
  }

  void _toggle(String id) {
    setState(() {
      if (_picked.contains(id)) {
        _picked.remove(id);
      } else if (_picked.length < 4) {
        _picked.add(id);
      }
    });
  }

  Future<void> _confirmDelete(DeckRecord deck) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete deck?'),
        content: Text('"${deck.name}" will be removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style:
                TextButton.styleFrom(foregroundColor: const Color(0xFFF87171)),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.repo.deleteDeck(deck);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }

  Future<void> _start(List<DeckRecord> pickedDecks) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final jobId = await widget.onStart(pickedDecks, _sims);
      if (!mounted) return;
      setState(() => _picked.clear());
      widget.onJobCreated(context, jobId);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1F2937),
      body: StreamBuilder<List<DeckRecord>>(
        stream: widget.repo.watchDecks(),
        initialData: const [],
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  "Couldn't load decks: ${snap.error}",
                  style: const TextStyle(color: Colors.white54),
                ),
              ),
            );
          }

          final all = snap.data ?? const <DeckRecord>[];
          final q = _search.trim().toLowerCase();
          final customAll = all.where((d) => !d.isPrecon).toList(growable: false);
          final preconsAll = all.where((d) => d.isPrecon).toList(growable: false);
          final custom = q.isEmpty
              ? customAll
              : customAll.where((d) => _matches(d, q)).toList(growable: false);
          final precons = q.isEmpty
              ? preconsAll
              : preconsAll.where((d) => _matches(d, q)).toList(growable: false);

          // Drop picked ids that no longer resolve (e.g. deck deleted
          // remotely while we held the selection).
          final knownIds = {for (final d in all) d.id};
          final stalePicks = _picked.where((id) => !knownIds.contains(id)).toList();
          if (stalePicks.isNotEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              setState(() {
                for (final id in stalePicks) _picked.remove(id);
              });
            });
          }

          final pickedRecords = [
            for (final id in _picked)
              all.firstWhere((d) => d.id == id, orElse: () => DeckRecord(
                    id: id,
                    name: '?',
                    filename: '',
                    isPrecon: false,
                  )),
          ];

          final searching = q.isNotEmpty;
          final customExpanded = searching ? custom.isNotEmpty : _customOpen;
          final preconExpanded = searching ? precons.isNotEmpty : _preconOpen;

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.only(bottom: 12),
                  children: [
                    DeckIngestForm(
                      repo: widget.repo,
                      onAdded: (name) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Added: $name')),
                        );
                      },
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: Text(
                        'Pick 4 decks (${_picked.length}/4)',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                      child: TextField(
                        key: const ValueKey('search-field'),
                        controller: _searchCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          hintText: 'Search by name or commander',
                          prefixIcon: Icon(Icons.search, color: Colors.white54),
                          isDense: true,
                          filled: true,
                          fillColor: Color(0xFF111827),
                          border:
                              OutlineInputBorder(borderSide: BorderSide.none),
                        ),
                        onChanged: (v) => setState(() => _search = v),
                      ),
                    ),
                    DeckPickerSection(
                      title: 'Your decks',
                      count: custom.length,
                      expanded: customExpanded,
                      onExpansionChanged: (v) {
                        if (!searching) setState(() => _customOpen = v);
                      },
                      emptyText: searching
                          ? 'No custom decks match.'
                          : 'No custom decks yet — add one above.',
                      children: [
                        for (final d in custom)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: DeckRow(
                              name: d.name,
                              colorIdentity: d.colorIdentity ?? const [],
                              subtitle: d.primaryCommander ?? d.ownerEmail,
                              isPrecon: false,
                              pickIndex: _picked.contains(d.id)
                                  ? _picked.indexOf(d.id) + 1
                                  : null,
                              canDelete: true,
                              onTap: () => _toggle(d.id),
                              onDelete: () => _confirmDelete(d),
                            ),
                          ),
                      ],
                    ),
                    DeckPickerSection(
                      title: 'Precons',
                      count: precons.length,
                      expanded: preconExpanded,
                      onExpansionChanged: (v) {
                        if (!searching) setState(() => _preconOpen = v);
                      },
                      emptyText: searching
                          ? 'No precons match.'
                          : 'No precons available.',
                      children: [
                        for (final d in precons)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: DeckRow(
                              name: d.name,
                              colorIdentity: d.colorIdentity ?? const [],
                              subtitle: d.primaryCommander,
                              isPrecon: true,
                              pickIndex: _picked.contains(d.id)
                                  ? _picked.indexOf(d.id) + 1
                                  : null,
                              canDelete: false,
                              onTap: () => _toggle(d.id),
                              onDelete: () {},
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              SimulationControls(
                picked: pickedRecords,
                sims: _sims,
                onSimsChanged: (v) => setState(() => _sims = v),
                error: _error,
                busy: _busy,
                onUnpick: (id) => _toggle(id),
                onStart: () => _start(pickedRecords),
              ),
            ],
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd worker_flutter && flutter test test/sims/simulate_screen_test.dart
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker_flutter/lib/sims/simulate_screen.dart worker_flutter/test/sims/simulate_screen_test.dart
git commit -m "feat(worker_flutter): add SimulateScreen combining deck mgmt and sim picker"
```

---

## Task 7: Wire SimulateScreen into Dashboard (cloud mode)

**Files:**
- Modify: `worker_flutter/lib/ui/dashboard.dart`

Replace the Decks and New tabs with the combined Simulate tab.

- [ ] **Step 1: Update imports**

In `worker_flutter/lib/ui/dashboard.dart`, replace:

```dart
import '../decks/cloud_deck_repo.dart';
import '../decks/deck_repo.dart';
import '../decks/decks_screen.dart';
...
import '../sims/new_sim_screen.dart';
```

with:

```dart
import '../decks/cloud_deck_repo.dart';
import '../decks/deck_repo.dart';
...
import '../sims/simulate_screen.dart';
```

- [ ] **Step 2: Replace tab definitions and bodies**

Change the `DefaultTabController(length: 5, ...)` to `length: 4`. Update the `TabBar`:

```dart
bottom: const TabBar(
  isScrollable: true,
  tabs: [
    Tab(icon: Icon(Icons.memory), text: 'Worker'),
    Tab(icon: Icon(Icons.cloud_queue), text: 'Jobs'),
    Tab(icon: Icon(Icons.leaderboard_outlined), text: 'Leaderboard'),
    Tab(icon: Icon(Icons.play_arrow), text: 'Simulate'),
  ],
  labelColor: Color(0xFF60A5FA),
  unselectedLabelColor: Colors.white70,
  indicatorColor: Color(0xFF60A5FA),
),
```

And replace the last two children of `TabBarView` (Decks + New) with a single Simulate body:

```dart
// Simulate tab — combined deck management + simulation picker.
SimulateScreen(
  repo: _deckRepo,
  onStart: (decks, simCount) async {
    final resp = await _api.postJson('/api/jobs', {
      'deckIds': decks.map((d) => d.id).toList(),
      'simulations': simCount,
    });
    final job = resp['job'];
    if (job is Map && job['id'] != null) {
      return job['id'].toString();
    }
    final id = resp['id']?.toString();
    if (id == null || id.isEmpty) {
      throw StateError(
        'POST /api/jobs returned no job id; '
        'the API response shape may have changed.',
      );
    }
    return id;
  },
  onJobCreated: (ctx, jobId) {
    Navigator.of(ctx).push(
      MaterialPageRoute(
        builder: (_) => CloudJobDetailScreen(jobId: jobId),
      ),
    );
  },
),
```

- [ ] **Step 3: Run analyzer**

```bash
cd worker_flutter && flutter analyze lib/ui/dashboard.dart
```
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add worker_flutter/lib/ui/dashboard.dart
git commit -m "feat(worker_flutter): swap Decks+New tabs for Simulate in cloud Dashboard"
```

---

## Task 8: Wire SimulateScreen into OfflineApp

**Files:**
- Modify: `worker_flutter/lib/offline/offline_app.dart`

Same change for offline mode: drop the Decks + New tabs, add a Simulate tab.

- [ ] **Step 1: Update imports**

Replace:

```dart
import '../decks/decks_screen.dart';
import '../decks/deck_repo.dart';
import '../decks/offline_deck_repo.dart';
...
import '../sims/new_sim_screen.dart';
```

with:

```dart
import '../decks/deck_repo.dart';
import '../decks/offline_deck_repo.dart';
...
import '../sims/simulate_screen.dart';
```

- [ ] **Step 2: Update DefaultTabController length and tabs**

Change `length: 3` to `length: 2`. Update `TabBar`:

```dart
bottom: const TabBar(
  tabs: [
    Tab(icon: Icon(Icons.history), text: 'History'),
    Tab(icon: Icon(Icons.play_arrow), text: 'Simulate'),
  ],
  labelColor: Color(0xFF60A5FA),
  unselectedLabelColor: Colors.white70,
  indicatorColor: Color(0xFF60A5FA),
),
```

Replace the Decks + New tab bodies with a single `SimulateScreen`:

```dart
SimulateScreen(
  repo: _deckRepo,
  onStart: (decks, simCount) async {
    final jobId = await widget.db.createJob(
      deckNames: decks.map((d) => d.name).toList(),
      simCount: simCount,
    );
    unawaited(widget.runner.run(jobId));
    return jobId.toString();
  },
  onJobCreated: (ctx, jobId) {
    final id = int.tryParse(jobId);
    if (id == null) return;
    Navigator.of(ctx).push(
      MaterialPageRoute(
        builder: (_) => _JobScreen(
          db: widget.db,
          runner: widget.runner,
          jobId: id,
        ),
      ),
    );
  },
),
```

- [ ] **Step 3: Run analyzer**

```bash
cd worker_flutter && flutter analyze lib/offline/offline_app.dart
```
Expected: `No issues found!`

- [ ] **Step 4: Commit**

```bash
git add worker_flutter/lib/offline/offline_app.dart
git commit -m "feat(worker_flutter): swap Decks+New tabs for Simulate in OfflineApp"
```

---

## Task 9: Delete superseded files

**Files:**
- Delete: `worker_flutter/lib/decks/decks_screen.dart`
- Delete: `worker_flutter/lib/decks/add_deck_screen.dart`
- Delete: `worker_flutter/lib/sims/new_sim_screen.dart`
- Delete: `worker_flutter/test/sims/new_sim_screen_test.dart`

- [ ] **Step 1: Delete the files**

```bash
rm worker_flutter/lib/decks/decks_screen.dart \
   worker_flutter/lib/decks/add_deck_screen.dart \
   worker_flutter/lib/sims/new_sim_screen.dart \
   worker_flutter/test/sims/new_sim_screen_test.dart
```

- [ ] **Step 2: Run full analyzer**

```bash
cd worker_flutter && flutter analyze
```
Expected: `No issues found!` (no dangling imports anywhere).

- [ ] **Step 3: Run full test suite**

```bash
cd worker_flutter && flutter test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A worker_flutter/lib/decks worker_flutter/lib/sims worker_flutter/test/sims
git commit -m "chore(worker_flutter): remove superseded DecksScreen/AddDeckScreen/NewSimScreen"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run analyzer on the whole worker_flutter package**

```bash
cd worker_flutter && flutter analyze
```
Expected: `No issues found!`

- [ ] **Step 2: Run the full test suite**

```bash
cd worker_flutter && flutter test
```
Expected: all tests pass.

- [ ] **Step 3: (Optional) Sanity-check a build**

```bash
cd worker_flutter && flutter build macos --debug
```
Expected: build succeeds. Skip if a macOS build environment isn't available — analyzer + tests are the gate.

- [ ] **Step 4: Done**

Plan is complete; commits are ready for `/ship-it`.
