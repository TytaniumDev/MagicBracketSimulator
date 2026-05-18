import 'dart:async';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:rxdart/rxdart.dart';

import '../config.dart';
import '../ingestion/ingestion.dart';
import '../offline/db/app_db.dart';
import '../offline/deck_source.dart';
import 'deck_record.dart';
import 'deck_repo.dart';

/// Offline-mode deck repo: backed by Drift for user decks and the
/// asset bundle for precons. URL ingestion happens in-process via
/// [DeckIngestion]; Scryfall color-identity lookup is best-effort.
class OfflineDeckRepo implements DeckRepo {
  OfflineDeckRepo({
    required this.db,
    required this.config,
    DeckIngestion? ingestion,
    ScryfallClient? scryfall,
  }) : _ingestion = ingestion ?? DeckIngestion(),
       _scryfall = scryfall ?? ScryfallClient();

  final AppDb db;
  final WorkerConfig config;
  final DeckIngestion _ingestion;
  final ScryfallClient _scryfall;

  /// One-shot cache of bundled precons — they're shipped in assets and
  /// don't change between rebuilds, so we resolve them lazily on first
  /// observe.
  Future<List<PreconDeck>>? _preconCache;

  @override
  Stream<List<DeckRecord>> watchDecks() {
    final userDecks = db.watchDecks();
    // Treat precons as a single-shot future — pumping them into the
    // combine via Stream.fromFuture lets the user-decks half drive
    // live updates while the precons are loaded once.
    final preconStream = Stream.fromFuture(_loadPrecons());
    return Rx.combineLatest2<List<PreconDeck>, List<DeckRow>, List<DeckRecord>>(
      preconStream,
      userDecks,
      (precons, rows) {
        return [
          for (final p in precons)
            DeckRecord(
              id: 'precon:${p.filename}',
              name: p.displayName,
              filename: p.filename,
              isPrecon: true,
            ),
          for (final r in rows)
            DeckRecord(
              id: 'L${r.id}',
              name: r.name,
              filename: r.filename,
              isPrecon: false,
              colorIdentity: _unpackColors(r.colorIdentity),
              link: r.link,
              primaryCommander: r.primaryCommander,
            ),
        ];
      },
    );
  }

  @override
  Future<DeckRecord> createFromUrl(String url) async {
    final parsed = await _ingestion.fetchFromUrl(url);
    return _save(parsed, link: url);
  }

  @override
  Future<DeckRecord> createFromText(
    String text, {
    String? name,
    String? link,
  }) async {
    var parsed = parseTextDeckWithAutoName(text);
    if (name != null && name.trim().isNotEmpty) {
      parsed = ParsedDeck(
        name: name.trim(),
        commanders: parsed.commanders,
        mainboard: parsed.mainboard,
      );
    }
    return _save(parsed, link: link);
  }

  @override
  Future<void> deleteDeck(DeckRecord deck) async {
    if (deck.isPrecon) {
      throw StateError('Cannot delete bundled precons.');
    }
    final rowId = int.tryParse(deck.id.replaceFirst('L', ''));
    if (rowId == null) {
      throw StateError('Bad offline deck id: ${deck.id}');
    }
    final row = await db.deckById(rowId);
    await db.deleteDeckById(rowId);
    if (row != null) {
      final path = File(p.join(config.decksPath, row.filename));
      if (path.existsSync()) {
        try {
          await path.delete();
        } catch (_) {
          // Best-effort cleanup; a stale .dck won't break sims.
        }
      }
    }
  }

  Future<DeckRecord> _save(ParsedDeck parsed, {String? link}) async {
    // Name uniqueness — the offline runner resolves declared deck
    // names against bundled precons first, then this table. A
    // duplicate name with a precon (precon wins) or another user
    // deck (nondeterministic pick) silently sends the wrong deck to
    // Forge, so reject up front with a clear message instead.
    final precons = await _loadPrecons();
    if (precons.any((p) => p.displayName == parsed.name)) {
      throw StateError(
        'A bundled precon is already named "${parsed.name}". '
        'Rename the deck and try again.',
      );
    }
    if (await db.deckByName(parsed.name) != null) {
      throw StateError(
        'You already have a deck named "${parsed.name}". '
        'Rename the deck and try again.',
      );
    }
    final filename = await _uniqueFilename(parsed.name);
    final dck = toDck(parsed);
    final cardNames = <String>[for (final c in parsed.commanders) c.name];
    List<String>? colors;
    try {
      final list = await _scryfall.colorIdentityForCards(cardNames);
      if (list.isNotEmpty) colors = list;
    } catch (_) {
      // Best-effort — leave null.
    }
    final id = await db.insertDeck(
      name: parsed.name,
      filename: filename,
      dckContent: dck,
      colorIdentity: colors?.join(),
      link: link,
      primaryCommander: parsed.commanders.isNotEmpty
          ? parsed.commanders.first.name
          : null,
    );
    await _materialize(filename, dck);
    return DeckRecord(
      id: 'L$id',
      name: parsed.name,
      filename: filename,
      isPrecon: false,
      colorIdentity: colors,
      link: link,
      primaryCommander: parsed.commanders.isNotEmpty
          ? parsed.commanders.first.name
          : null,
    );
  }

  Future<String> _uniqueFilename(String deckName) async {
    final base = _slug(deckName);
    var candidate = '$base.dck';
    var n = 1;
    while (await db.deckByFilename(candidate) != null) {
      n += 1;
      candidate = '$base-$n.dck';
    }
    return candidate;
  }

  Future<void> _materialize(String filename, String dck) async {
    final dir = Directory(config.decksPath);
    if (!dir.existsSync()) dir.createSync(recursive: true);
    // Write to a temp file and rename atomically so a crash mid-write
    // never leaves a half-written .dck for the runner to choke on.
    final dest = File(p.join(config.decksPath, filename));
    final tmp = File('${dest.path}.tmp');
    await tmp.writeAsString(dck);
    await tmp.rename(dest.path);
  }

  Future<List<PreconDeck>> _loadPrecons() {
    return _preconCache ??= loadBundledPrecons(config.forgePath);
  }

  List<String>? _unpackColors(String? packed) {
    if (packed == null || packed.isEmpty) return null;
    return packed
        .split('')
        .where((c) => 'WUBRG'.contains(c))
        .toList(growable: false);
  }

  String _slug(String name) {
    final lower = name.toLowerCase().trim();
    final cleaned = lower.replaceAll(RegExp(r'[^a-z0-9]+'), '-');
    final trimmed = cleaned.replaceAll(RegExp(r'^-+|-+$'), '');
    return trimmed.isEmpty ? 'deck' : trimmed;
  }
}
