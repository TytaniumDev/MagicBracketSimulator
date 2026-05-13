import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Snapshot of the canonical Forge release we want the worker to use.
///
/// Hosted as `worker_flutter/forge-manifest.json` in the repo, fetched
/// via raw.githubusercontent.com at boot. Updating the file on `main`
/// is what triggers existing installs to pull a new Forge version —
/// no .app release required. SHA-256 keeps content honest even if the
/// raw URL is MITM'd.
class ForgeManifest {
  ForgeManifest({
    required this.version,
    required this.url,
    required this.sha256,
    required this.size,
    required this.jarName,
  });

  final String version;
  final String url;
  final String sha256;
  final int size;
  final String jarName;

  factory ForgeManifest.fromJson(Map<String, dynamic> json) => ForgeManifest(
    version: json['version'] as String,
    url: json['url'] as String,
    sha256: json['sha256'] as String,
    size: (json['size'] as num).toInt(),
    jarName: json['jarName'] as String,
  );
}

/// Default location of the manifest. Pinned to `main` so existing installs
/// always read the latest authoritative version.
const _kDefaultManifestUrl =
    'https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main/worker_flutter/forge-manifest.json';

class ForgeManifestClient {
  ForgeManifestClient({http.Client? client, this.url = _kDefaultManifestUrl})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String url;

  /// Fetch the manifest. Returns `null` on any failure (network down,
  /// malformed JSON, etc.) so the caller can fall back to whatever
  /// version is already installed.
  Future<ForgeManifest?> fetch({
    Duration timeout = const Duration(seconds: 10),
  }) async {
    try {
      final resp = await _client.get(Uri.parse(url)).timeout(timeout);
      if (resp.statusCode != 200) return null;
      final json = jsonDecode(resp.body) as Map<String, dynamic>;
      return ForgeManifest.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  void close() => _client.close();
}
