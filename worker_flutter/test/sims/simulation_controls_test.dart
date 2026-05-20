import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/decks/deck_record.dart';
import 'package:worker_flutter/sims/simulation_controls.dart';

DeckRecord _deck(String id, String name) =>
    DeckRecord(id: id, name: name, filename: '$id.dck', isPrecon: false);

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('Start disabled with fewer than 4 picks', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SimulationControls(
          picked: [_deck('a', 'A'), _deck('b', 'B'), _deck('c', 'C')],
          sims: 10,
          onSimsChanged: (_) {},
          error: null,
          busy: false,
          onUnpick: (_) {},
          onStart: () {},
        ),
      ),
    );

    final btn = find.widgetWithText(FilledButton, 'Start simulation');
    expect(tester.widget<FilledButton>(btn).onPressed, isNull);
  });

  testWidgets('Start enabled at exactly 4 picks; fires onStart', (
    tester,
  ) async {
    var started = 0;
    await tester.pumpWidget(
      _wrap(
        SimulationControls(
          picked: [
            _deck('a', 'A'),
            _deck('b', 'B'),
            _deck('c', 'C'),
            _deck('d', 'D'),
          ],
          sims: 10,
          onSimsChanged: (_) {},
          error: null,
          busy: false,
          onUnpick: (_) {},
          onStart: () => started += 1,
        ),
      ),
    );

    final btn = find.widgetWithText(FilledButton, 'Start simulation');
    expect(tester.widget<FilledButton>(btn).onPressed, isNotNull);

    await tester.tap(btn);
    expect(started, 1);
  });

  testWidgets('Start disabled while busy even at 4 picks', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SimulationControls(
          picked: [
            _deck('a', 'A'),
            _deck('b', 'B'),
            _deck('c', 'C'),
            _deck('d', 'D'),
          ],
          sims: 10,
          onSimsChanged: (_) {},
          error: null,
          busy: true,
          onUnpick: (_) {},
          onStart: () {},
        ),
      ),
    );

    final btn = find.byType(FilledButton);
    expect(tester.widget<FilledButton>(btn).onPressed, isNull);
  });

  testWidgets('Chip delete icon fires onUnpick with deck id', (tester) async {
    String? unpicked;
    await tester.pumpWidget(
      _wrap(
        SimulationControls(
          picked: [_deck('a', 'Alpha'), _deck('b', 'Beta')],
          sims: 10,
          onSimsChanged: (_) {},
          error: null,
          busy: false,
          onUnpick: (id) => unpicked = id,
          onStart: () {},
        ),
      ),
    );

    // Each Chip has a delete icon; tap the one on the second chip ("Beta").
    final betaChip = find.ancestor(
      of: find.text('Beta'),
      matching: find.byType(Chip),
    );
    final deleteIcon = find.descendant(
      of: betaChip,
      matching: find.byIcon(Icons.cancel),
    );
    expect(deleteIcon, findsOneWidget);
    await tester.tap(deleteIcon);
    expect(unpicked, 'b');
  });

  testWidgets('error text renders when error is non-null', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SimulationControls(
          picked: const [],
          sims: 10,
          onSimsChanged: (_) {},
          error: 'kaboom',
          busy: false,
          onUnpick: (_) {},
          onStart: () {},
        ),
      ),
    );

    expect(find.text('kaboom'), findsOneWidget);
  });
}
