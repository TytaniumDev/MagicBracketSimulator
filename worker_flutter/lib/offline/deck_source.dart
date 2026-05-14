import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path/path.dart' as p;

/// One bundled-precon deck. The `.dck` content lives either in the
/// Flutter asset bundle (preferred — ships inside the app, available
/// instantly on first launch) or, for users with a separately-
/// installed Forge tree, in `<forgePath>/res/Decks/Commander/*.dck`.
class PreconDeck {
  PreconDeck({
    required this.displayName,
    required this.filename,
    required this.path,
    required this.assetKey,
  });

  /// Human-friendly name. Always set.
  final String displayName;

  /// Full filename including .dck (matches Forge's expected `-d` arg).
  final String filename;

  /// Filesystem path to the .dck, if and only if it already exists on
  /// disk. Empty string when the deck lives only in the asset bundle —
  /// callers should call `materialize()` before passing the path to
  /// Forge.
  final String path;

  /// Flutter asset key (e.g. `assets/precons/marchesa.dck`). Empty
  /// string for filesystem-sourced decks. Used by [materialize] to
  /// extract bundled precons to a writable directory.
  final String assetKey;

  /// Whether this deck still needs to be written to disk before Forge
  /// can read it.
  bool get isBundled => assetKey.isNotEmpty;
}

/// Loads precons from the Flutter asset bundle PLUS any extra .dck
/// files the user may have dropped into `<forgePath>/res/Decks/
/// Commander/`. The bundled set is the floor — offline mode works
/// from a fresh install without a Forge download.
Future<List<PreconDeck>> loadBundledPrecons(String forgePath) async {
  final out = <PreconDeck>[];

  // 1) Asset-bundle precons. Read the AssetManifest so we don't have
  //    to hard-code filenames here — adding a new .dck under
  //    `assets/precons/` and adjusting nothing else picks it up.
  try {
    final manifestJson = await rootBundle.loadString('AssetManifest.json');
    // Quick-and-cheap parse: every key beginning with the precons dir
    // is a bundled deck. Avoids pulling in a json codec for one match.
    final preconKeys = manifestJson
        .split(',')
        .map((s) => s.trim().replaceAll('"', '').split(':').first)
        .where((s) => s.startsWith('assets/precons/') && s.endsWith('.dck'))
        .toSet();
    for (final key in preconKeys) {
      final filename = key.substring('assets/precons/'.length);
      out.add(
        PreconDeck(
          displayName: _humanize(filename.substring(0, filename.length - 4)),
          filename: filename,
          path: '',
          assetKey: key,
        ),
      );
    }
  } catch (_) {
    // AssetManifest missing only happens in tests / non-Flutter
    // contexts. Fall through to the filesystem branch.
  }

  // 2) Any Forge-install precons the bundle doesn't already cover.
  //    Skip duplicates by filename so a custom .dck dropped into Forge
  //    with the same name as a bundled one doesn't silently shadow it
  //    in the picker. (We prefer the bundled one — known-good content.)
  final commanderDir = Directory(
    p.join(forgePath, 'res', 'Decks', 'Commander'),
  );
  if (commanderDir.existsSync()) {
    final seen = out.map((d) => d.filename).toSet();
    await for (final entity in commanderDir.list(recursive: true)) {
      if (entity is! File) continue;
      final name = entity.path.split(Platform.pathSeparator).last;
      if (!name.toLowerCase().endsWith('.dck')) continue;
      if (seen.contains(name)) continue;
      out.add(
        PreconDeck(
          displayName: _humanize(name.substring(0, name.length - 4)),
          filename: name,
          path: entity.path,
          assetKey: '',
        ),
      );
    }
  }

  out.sort(
    (a, b) =>
        a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase()),
  );
  return out;
}

/// Write a bundled precon to `destDir/<filename>` and return the full
/// path Forge will read. No-op when the deck is already a real file.
Future<String> materializePrecon(PreconDeck deck, String destDir) async {
  if (!deck.isBundled) return deck.path;
  final dest = File(p.join(destDir, deck.filename));
  if (!dest.existsSync()) {
    dest.parent.createSync(recursive: true);
    final raw = await rootBundle.loadString(deck.assetKey);
    dest.writeAsStringSync(raw);
  }
  return dest.path;
}

/// "marchesa-control-upgraded" → "Marchesa Control Upgraded".
String _humanize(String raw) {
  return raw
      .replaceAll(RegExp(r'[_-]+'), ' ')
      .split(' ')
      .where((w) => w.isNotEmpty)
      .map((w) => '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}
