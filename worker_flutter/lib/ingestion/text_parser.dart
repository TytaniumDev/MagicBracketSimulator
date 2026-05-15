import 'parsed_deck.dart';

/// Parse a plain-text deck list. Port of `api/lib/ingestion/text-parser.ts`.
///
/// Supported formats:
///   `1 Sol Ring`, `1x Sol Ring`, `Sol Ring`
///   `1 Sol Ring (2XM)` / `1 Sol Ring [2XM]` (set code stripped)
///
/// Sections:
///   `[commander]`, `[main]`, `COMMANDER:`, `MAINBOARD:`, `SIDEBOARD:`
///
/// Moxfield MTGO format: commander appears at the end of the list,
/// separated by a blank line. With sideboard: mainboard, `SIDEBOARD:`,
/// sideboard cards, blank, commander(s). Without: mainboard, blank,
/// commander(s).
ParsedDeck parseTextDeck(String text, {String deckName = 'Imported Deck'}) {
  final lines = text.split(RegExp(r'\r?\n'));
  final commanders = <DeckCard>[];
  final mainboard = <DeckCard>[];
  // Tracks cards seen after the most recent blank line, the Moxfield
  // MTGO commander location. Reset on each new blank so only the LAST
  // post-blank group is considered.
  var cardsAfterLastBlank = <DeckCard>[];

  var currentSection = _Section.main;
  var sawBlankInCurrentSection = false;
  var hasSideboard = false;

  for (var raw in lines) {
    var line = raw.trim();

    if (line.isEmpty) {
      if (currentSection != _Section.commander) {
        sawBlankInCurrentSection = true;
        cardsAfterLastBlank = [];
      }
      continue;
    }

    if (line.startsWith('//') || line.startsWith('#')) continue;

    final sectionMatch = RegExp(
      r'^\[?(commander|commanders|main|mainboard|deck|sideboard)\]?:?$',
      caseSensitive: false,
    ).firstMatch(line);
    if (sectionMatch != null) {
      final section = sectionMatch.group(1)!.toLowerCase();
      if (section == 'commander' || section == 'commanders') {
        currentSection = _Section.commander;
      } else if (section == 'sideboard') {
        currentSection = _Section.sideboard;
        hasSideboard = true;
        sawBlankInCurrentSection = false;
        cardsAfterLastBlank = [];
      } else {
        currentSection = _Section.main;
      }
      continue;
    }

    final commanderPrefix =
        RegExp(r'^\*?cmdr\*?:?\s*', caseSensitive: false).firstMatch(line) ??
        RegExp(r'^commander:?\s+', caseSensitive: false).firstMatch(line);
    if (commanderPrefix != null) {
      final rest = line.substring(commanderPrefix.end);
      final card = _parseCardLine(rest);
      if (card != null) commanders.add(card.asCommander());
      continue;
    }

    final cmdrSuffix = RegExp(
      r'\s*\*CMDR\*\s*$',
      caseSensitive: false,
    ).firstMatch(line);
    if (cmdrSuffix != null) {
      final stripped = line.substring(0, cmdrSuffix.start);
      final card = _parseCardLine(stripped);
      if (card != null) commanders.add(card.asCommander());
      continue;
    }

    final card = _parseCardLine(line);
    if (card == null) continue;
    switch (currentSection) {
      case _Section.commander:
        commanders.add(card.asCommander());
      case _Section.sideboard:
        if (sawBlankInCurrentSection) {
          cardsAfterLastBlank.add(card);
        }
      // Sideboard cards are dropped for Commander format.
      case _Section.main:
        if (sawBlankInCurrentSection && !hasSideboard) {
          cardsAfterLastBlank.add(card);
        } else {
          mainboard.add(card);
        }
    }
  }

  // Moxfield MTGO commander rescue: 1-2 cards after the final blank
  // line and no explicit commanders → treat those as commanders.
  if (commanders.isEmpty &&
      cardsAfterLastBlank.isNotEmpty &&
      cardsAfterLastBlank.length <= 2) {
    for (final c in cardsAfterLastBlank) {
      commanders.add(c.asCommander());
    }
  } else {
    mainboard.addAll(cardsAfterLastBlank);
  }

  return ParsedDeck(
    name: deckName,
    commanders: commanders,
    mainboard: mainboard,
  );
}

/// Try to extract a deck name from the text — looks for `Deck: <name>`
/// or `Name=<name>` headers (case-insensitive).
String? extractDeckName(String text) {
  for (final raw in text.split(RegExp(r'\r?\n'))) {
    final line = raw.trim();
    final deckMatch = RegExp(
      r'^deck:?\s+(.+)$',
      caseSensitive: false,
    ).firstMatch(line);
    if (deckMatch != null) return deckMatch.group(1)!.trim();
    final nameMatch = RegExp(
      r'^name\s*=\s*(.+)$',
      caseSensitive: false,
    ).firstMatch(line);
    if (nameMatch != null) return nameMatch.group(1)!.trim();
  }
  return null;
}

ParsedDeck parseTextDeckWithAutoName(String text) {
  final name = extractDeckName(text) ?? 'Imported Deck';
  return parseTextDeck(text, deckName: name);
}

enum _Section { commander, main, sideboard }

DeckCard? _parseCardLine(String input) {
  var line = input.trim();
  if (line.isEmpty) return null;
  // Strip trailing `(SET)` or `[SET]` set-code annotation.
  line = line.replaceAll(RegExp(r'\s*[(\[][\w\d]+[)\]]\s*$'), '');
  final qty = RegExp(
    r'^(\d+)x?\s+(.+)$',
    caseSensitive: false,
  ).firstMatch(line);
  if (qty != null) {
    final n = int.tryParse(qty.group(1)!) ?? 1;
    final name = qty.group(2)!.trim();
    if (name.isEmpty) return null;
    return DeckCard(name: name, quantity: n);
  }
  return DeckCard(name: line, quantity: 1);
}

extension on DeckCard {
  DeckCard asCommander() => DeckCard(
    name: name,
    quantity: quantity,
    isCommander: true,
    setCode: setCode,
    collectorNumber: collectorNumber,
  );
}
