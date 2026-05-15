import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/ingestion/text_parser.dart';

void main() {
  group('parseTextDeck', () {
    test('reads "N Card" lines into the mainboard', () {
      final deck = parseTextDeck('1 Sol Ring\n2 Arcane Signet');
      expect(deck.mainboard, hasLength(2));
      expect(deck.mainboard[0].name, 'Sol Ring');
      expect(deck.mainboard[0].quantity, 1);
      expect(deck.mainboard[1].quantity, 2);
    });

    test('handles "Nx Card" and bare names', () {
      final deck = parseTextDeck('1x Sol Ring\nLightning Bolt');
      expect(deck.mainboard, hasLength(2));
      expect(deck.mainboard[1].quantity, 1);
      expect(deck.mainboard[1].name, 'Lightning Bolt');
    });

    test('strips trailing (SET) and [SET] annotations', () {
      final deck = parseTextDeck('1 Sol Ring (2XM)\n1 Sol Ring [CMM]');
      for (final c in deck.mainboard) {
        expect(c.name, 'Sol Ring');
      }
    });

    test('recognizes [commander] section headers', () {
      final deck = parseTextDeck('[commander]\n1 Atraxa\n[main]\n1 Sol Ring');
      expect(deck.commanders, hasLength(1));
      expect(deck.commanders.first.name, 'Atraxa');
      expect(deck.commanders.first.isCommander, isTrue);
      expect(deck.mainboard.first.name, 'Sol Ring');
    });

    test('Moxfield MTGO format: commander after final blank line', () {
      // 1 main card, blank line, then a single trailing commander line.
      final deck = parseTextDeck('1 Sol Ring\n\n1 Atraxa');
      expect(deck.commanders, hasLength(1));
      expect(deck.commanders.first.name, 'Atraxa');
      expect(deck.mainboard, hasLength(1));
      expect(deck.mainboard.first.name, 'Sol Ring');
    });

    test('"Commander: X" inline prefix flags the card as commander', () {
      final deck = parseTextDeck('Commander: Atraxa\n1 Sol Ring');
      expect(deck.commanders, hasLength(1));
      expect(deck.commanders.first.name, 'Atraxa');
    });

    test('skips // and # comment lines', () {
      final deck = parseTextDeck('// header\n# also a comment\n1 Sol Ring');
      expect(deck.mainboard, hasLength(1));
    });
  });

  group('extractDeckName', () {
    test('matches "Deck: <name>"', () {
      expect(extractDeckName('Deck: My Atraxa\n1 Sol Ring'), 'My Atraxa');
    });

    test('matches "Name=<name>"', () {
      expect(extractDeckName('Name=Cool Deck'), 'Cool Deck');
    });

    test('returns null when no header line', () {
      expect(extractDeckName('1 Sol Ring'), isNull);
    });
  });
}
