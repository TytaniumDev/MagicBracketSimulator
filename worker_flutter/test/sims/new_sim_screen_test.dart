import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/decks/deck_record.dart';
import 'package:worker_flutter/decks/deck_repo.dart';
import 'package:worker_flutter/sims/new_sim_screen.dart';

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

void main() {
  testWidgets(
    'Start button enables only after picking 4 decks; fires onStart',
    (tester) async {
      final repo = _FakeRepo([
        for (var i = 0; i < 5; i++)
          DeckRecord(
            id: 'd$i',
            name: 'Deck $i',
            filename: 'deck-$i.dck',
            isPrecon: false,
          ),
      ]);

      List<DeckRecord>? captured;
      int? capturedSimCount;
      String? newJobId;

      await tester.pumpWidget(
        MaterialApp(
          home: NewSimScreen(
            repo: repo,
            onStart: (decks, n) async {
              captured = decks;
              capturedSimCount = n;
              return '42';
            },
            onJobCreated: (_, jobId) => newJobId = jobId,
          ),
        ),
      );
      await tester.pump(); // resolve the watchDecks stream

      // Disabled initially.
      final findStart = find.widgetWithText(FilledButton, 'Start simulation');
      expect(findStart, findsOneWidget);
      expect(tester.widget<FilledButton>(findStart).onPressed, isNull);

      // Pick four decks.
      for (var i = 0; i < 4; i++) {
        await tester.tap(find.text('Deck $i'));
        await tester.pump();
      }

      expect(tester.widget<FilledButton>(findStart).onPressed, isNotNull);

      await tester.tap(findStart);
      await tester.pump(); // start
      await tester.pump(const Duration(milliseconds: 50)); // await async

      expect(captured, isNotNull);
      expect(captured!.length, 4);
      expect(capturedSimCount, 10); // default
      expect(newJobId, '42');
    },
  );
}
