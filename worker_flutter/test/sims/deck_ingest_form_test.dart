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
      id: 'u1',
      name: 'From URL',
      filename: 'u1.dck',
      isPrecon: false,
    );
  }

  @override
  Future<DeckRecord> createFromText(
    String text, {
    String? name,
    String? link,
  }) async {
    lastText = text;
    lastName = name;
    return DeckRecord(
      id: 't1',
      name: name ?? 'From Text',
      filename: 't1.dck',
      isPrecon: false,
    );
  }

  @override
  Future<void> deleteDeck(DeckRecord deck) async {}
}

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('URL submit calls repo.createFromUrl and onAdded', (
    tester,
  ) async {
    final repo = _FakeRepo();
    String? added;

    await tester.pumpWidget(
      _wrap(DeckIngestForm(repo: repo, onAdded: (name) => added = name)),
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'https://moxfield.com/decks/...'),
      'https://moxfield.com/decks/abcd',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Add deck').first);
    await tester.pumpAndSettle();

    expect(repo.lastUrl, 'https://moxfield.com/decks/abcd');
    expect(added, 'From URL');
  });

  testWidgets('paste section toggles open and submits', (tester) async {
    final repo = _FakeRepo();
    String? added;

    await tester.pumpWidget(
      _wrap(DeckIngestForm(repo: repo, onAdded: (name) => added = name)),
    );

    expect(find.byKey(const ValueKey('paste-textarea')), findsNothing);

    await tester.tap(find.text('Or paste a deck list'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('paste-textarea')), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('paste-name')), 'My Deck');
    await tester.enterText(
      find.byKey(const ValueKey('paste-textarea')),
      '1 Sol Ring',
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Add deck').last);
    await tester.pumpAndSettle();

    expect(repo.lastText, '1 Sol Ring');
    expect(repo.lastName, 'My Deck');
    expect(added, 'My Deck');
  });
}
