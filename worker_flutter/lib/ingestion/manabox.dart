import 'package:http/http.dart' as http;

import 'parsed_deck.dart';

/// ManaBox HTML-scraping fetcher. ManaBox has no public API, so we
/// pull the deck page and parse the embedded Astro Islands hydration
/// payload. Card entries appear as:
///   "name":[0,"Card Name"],"quantity":[0,N],"boardCategory":[0,X]
/// where boardCategory: 0=commander, 3=mainboard, 4=sideboard, 5=maybe.
class ManaBoxClient {
  ManaBoxClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;

  Future<ParsedDeck> fetchByUrl(String url) async {
    final id = extractManaboxDeckId(url);
    if (id == null) throw FormatException('Invalid ManaBox URL: $url');
    final resp = await _http.get(
      Uri.parse('https://manabox.app/decks/$id'),
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'MagicBracketSimulator/1.0',
      },
    );
    if (resp.statusCode != 200) {
      if (resp.statusCode == 404) {
        throw StateError('Deck not found: $id');
      }
      throw StateError('Failed to fetch ManaBox deck: HTTP ${resp.statusCode}');
    }
    final html = resp.body;
    final name =
        RegExp(r'<title>([^<]+)</title>').firstMatch(html)?.group(1)?.trim() ??
        'Imported ManaBox Deck';

    final normalized = html.replaceAll('&quot;', '"').replaceAll('&#39;', "'");
    final pattern = RegExp(
      r'"name":\[0,"([^"]+)"\],"quantity":\[0,(\d+)\],"boardCategory":\[0,(\d+)\]',
    );

    // ManaBox hydration emits the same card multiple times; aggregate
    // quantities before turning them into DeckCards.
    final cmdrTotals = <String, int>{};
    final mainTotals = <String, int>{};
    for (final m in pattern.allMatches(normalized)) {
      final cardName = m.group(1)!;
      final qty = int.tryParse(m.group(2)!) ?? 0;
      final cat = int.tryParse(m.group(3)!) ?? -1;
      if (cat == 0) {
        cmdrTotals[cardName] = (cmdrTotals[cardName] ?? 0) + qty;
      } else if (cat == 3) {
        mainTotals[cardName] = (mainTotals[cardName] ?? 0) + qty;
      }
    }

    final commanders = [
      for (final e in cmdrTotals.entries)
        DeckCard(name: e.key, quantity: e.value, isCommander: true),
    ];
    final mainboard = [
      for (final e in mainTotals.entries)
        DeckCard(name: e.key, quantity: e.value),
    ];

    if (commanders.isEmpty && mainboard.isEmpty) {
      throw StateError('Could not parse deck data from ManaBox: $id');
    }

    return ParsedDeck(name: name, commanders: commanders, mainboard: mainboard);
  }
}

bool isManaboxUrl(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return false;
  if (p.scheme != 'http' && p.scheme != 'https') return false;
  if (p.host != 'manabox.app' && p.host != 'www.manabox.app') return false;
  return RegExp(r'^/decks/([a-zA-Z0-9_-]+)').hasMatch(p.path);
}

String? extractManaboxDeckId(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return null;
  if (p.scheme != 'http' && p.scheme != 'https') return null;
  if (p.host != 'manabox.app' && p.host != 'www.manabox.app') return null;
  final m = RegExp(r'^/decks/([a-zA-Z0-9_-]+)').firstMatch(p.path);
  return m?.group(1);
}
