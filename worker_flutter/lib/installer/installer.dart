import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// One-time installer that downloads the JRE and Forge into the app's
/// support directory on first launch. After this the worker can run real
/// simulations without the user installing anything by hand.
///
/// Why first-launch instead of bundled inside the .app:
///   - .app ships at ~50MB (just Flutter + plugins) instead of ~500MB
///   - JRE and Forge are easily re-downloadable if something corrupts
///   - Forge data updates can be handled independently of app releases
///
/// Trade-off: requires network on first launch. Subsequent launches use
/// the local install. The installer is idempotent — re-running it with
/// existing files is a no-op.
class Installer {
  Installer({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  // Pinned versions. Bump these as needed.
  static const _forgeVersion = '2.0.10';
  static const _jreVersionFeature = 17;

  /// Reported progress of the current install step.
  final _progress = StreamController<InstallProgress>.broadcast();
  Stream<InstallProgress> get progressStream => _progress.stream;

  Future<String> _supportDir() async {
    final dir = await getApplicationSupportDirectory();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir.path;
  }

  Future<String> jrePath() async => '${await _supportDir()}/jre';
  Future<String> forgePath() async => '${await _supportDir()}/forge';
  Future<String> javaBinary() async => '${await jrePath()}/Contents/Home/bin/java';

  /// True iff both JRE and Forge are installed and look valid.
  Future<bool> isReady() async {
    final java = await javaBinary();
    final forgeJar = '${await forgePath()}/forge-gui-desktop-$_forgeVersion-jar-with-dependencies.jar';
    return File(java).existsSync() && File(forgeJar).existsSync();
  }

  /// Install whatever is missing. Idempotent.
  Future<void> install() async {
    final jre = await jrePath();
    final forge = await forgePath();
    final java = await javaBinary();
    final forgeJar = '$forge/forge-gui-desktop-$_forgeVersion-jar-with-dependencies.jar';

    if (!File(java).existsSync()) {
      _emit('jre', 'Downloading Java runtime', 0);
      await _installJre(jre);
      _emit('jre', 'Java runtime ready', 1);
    } else {
      _emit('jre', 'Java already installed', 1);
    }

    if (!File(forgeJar).existsSync()) {
      _emit('forge', 'Downloading Forge $_forgeVersion (~270 MB)', 0);
      await _installForge(forge);
      _emit('forge', 'Forge ready', 1);
    } else {
      _emit('forge', 'Forge already installed', 1);
    }

    _emit('done', 'All set', 1);
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
    final res = await Process.run(
      'tar',
      ['-xzf', tmpFile.path, '-C', destDir, '--strip-components=1'],
    );
    if (res.exitCode != 0) {
      throw Exception('tar (jre) failed: ${res.stderr}');
    }
    tmpFile.deleteSync();
    // chmod +x on the bin so the JVM is invokable.
    await Process.run('chmod', ['-R', '+x', '$destDir/Contents/Home/bin']);
  }

  Future<void> _installForge(String destDir) async {
    final url = Uri.parse(
      'https://github.com/Card-Forge/forge/releases/download/forge-$_forgeVersion/forge-installer-$_forgeVersion.tar.bz2',
    );
    final tmpFile = File('${await _supportDir()}/forge-download.tar.bz2');
    await _downloadWithProgress(url, tmpFile, label: 'forge');

    Directory(destDir).createSync(recursive: true);
    _emit('forge', 'Extracting Forge', 0);
    final res = await Process.run(
      'tar',
      ['-xjf', tmpFile.path, '-C', destDir],
    );
    if (res.exitCode != 0) {
      throw Exception('tar (forge) failed: ${res.stderr}');
    }
    tmpFile.deleteSync();
    await Process.run('chmod', ['+x', '$destDir/forge.sh']);
  }

  Future<void> _downloadWithProgress(
    Uri url,
    File dest, {
    required String label,
  }) async {
    final req = http.Request('GET', url);
    final resp = await _client.send(req);
    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers['location'] != null) {
      // Follow one redirect (Adoptium redirects to a CDN).
      return _downloadWithProgress(Uri.parse(resp.headers['location']!), dest, label: label);
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
    _progress.add(InstallProgress(stage: stage, message: message, progress: progress));
  }

  void dispose() {
    _progress.close();
    _client.close();
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
