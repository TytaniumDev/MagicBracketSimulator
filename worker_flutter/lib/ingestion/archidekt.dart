import 'dart:convert';

import 'package:http/http.dart' as http;

import 'parsed_deck.dart';

/// Archidekt deck fetcher. Port of `api/lib/ingestion/archidekt.ts`.
class ArchidektClient {
  ArchidektClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  static const _kBase = 'https://archidekt.com/api';

  Future<ParsedDeck> fetchByUrl(String url) async {
    final id = extractArchidektDeckId(url);
    if (id == null) throw FormatException('Invalid Archidekt URL: $url');
    return fetchByDeckId(id);
  }

  Future<ParsedDeck> fetchByDeckId(String deckId) async {
    final resp = await _http.get(
      Uri.parse('$_kBase/decks/$deckId/'),
      headers: {'Accept': 'application/json'},
    );
    if (resp.statusCode != 200) {
      if (resp.statusCode == 404) {
        throw StateError('Deck not found: $deckId');
      }
      if (resp.statusCode == 403) {
        throw StateError('Deck is private or not accessible: $deckId');
      }
      throw StateError(
        'Failed to fetch Archidekt deck: HTTP ${resp.statusCode}',
      );
    }
    final data = json.decode(resp.body) as Map<String, dynamic>;
    final cards = (data['cards'] as List?) ?? const [];

    final commanders = <DeckCard>[];
    final mainboard = <DeckCard>[];

    for (final entry in cards) {
      if (entry is! Map) continue;
      final card = (entry['card'] as Map?) ?? const {};
      final oracle = (card['oracleCard'] as Map?) ?? const {};
      final name = oracle['name'] as String?;
      if (name == null || name.isEmpty) continue;
      final qty = (entry['quantity'] as num?)?.toInt() ?? 1;
      final categories =
          (entry['categories'] as List?)
              ?.whereType<String>()
              .map((c) => c.toLowerCase())
              .toSet() ??
          const <String>{};
      final isCommander =
          categories.contains('commander') || categories.contains('commanders');
      final edition = (card['edition'] as Map?) ?? const {};
      final deckCard = DeckCard(
        name: name,
        quantity: qty,
        isCommander: isCommander,
        setCode: (edition['editioncode'] as String?)?.trim().isEmpty == false
            ? edition['editioncode'] as String
            : null,
        collectorNumber:
            (card['collectorNumber'] as String?)?.trim().isEmpty == false
            ? card['collectorNumber'] as String
            : null,
      );
      if (isCommander) {
        commanders.add(deckCard);
      } else {
        mainboard.add(deckCard);
      }
    }

    return ParsedDeck(
      name: (data['name'] as String?) ?? 'Imported Archidekt Deck',
      commanders: commanders,
      mainboard: mainboard,
    );
  }
}

bool isArchidektUrl(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return false;
  if (p.scheme != 'http' && p.scheme != 'https') return false;
  if (p.host != 'archidekt.com' && p.host != 'www.archidekt.com') return false;
  return RegExp(r'^/decks/(\d+)').hasMatch(p.path);
}

String? extractArchidektDeckId(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return null;
  if (p.scheme != 'http' && p.scheme != 'https') return null;
  if (p.host != 'archidekt.com' && p.host != 'www.archidekt.com') return null;
  final m = RegExp(r'^/decks/(\d+)').firstMatch(p.path);
  return m?.group(1);
}
