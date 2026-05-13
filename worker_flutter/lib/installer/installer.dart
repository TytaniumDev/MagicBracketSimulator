import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'forge_manifest.dart';

/// First-launch installer for the JRE + Forge bundle.
///
/// Forge versioning is now manifest-driven:
///   - `worker_flutter/forge-manifest.json` is the source of truth.
///   - On every boot the worker fetches the manifest from
///     raw.githubusercontent.com (pinned to `main`).
///   - If the manifest's version doesn't match what's installed on disk,
///     the installer re-downloads + extracts + verifies SHA-256 +
///     removes old `forge-gui-desktop-*.jar` files. This lets a Forge
///     bump ship without a .app release: bump the JSON on `main` and
///     every running install picks it up on its next launch.
///
/// JRE versioning is still pinned to Adoptium's "latest" Java 17.
/// Existing installs are not bumped to newer JREs — we only fetch if
/// the bundled JRE binary is missing. Adoptium's JRE is generally
/// API-stable within a feature release, so this is intentional.
class Installer {
  Installer({http.Client? client, ForgeManifestClient? manifestClient})
    : _client = client ?? http.Client(),
      _manifestClient = manifestClient ?? ForgeManifestClient();

  final http.Client _client;
  final ForgeManifestClient _manifestClient;

  static const _jreVersionFeature = 17;

  /// Hard cap on redirect follows. Adoptium typically issues one 3xx
  /// (to a CDN); we allow up to 5 to handle geo-routing chains, then bail.
  static const _maxRedirects = 5;

  /// Reported progress of the current install step.
  final _progress = StreamController<InstallProgress>.broadcast();
  Stream<InstallProgress> get progressStream => _progress.stream;

  /// Cached after first successful fetch. Used by [installedJarName] so
  /// callers (SimRunner) don't have to fetch again.
  ForgeManifest? _lastManifest;

  Future<String> _supportDir() async {
    final dir = await getApplicationSupportDirectory();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir.path;
  }

  Future<String> jrePath() async => '${await _supportDir()}/jre';
  Future<String> forgePath() async => '${await _supportDir()}/forge';
  Future<String> javaBinary() async =>
      '${await jrePath()}/Contents/Home/bin/java';

  /// True iff:
  /// - the JRE binary is present, and
  /// - either we couldn't reach the manifest (so we trust whatever JAR
  ///   is on disk), or the on-disk JAR matches the manifest's version.
  ///
  /// The "manifest unreachable" fallback keeps the worker bootable
  /// offline; the user gets the previously-installed Forge.
  Future<bool> isReady() async {
    final java = await javaBinary();
    if (!File(java).existsSync()) return false;

    final manifest = await _manifestClient.fetch();
    _lastManifest = manifest;
    final forge = await forgePath();

    if (manifest == null) {
      // Offline: accept whatever Forge JAR is present.
      return _findAnyForgeJar(forge) != null;
    }
    final wantedJar = File('$forge/${manifest.jarName}');
    return wantedJar.existsSync();
  }

  /// Install whatever is missing or out of date.
  Future<void> install() async {
    final jre = await jrePath();
    final java = await javaBinary();
    final forge = await forgePath();

    if (!File(java).existsSync()) {
      _emit('jre', 'Downloading Java runtime', 0);
      await _installJre(jre);
      _emit('jre', 'Java runtime ready', 1);
    } else {
      _emit('jre', 'Java already installed', 1);
    }

    final manifest = _lastManifest ?? await _manifestClient.fetch();
    _lastManifest = manifest;

    if (manifest == null) {
      // Offline: keep whatever is installed; surface in UI.
      _emit('forge', 'Forge manifest unreachable — using local install', 1);
    } else {
      final wantedJar = File('$forge/${manifest.jarName}');
      if (wantedJar.existsSync()) {
        _emit('forge', 'Forge ${manifest.version} already installed', 1);
      } else {
        final sizeMb = (manifest.size / (1024 * 1024)).toStringAsFixed(0);
        _emit(
          'forge',
          'Downloading Forge ${manifest.version} (~$sizeMb MB)',
          0,
        );
        await _installForge(forge, manifest);
        _emit('forge', 'Forge ${manifest.version} ready', 1);
      }
    }

    _emit('done', 'All set', 1);
  }

  /// Resolved Forge JAR filename. Reflects whatever the most recent
  /// [isReady]/[install] call established. Returns null if neither has
  /// run yet AND no JAR exists on disk.
  Future<String?> installedJarName() async {
    if (_lastManifest != null) return _lastManifest!.jarName;
    return _findAnyForgeJar(await forgePath());
  }

  String? _findAnyForgeJar(String forgeDir) {
    final dir = Directory(forgeDir);
    if (!dir.existsSync()) return null;
    for (final entry in dir.listSync()) {
      final name = entry.path.split(Platform.pathSeparator).last;
      if (name.startsWith('forge-gui-desktop-') &&
          name.endsWith('-jar-with-dependencies.jar')) {
        return name;
      }
    }
    return null;
  }

