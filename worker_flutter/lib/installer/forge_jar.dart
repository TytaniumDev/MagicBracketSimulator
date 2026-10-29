import 'dart:io';

final _forgeJarPattern = RegExp(
  r'^forge-gui-desktop-(.+)-jar-with-dependencies\.jar$',
);

/// The newest Forge JAR among [fileNames], or null if none match
/// `forge-gui-desktop-<version>-jar-with-dependencies.jar`.
///
/// An old JAR can outlive a Forge bump: the installer deletes it best
/// effort, and Windows refuses while anything holds the file open. Picking
/// by version (not directory order, which on Windows is alphabetical and
/// puts 2.0.10 before 2.0.15) keeps a leftover from being run.
String? newestForgeJarName(Iterable<String> fileNames) {
  String? best;
  List<int>? bestVersion;
  for (final name in fileNames) {
    final match = _forgeJarPattern.firstMatch(name);
    if (match == null) continue;
    final version = _versionParts(match.group(1)!);
    if (bestVersion == null || _compare(version, bestVersion) > 0) {
      best = name;
      bestVersion = version;
    }
  }
  return best;
}

/// Full path of the newest Forge JAR in [forgeDir], or null if it has none.
String? findNewestForgeJar(String forgeDir) {
  final dir = Directory(forgeDir);
  if (!dir.existsSync()) return null;
  final byName = {
    for (final entry in dir.listSync())
      entry.path.split(Platform.pathSeparator).last: entry.path,
  };
  final name = newestForgeJarName(byName.keys);
  return name == null ? null : byName[name];
}

/// "2.0.15" → [2, 0, 15]. Non-numeric parts ("SNAPSHOT") count as 0.
List<int> _versionParts(String version) => version
    .split(RegExp(r'[.\-]'))
    .map((part) => int.tryParse(part) ?? 0)
    .toList();

int _compare(List<int> a, List<int> b) {
  for (var i = 0; i < a.length || i < b.length; i++) {
    final diff = (i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0);
    if (diff != 0) return diff;
  }
  return 0;
}
