import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'parsed_deck.dart';

/// ManaPool deck fetcher. Port of `api/lib/ingestion/manapool.ts`.
///
/// ManaPool has no public API; we hit SvelteKit's internal
/// `__data.json` endpoint and unpack its "devalue" format (an array
/// where slot 0 is a shape object mapping field name → index into the
/// same array). The TS version's `dv`/`isDevalueShape` helpers translate
/// directly.
class ManaPoolClient {
  ManaPoolClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  static const _kHint =
      'ManaPool may have changed their internal data format. Try pasting your deck list as text instead, or report this issue.';
  static final _kUrl = RegExp(
    r'^https?://(?:www\.)?manapool\.com/lists/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    caseSensitive: false,
  );

  Future<ParsedDeck> fetchByUrl(String url) async {
    final id = extractManaPoolListId(url);
    if (id == null) throw FormatException('Invalid ManaPool URL: $url');
    final dataUrl = 'https://manapool.com/lists/$id/__data.json';
    http.Response resp;
    try {
      resp = await _http
          .get(
            Uri.parse(dataUrl),
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'MagicBracketSimulator/1.0',
            },
          )
          .timeout(const Duration(seconds: 10));
    } catch (e) {
      throw StateError(
        'Could not reach ManaPool (network error). Please check the URL and try again.',
      );
    }
    if (resp.statusCode != 200) {
      if (resp.statusCode == 404) {
        throw StateError('ManaPool list not found: $id');
      }
      if (resp.statusCode == 403) {
        throw StateError('ManaPool list is private or not accessible: $id');
      }
      throw StateError(
        'Failed to fetch ManaPool list (HTTP ${resp.statusCode}). $_kHint',
      );
    }

    dynamic decoded;
    try {
      decoded = json.decode(resp.body);
    } catch (_) {
      throw StateError(
        'ManaPool returned non-JSON response for list $id. $_kHint',
      );
    }

    if (decoded is! Map ||
        decoded['type'] != 'data' ||
        decoded['nodes'] is! List) {
      throw StateError(
        'Unexpected response structure from ManaPool for list $id. $_kHint',
      );
    }

    // Find the node whose shape exposes "cards" or "deck" — TS used
    // nodes[1] historically but searches now to tolerate layout changes.
    final nodes = (decoded['nodes'] as List).whereType<Map>();
    Map? dataNode;
    for (final n in nodes) {
      final data = n['data'];
      if (data is! List || data.isEmpty) continue;
      final shape = data[0];
      if (!_isDevalueShape(shape)) continue;
      if (shape.containsKey('cards') || shape.containsKey('deck')) {
        dataNode = n;
        break;
      }
    }
    final data = dataNode?['data'];
    if (data is! List) {
      throw StateError(
        'Could not locate deck data in ManaPool response for list $id. $_kHint',
      );
    }

    return _parseDevalue(data, id);
  }
}

bool isManaPoolUrl(String url) => ManaPoolClient._kUrl.hasMatch(url);

String? extractManaPoolListId(String url) {
  final m = ManaPoolClient._kUrl.firstMatch(url);
  return m?.group(1);
}

bool _isDevalueShape(dynamic v) {
  if (v is! Map) return false;
  if (v.isEmpty) return false;
  return v.values.every((x) => x is num);
}

dynamic _dv(List data, Map shape, String field) {
  final idx = shape[field];
  if (idx is! num) return null;
  final i = idx.toInt();
  if (i < 0 || i >= data.length) return null;
  return data[i];
}

ParsedDeck _parseDevalue(List data, String listId) {
  final pageShape = data[0];
  if (!_isDevalueShape(pageShape)) {
    throw StateError(
      'Could not parse page structure from ManaPool list $listId. ${ManaPoolClient._kHint}',
    );
  }

  var deckName = 'ManaPool List $listId';
  final deckIdx = pageShape['deck'] ?? pageShape['list'];
  if (deckIdx is num) {
    final deckShape = data[deckIdx.toInt()];
    if (_isDevalueShape(deckShape)) {
      final name = _dv(data, deckShape, 'name');
      if (name is String && name.isNotEmpty) deckName = name;
    }
  }

  final cardsIdx =
      pageShape['cards'] ?? pageShape['items'] ?? pageShape['entries'];
  if (cardsIdx is! num) {
    throw StateError(
      'Could not find card list in ManaPool list $listId. ${ManaPoolClient._kHint}',
    );
  }
  final cardsArray = data[cardsIdx.toInt()];
  if (cardsArray is! List) {
    throw StateError(
      'Could not find card list in ManaPool list $listId. ${ManaPoolClient._kHint}',
    );
  }

  final commanders = <DeckCard>[];
  final mainboard = <DeckCard>[];

  for (final cardEntryIdx in cardsArray) {
    if (cardEntryIdx is! num) continue;
    final entryShape = data[cardEntryIdx.toInt()];
    if (!_isDevalueShape(entryShape)) continue;

    final qtyRaw = _dv(data, entryShape, 'quantity');
    final qty = qtyRaw is num ? (qtyRaw.toInt() < 1 ? 1 : qtyRaw.toInt()) : 1;
    final isCommander = _dv(data, entryShape, 'is_commander') == true;

    final cardObjShape = _dv(data, entryShape, 'card');
    if (!_isDevalueShape(cardObjShape)) continue;
    final name = _dv(data, cardObjShape, 'name');
    if (name is! String || name.isEmpty) continue;

    final setCode = _dv(data, cardObjShape, 'setCode');
    final collectorNumber = _dv(data, cardObjShape, 'number');

    final c = DeckCard(
      name: name,
      quantity: qty,
      isCommander: isCommander,
      setCode: setCode is String && setCode.isNotEmpty ? setCode : null,
      collectorNumber: collectorNumber is String && collectorNumber.isNotEmpty
          ? collectorNumber
          : null,
    );
    if (isCommander) {
      commanders.add(c);
    } else {
      mainboard.add(c);
    }
  }

  if (commanders.isEmpty && mainboard.isEmpty) {
    throw StateError(
      'Could not parse any cards from ManaPool list $listId. ${ManaPoolClient._kHint}',
    );
  }

  return ParsedDeck(
    name: deckName,
    commanders: commanders,
    mainboard: mainboard,
  );
}