  Future<void> _installJre(String destDir) async {
    final arch = await _archSlug(); // 'aarch64' or 'x64'
    final url = Uri.parse(
      'https://api.adoptium.net/v3/binary/latest/$_jreVersionFeature/ga/mac/$arch/jre/hotspot/normal/eclipse',
    );
    final tmpFile = File('${await _supportDir()}/jre-download.tar.gz');
    await _downloadWithProgress(url, tmpFile, label: 'jre');

    // Adoptium ships a JRE folder structured like:
    //   <name>/Contents/Home/bin/java
    // Extract into destDir, stripping the top-level archive folder.
    Directory(destDir).createSync(recursive: true);
    final res = await Process.run('tar', [
      '-xzf',
      tmpFile.path,
      '-C',
      destDir,
      '--strip-components=1',
    ]);
    if (res.exitCode != 0) {
      throw Exception('tar (jre) failed: ${res.stderr}');
    }
    tmpFile.deleteSync();
    // chmod +x on the bin so the JVM is invokable.
    await Process.run('chmod', ['-R', '+x', '$destDir/Contents/Home/bin']);
  }

  Future<void> _installForge(String destDir, ForgeManifest manifest) async {
    final tmpFile = File('${await _supportDir()}/forge-download.tar.bz2');
    await _downloadWithProgress(
      Uri.parse(manifest.url),
      tmpFile,
      label: 'forge',
    );

    // Verify SHA-256 before trusting the bytes. A mismatched hash means
    // either a corrupted download or a tampered redirect target — either
    // way, do not extract.
    _emit('forge', 'Verifying download', 0.95);
    final actual = await _sha256OfFile(tmpFile);
    if (actual.toLowerCase() != manifest.sha256.toLowerCase()) {
      tmpFile.deleteSync();
      throw Exception(
        'Forge download SHA-256 mismatch: expected ${manifest.sha256}, got $actual',
      );
    }

    // Clean up any older forge-gui-desktop JARs so we don't leak ~270 MB
    // per bump. Other Forge resources (decks, images, configs) are kept.
    final dir = Directory(destDir);
    if (dir.existsSync()) {
      for (final entry in dir.listSync()) {
        final name = entry.path.split(Platform.pathSeparator).last;
        if (name.startsWith('forge-gui-desktop-') &&
            name.endsWith('-jar-with-dependencies.jar') &&
            name != manifest.jarName) {
          try {
            File(entry.path).deleteSync();
          } catch (_) {
            /* best effort */
          }
        }
      }
    }

    dir.createSync(recursive: true);
    _emit('forge', 'Extracting Forge ${manifest.version}', 0);
    final res = await Process.run('tar', ['-xjf', tmpFile.path, '-C', destDir]);
    if (res.exitCode != 0) {
      throw Exception('tar (forge) failed: ${res.stderr}');
    }
    tmpFile.deleteSync();
    await Process.run('chmod', ['+x', '$destDir/forge.sh']);
  }

  Future<String> _sha256OfFile(File f) async {
    final digest = await sha256.bind(f.openRead()).first;
    return digest.toString();
  }

  Future<void> _downloadWithProgress(
    Uri url,
    File dest, {
    required String label,
    int redirectsRemaining = _maxRedirects,
  }) async {
    final req = http.Request('GET', url);
    final resp = await _client.send(req);
    if (resp.statusCode >= 300 &&
        resp.statusCode < 400 &&
        resp.headers['location'] != null) {
      if (redirectsRemaining <= 0) {
        throw Exception('exceeded $_maxRedirects redirects downloading $url');
      }
      return _downloadWithProgress(
        Uri.parse(resp.headers['location']!),
        dest,
        label: label,
        redirectsRemaining: redirectsRemaining - 1,
      );
    }
    if (resp.statusCode != 200) {
      throw Exception('download $url returned ${resp.statusCode}');
    }
    final total = resp.contentLength ?? 0;
    final sink = dest.openWrite();
    var received = 0;
    await for (final chunk in resp.stream) {
      sink.add(chunk);
      received += chunk.length;
      final fraction = total > 0 ? received / total : 0.0;
      _emit(label, 'Downloading ($received B / $total B)', fraction);
    }
    await sink.close();
  }

  Future<String> _archSlug() async {
    final res = await Process.run('uname', ['-m']);
    final arch = (res.stdout as String).trim();
    return arch == 'x86_64' ? 'x64' : 'aarch64';
  }

  void _emit(String stage, String message, double progress) {
    _progress.add(
      InstallProgress(stage: stage, message: message, progress: progress),
    );
  }

  void dispose() {
    _progress.close();
    _client.close();
    _manifestClient.close();
  }
}

class InstallProgress {
  InstallProgress({
    required this.stage,
    required this.message,
    required this.progress,
  });

  /// 'jre' | 'forge' | 'done'
  final String stage;
  final String message;

  /// 0.0–1.0
  final double progress;
}
