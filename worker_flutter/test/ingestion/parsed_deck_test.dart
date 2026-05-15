import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/ingestion/parsed_deck.dart';

void main() {
  group('toDck', () {
    test('emits Forge metadata, commander, and main sections', () {
      final deck = ParsedDeck(
        name: 'Atraxa Test',
        commanders: [DeckCard(name: 'Atraxa, Praetors\' Voice', quantity: 1)],
        mainboard: [
          DeckCard(name: 'Sol Ring', quantity: 1),
          DeckCard(name: 'Command Tower', quantity: 1),
        ],
      );
      final out = toDck(deck);
      expect(out, contains('[metadata]'));
      expect(out, contains('Name=Atraxa Test'));
      expect(out, contains('Format=Commander'));
      expect(out, contains('[commander]'));
      expect(out, contains("1 Atraxa, Praetors' Voice"));
      expect(out, contains('[main]'));
      expect(out, contains('1 Sol Ring'));
    });

    test('strips control characters from deck and card names', () {
      final deck = ParsedDeck(
        name: 'Bad\nName',
        commanders: [DeckCard(name: 'Card\r\nname', quantity: 1)],
        mainboard: const [],
      );
      final out = toDck(deck);
      expect(out, contains('Name=Bad Name'));
      expect(out, contains('1 Card name'));
      expect(out, isNot(contains('\r')));
    });

    test('emits Name|SET when setCode is provided', () {
      final deck = ParsedDeck(
        name: 'd',
        commanders: const [],
        mainboard: [DeckCard(name: 'Sol Ring', quantity: 1, setCode: 'cmm')],
      );
      expect(toDck(deck), contains('1 Sol Ring|CMM'));
    });

    test('emits Name|SET|Number when both are provided', () {
      final deck = ParsedDeck(
        name: 'd',
        commanders: const [],
        mainboard: [
          DeckCard(
            name: 'Sol Ring',
            quantity: 1,
            setCode: 'cmm',
            collectorNumber: '345',
          ),
        ],
      );
      expect(toDck(deck), contains('1 Sol Ring|CMM|345'));
    });

    test('strips Name|SET pipe notation from input names', () {
      final deck = ParsedDeck(
        name: 'd',
        commanders: const [],
        mainboard: [DeckCard(name: 'Galadriel|LTC|1', quantity: 1)],
      );
      final out = toDck(deck);
      expect(out, contains('1 Galadriel'));
      expect(out, isNot(contains('|LTC')));
    });
  });
}
