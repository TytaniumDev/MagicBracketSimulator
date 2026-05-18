import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/ingestion/ingestion.dart';

void main() {
  group('isMoxfieldUrl', () {
    test('accepts https moxfield.com/decks URLs', () {
      expect(isMoxfieldUrl('https://moxfield.com/decks/abc-123'), isTrue);
      expect(isMoxfieldUrl('https://www.moxfield.com/decks/abc'), isTrue);
    });
    test('rejects unrelated URLs', () {
      expect(isMoxfieldUrl('https://google.com'), isFalse);
      expect(isMoxfieldUrl('not a url'), isFalse);
    });
    test('extractMoxfieldDeckId returns the slug', () {
      expect(
        extractMoxfieldDeckId('https://moxfield.com/decks/abc-123/foo'),
        'abc-123',
      );
    });
  });

  group('isArchidektUrl', () {
    test('accepts numeric deck ids', () {
      expect(isArchidektUrl('https://archidekt.com/decks/12345'), isTrue);
      expect(
        isArchidektUrl('https://www.archidekt.com/decks/12345/name'),
        isTrue,
      );
    });
    test('extractArchidektDeckId returns id', () {
      expect(extractArchidektDeckId('https://archidekt.com/decks/789'), '789');
    });
  });

  group('isManaboxUrl', () {
    test('accepts manabox deck URLs', () {
      expect(
        isManaboxUrl('https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA'),
        isTrue,
      );
    });
  });

  group('isManaPoolUrl', () {
    test('accepts UUID-style list URLs', () {
      expect(
        isManaPoolUrl(
          'https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5',
        ),
        isTrue,
      );
    });
    test('extractManaPoolListId returns the UUID', () {
      expect(
        extractManaPoolListId(
          'https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5?ref=x',
        ),
        '5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5',
      );
    });
  });

  group('isSupportedDeckUrl', () {
    test('accepts any of the four providers', () {
      expect(isSupportedDeckUrl('https://moxfield.com/decks/x'), isTrue);
      expect(isSupportedDeckUrl('https://archidekt.com/decks/1'), isTrue);
      expect(isSupportedDeckUrl('https://manabox.app/decks/x'), isTrue);
      expect(
        isSupportedDeckUrl(
          'https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5',
        ),
        isTrue,
      );
    });
    test('rejects bare URLs', () {
      expect(isSupportedDeckUrl('https://google.com'), isFalse);
    });
  });
}
