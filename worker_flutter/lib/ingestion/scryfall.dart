import 'dart:convert';

import 'package:http/http.dart' as http;

/// Batch color-identity lookup against Scryfall.
///
/// Uses `POST /cards/collection` (75 cards per call) — the same hot
/// path the API uses for new deck creation. Failures collapse to an
/// empty list; we return *just* the union of color identities seen
/// across every commander we resolved. Callers store this on the deck
/// row alongside ingestion results.
class ScryfallClient {
  ScryfallClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  static const _kBase = 'https://api.scryfall.com';
  static const _kBatch = 75;

  /// Resolve the union of color identities for the given card names.
  /// Empty list on any failure — color identity is a nice-to-have on
  /// the deck record, not a correctness requirement.
  Future<List<String>> colorIdentityForCards(List<String> names) async {
    if (names.isEmpty) return const [];
    final cleaned = <String>{
      for (final raw in names)
        if (raw.trim().isNotEmpty) _stripPipe(raw.trim()),
    }.toList();

    final identities = <String>{};
    for (var i = 0; i < cleaned.length; i += _kBatch) {
      final batch = cleaned.sublist(
        i,
        i + _kBatch > cleaned.length ? cleaned.length : i + _kBatch,
      );
      final body = json.encode({
        'identifiers': [
          for (final n in batch) {'name': n},
        ],
      });
      http.Response resp;
      try {
        resp = await _http.post(
          Uri.parse('$_kBase/cards/collection'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent':
                'MagicBracketSimulator (https://github.com/TytaniumDev/MagicBracketSimulator)',
          },
          body: body,
        );
      } catch (_) {
        return const [];
      }
      if (resp.statusCode != 200) return const [];
      final decoded = json.decode(resp.body);
      if (decoded is! Map) continue;
      final cards = decoded['data'];
      if (cards is! List) continue;
      for (final card in cards.whereType<Map>()) {
        final ci = card['color_identity'];
        if (ci is List) {
          for (final c in ci.whereType<String>()) {
            identities.add(c);
          }
        }
      }
    }
    // Sort by canonical WUBRG order for stable storage.
    const order = ['W', 'U', 'B', 'R', 'G'];
    return order.where(identities.contains).toList(growable: false);
  }

  String _stripPipe(String name) {
    final i = name.indexOf('|');
    return (i == -1 ? name : name.substring(0, i)).trim();
  }
}
