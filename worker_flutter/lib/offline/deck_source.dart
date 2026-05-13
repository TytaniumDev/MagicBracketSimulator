import 'dart:io';

/// One bundled-precon deck on disk. We read these from Forge's own
/// data dir (`<forgePath>/res/Decks/Commander/*.dck`) — the installer
/// already extracts them as part of the first-run Forge download, so
/// offline mode gets the same ~30+ commander precons that the
/// simulation engine knows how to run.
class PreconDeck {
  PreconDeck({
    required this.displayName,
    required this.filename,
    required this.path,
  });

  /// Filename without the .dck extension. Used as `displayName` in UIs.
  final String displayName;

  /// Full filename including .dck (matches Forge's expected `-d` arg).
  final String filename;

  /// Absolute path to the .dck on disk.
  final String path;
}

/// Loads precons from the Forge installation directory.
///
/// `forgePath` is the same value the WorkerConfig carries —
/// `<app-support>/forge`. Forge unpacks its bundled commander precons
/// under `forgePath/res/Decks/Commander/` (verified with Forge 2.0.10).
/// The directory may be deep so we walk recursively and pick `.dck`
/// files only.
Future<List<PreconDeck>> loadBundledPrecons(String forgePath) async {
  final commanderDir = Directory('$forgePath/res/Decks/Commander');
  if (!commanderDir.existsSync()) {
    return const [];
  }
  final out = <PreconDeck>[];
  await for (final entity in commanderDir.list(recursive: true)) {
    if (entity is! File) continue;
    final name = entity.path.split(Platform.pathSeparator).last;
    if (!name.toLowerCase().endsWith('.dck')) continue;
    out.add(
      PreconDeck(
        displayName: _humanize(name.substring(0, name.length - 4)),
        filename: name,
        path: entity.path,
      ),
    );
  }
  out.sort(
    (a, b) =>
        a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase()),
  );
  return out;
}

/// "Marchesa-control-upgraded" → "Marchesa Control Upgraded".
String _humanize(String raw) {
  return raw
      .replaceAll(RegExp(r'[_-]+'), ' ')
      .split(' ')
      .where((w) => w.isNotEmpty)
      .map((w) => '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');
}
