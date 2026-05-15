import 'dart:convert';

import 'package:http/http.dart' as http;

import 'parsed_deck.dart';

/// Moxfield deck fetcher. Port of `api/lib/ingestion/moxfield.ts` plus
/// a built-in 1-req/sec rate limiter (the TS version lives in
/// `moxfield-service.ts`).
///
/// Moxfield requires every API caller to identify themselves via the
/// User-Agent header. We default to `MagicBracketSimulator-Worker/0.1`
/// but accept an override so users (or test stubs) can supply their
/// own.
class MoxfieldClient {
  MoxfieldClient({http.Client? client, String? userAgent})
    : _http = client ?? http.Client(),
      _userAgent = userAgent ?? 'MagicBracketSimulator-Worker/0.1';

  final http.Client _http;
  final String _userAgent;
  static const _kBase = 'https://api2.moxfield.com/v3';
  static const _kMinIntervalMs = 1000;
  static DateTime _lastRequest = DateTime.fromMillisecondsSinceEpoch(0);

  Future<ParsedDeck> fetchByUrl(String url) async {
    final id = extractMoxfieldDeckId(url);
    if (id == null) throw FormatException('Invalid Moxfield URL: $url');
    return fetchByDeckId(id);
  }

  Future<ParsedDeck> fetchByDeckId(String deckId) async {
    await _throttle();
    final uri = Uri.parse('$_kBase/decks/all/$deckId');
    final resp = await _http.get(
      uri,
      headers: {'Accept': 'application/json', 'User-Agent': _userAgent},
    );
    if (resp.statusCode != 200) {
      if (resp.statusCode == 404) {
        throw StateError('Deck not found: $deckId');
      }
      if (resp.statusCode == 429) {
        throw StateError('Moxfield rate limit exceeded. Try again later.');
      }
      throw StateError(
        'Failed to fetch Moxfield deck: HTTP ${resp.statusCode}',
      );
    }
    final data = json.decode(resp.body) as Map<String, dynamic>;
    final boards =
        (data['boards'] as Map?)?.cast<String, dynamic>() ?? const {};

    final commanders = <DeckCard>[
      ..._boardCards(boards['commanders'], isCommander: true),
      ..._boardCards(boards['companions'], isCommander: true),
    ];
    final mainboard = _boardCards(boards['mainboard'], isCommander: false);

    return ParsedDeck(
      name: (data['name'] as String?) ?? 'Imported Moxfield Deck',
      commanders: commanders,
      mainboard: mainboard,
    );
  }

  Future<void> _throttle() async {
    final elapsed = DateTime.now().difference(_lastRequest).inMilliseconds;
    if (elapsed < _kMinIntervalMs) {
      await Future<void>.delayed(
        Duration(milliseconds: _kMinIntervalMs - elapsed),
      );
    }
    _lastRequest = DateTime.now();
  }

  List<DeckCard> _boardCards(dynamic raw, {required bool isCommander}) {
    if (raw is! Map) return const [];
    final cards = raw['cards'];
    if (cards is! Map) return const [];
    return cards.values
        .whereType<Map>()
        .map((entry) {
          final card = (entry['card'] as Map?) ?? const {};
          return DeckCard(
            name: (card['name'] as String?) ?? '',
            quantity: (entry['quantity'] as num?)?.toInt() ?? 1,
            isCommander: isCommander,
          );
        })
        .where((c) => c.name.isNotEmpty)
        .toList(growable: false);
  }
}

bool isMoxfieldUrl(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return false;
  if (p.scheme != 'http' && p.scheme != 'https') return false;
  if (p.host != 'moxfield.com' && p.host != 'www.moxfield.com') return false;
  return RegExp(r'^/decks/([a-zA-Z0-9_-]+)').hasMatch(p.path);
}

String? extractMoxfieldDeckId(String url) {
  final p = Uri.tryParse(url);
  if (p == null) return null;
  if (p.scheme != 'http' && p.scheme != 'https') return null;
  if (p.host != 'moxfield.com' && p.host != 'www.moxfield.com') return null;
  final m = RegExp(r'^/decks/([a-zA-Z0-9_-]+)').firstMatch(p.path);
  return m?.group(1);
}
