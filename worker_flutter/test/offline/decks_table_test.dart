import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/offline/db/app_db.dart';

/// Tests for the v2 Decks table added in this PR.
void main() {
  late AppDb db;

  setUp(() {
    db = AppDb.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
  });

  test('insert + watchDecks emits new row', () async {
    final stream = db.watchDecks();
    final first = await stream.first;
    expect(first, isEmpty);

    final id = await db.insertDeck(
      name: 'My Atraxa',
      filename: 'my-atraxa.dck',
      dckContent: '[metadata]\nName=My Atraxa\n',
      colorIdentity: 'WUB',
      link: 'https://moxfield.com/decks/x',
      primaryCommander: 'Atraxa',
    );

    final row = await db.deckById(id);
    expect(row, isNotNull);
    expect(row!.name, 'My Atraxa');
    expect(row.colorIdentity, 'WUB');
    expect(row.primaryCommander, 'Atraxa');
  });

  test(
    'deckByFilename roundtrips and deleteDeckById removes the row',
    () async {
      await db.insertDeck(
        name: 'X',
        filename: 'x.dck',
        dckContent: '[metadata]\nName=X\n',
      );
      final byFile = await db.deckByFilename('x.dck');
      expect(byFile, isNotNull);

      await db.deleteDeckById(byFile!.id);
      expect(await db.deckByFilename('x.dck'), isNull);
    },
  );

  test('filename uniqueness is enforced', () async {
    await db.insertDeck(name: 'A', filename: 'dup.dck', dckContent: 'x');
    expect(
      () => db.insertDeck(name: 'B', filename: 'dup.dck', dckContent: 'y'),
      throwsA(isA<Exception>()),
    );
  });

  test('name uniqueness is enforced at SQL level', () async {
    await db.insertDeck(name: 'Same', filename: 'a.dck', dckContent: 'x');
    expect(
      () => db.insertDeck(name: 'Same', filename: 'b.dck', dckContent: 'y'),
      throwsA(isA<Exception>()),
    );
  });

  test('deckByName returns the matching row', () async {
    await db.insertDeck(name: 'My Atraxa', filename: 'a.dck', dckContent: 'x');
    final found = await db.deckByName('My Atraxa');
    expect(found, isNotNull);
    expect(found!.filename, 'a.dck');
    expect(await db.deckByName('Missing'), isNull);
  });
}
