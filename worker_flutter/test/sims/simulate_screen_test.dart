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
  Future<DeckRecord> createFromText(
    String text, {
    String? name,
    String? link,
  }) => throw UnimplementedError();

  @override
  Future<void> deleteDeck(DeckRecord deck) => throw UnimplementedError();
}

DeckRecord _deck(
  String id,
  String name, {
  bool isPrecon = false,
  String? commander,
}) => DeckRecord(
  id: id,
  name: name,
  filename: '$id.dck',
  isPrecon: isPrecon,
  primaryCommander: commander,
);

void main() {
  testWidgets('renders Custom and Precons section headers with counts', (
    tester,
  ) async {
    final repo = _FakeRepo([
      _deck('p1', 'Eldrazi Tribal', isPrecon: true),
      _deck('p2', 'Slivers', isPrecon: true),
      _deck('c1', 'My Atraxa', commander: 'Atraxa'),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: SimulateScreen(
          repo: repo,
          onStart: (_, _) async => '1',
          onJobCreated: (_, _) {},
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Your decks (1)'), findsOneWidget);
    expect(find.text('Precons (2)'), findsOneWidget);
  });

  testWidgets(
    'picking 4 decks enables Start; Start fires onStart with picked decks',
    (tester) async {
      // Tall viewport so all 5 decks + the bottom panel render without
      // overlapping. With the default 800x600 the Slider sits on top of
      // the second/third deck rows and intercepts taps.
      tester.view.physicalSize = const Size(1200, 1600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final repo = _FakeRepo([
        for (var i = 0; i < 5; i++) _deck('d$i', 'Deck $i'),
      ]);

      List<DeckRecord>? captured;
      String? jobId;

      await tester.pumpWidget(
        MaterialApp(
          home: SimulateScreen(
            repo: repo,
            onStart: (decks, n) async {
              captured = decks;
              return 'job-42';
            },
            onJobCreated: (_, id) => jobId = id,
          ),
        ),
      );
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
    },
  );

  testWidgets('search filters across both sections and auto-expands precons', (
    tester,
  ) async {
    final repo = _FakeRepo([
      _deck('p1', 'Eldrazi Tribal', isPrecon: true),
      _deck('p2', 'Slivers', isPrecon: true),
      _deck('c1', 'My Atraxa', commander: 'Atraxa'),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: SimulateScreen(
          repo: repo,
          onStart: (_, _) async => '1',
          onJobCreated: (_, _) {},
        ),
      ),
    );
    await tester.pump();

    expect(find.text('My Atraxa'), findsOneWidget);
    expect(find.text('Slivers'), findsNothing);

    await tester.enterText(
      find.byKey(const ValueKey('search-field')),
      'sliver',
    );
    await tester.pumpAndSettle();

    expect(find.text('Slivers'), findsOneWidget);
    expect(find.text('Your decks (0)'), findsOneWidget);
    expect(find.text('Precons (1)'), findsOneWidget);
  });

  testWidgets('tapping a 5th deck does not exceed the 4-pick cap', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final repo = _FakeRepo([
      for (var i = 0; i < 5; i++) _deck('d$i', 'Deck $i'),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: SimulateScreen(
          repo: repo,
          onStart: (_, _) async => '1',
          onJobCreated: (_, _) {},
        ),
      ),
    );
    await tester.pump();

    for (var i = 0; i < 4; i++) {
      await tester.tap(find.text('Deck $i'));
      await tester.pump();
    }
    expect(find.text('Pick 4 decks (4/4)'), findsOneWidget);

    // 5th tap: should be a no-op (no badge appears on Deck 4, count
    // stays at 4/4).
    await tester.tap(find.text('Deck 4'));
    await tester.pump();
    expect(find.text('Pick 4 decks (4/4)'), findsOneWidget);
    // Pick badges are 1..4 inclusive; "5" must not appear.
    expect(find.text('5'), findsNothing);
  });
}
