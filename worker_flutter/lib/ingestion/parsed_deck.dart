/// Result of parsing a deck from any source (Moxfield, Archidekt,
/// ManaBox, ManaPool, raw text). Mirrors the TS `ParsedDeck` shape in
/// `api/lib/ingestion/to-dck.ts` so the two implementations stay
/// portable.
class ParsedDeck {
  ParsedDeck({
    required this.name,
    required this.commanders,
    required this.mainboard,
  });

  final String name;
  final List<DeckCard> commanders;
  final List<DeckCard> mainboard;
}

class DeckCard {
  DeckCard({
    required this.name,
    required this.quantity,
    this.isCommander = false,
    this.setCode,
    this.collectorNumber,
  });

  final String name;
  final int quantity;
  final bool isCommander;
  final String? setCode;
  final String? collectorNumber;
}

/// Convert a [ParsedDeck] to Forge `.dck` text.
///
/// Layout:
///   [metadata]
///   `Name=<deck name>`
///   `Format=Commander`
///   `[commander]`
///   `<qty> <card>`
///   ...
///   `[main]`
///   `<qty> <card>`
///   ...
///
/// Card line uses `Name|SET|CollectorNumber` when set code is known
/// (improves Forge's set matching), otherwise just `Name`.
String toDck(ParsedDeck deck) {
  final lines = <String>[];
  lines.add('[metadata]');
  lines.add('Name=${_cleanDeckName(deck.name)}');
  lines.add('Format=Commander');
  lines.add('[commander]');
  for (final c in deck.commanders) {
    lines.add('${c.quantity} ${_formatCardEntry(c)}');
  }
  lines.add('[main]');
  for (final c in deck.mainboard) {
    lines.add('${c.quantity} ${_formatCardEntry(c)}');
  }
  return lines.join('\n');
}

String _formatCardEntry(DeckCard card) {
  final name = _cleanCardName(card.name);
  final set = card.setCode?.toUpperCase();
  if (set == null || set.isEmpty) return name;
  final num = card.collectorNumber;
  return (num == null || num.isEmpty) ? '$name|$set' : '$name|$set|$num';
}

final _controlChars = RegExp(r'[\r\n\x00-\x1F\x7F]+');

String _cleanDeckName(String s) => s.replaceAll(_controlChars, ' ').trim();

String _cleanCardName(String name) {
  // Strip "Name|SET" pipe notation; Forge expects bare names when no
  // set code is asserted by us.
  final pipe = name.indexOf('|');
  final base = pipe == -1 ? name : name.substring(0, pipe);
  return base.replaceAll(_controlChars, ' ').trim();
}
