import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/installer/forge_manifest.dart';

void main() {
  group('ForgeManifest.fromJson', () {
    test('reads all required fields', () {
      final m = ForgeManifest.fromJson({
        'version': '2.0.10',
        'url': 'https://example.com/forge.tar.bz2',
        'sha256': 'abc123',
        'size': 286557618,
        'jarName': 'forge-gui-desktop-2.0.10-jar-with-dependencies.jar',
      });
      expect(m.version, '2.0.10');
      expect(m.url, 'https://example.com/forge.tar.bz2');
      expect(m.sha256, 'abc123');
      expect(m.size, 286557618);
      expect(m.jarName, contains('2.0.10'));
    });
  });

  group('ForgeManifestClient.fetch', () {
    test('returns parsed manifest on 200', () async {
      final client = ForgeManifestClient(
        url: 'https://test.example/forge-manifest.json',
        client: MockClient((req) async {
          return http.Response(
            '{"version":"2.1.0","url":"https://x/y.tar.bz2",'
            '"sha256":"deadbeef","size":42,'
            '"jarName":"forge-gui-desktop-2.1.0-jar-with-dependencies.jar"}',
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );
      final m = await client.fetch();
      expect(m, isNotNull);
      expect(m!.version, '2.1.0');
      expect(m.size, 42);
    });

    test('returns null on non-200 (offline-friendly fallback)', () async {
      // The installer's `isReady()` accepts whatever JAR is on disk
      // when the manifest is unreachable — never blocking a launch
      // because GitHub is rate-limiting raw fetches or the user has
      // no network. This test pins that contract.
      final client = ForgeManifestClient(
        url: 'https://test.example/forge-manifest.json',
        client: MockClient((req) async => http.Response('not found', 404)),
      );
      final m = await client.fetch();
      expect(m, isNull);
    });

    test('returns null on malformed JSON', () async {
      final client = ForgeManifestClient(
        url: 'https://test.example/forge-manifest.json',
        client: MockClient((req) async => http.Response('{not json', 200)),
      );
      final m = await client.fetch();
      expect(m, isNull);
    });

    test('returns null on network error', () async {
      final client = ForgeManifestClient(
        url: 'https://test.example/forge-manifest.json',
        client: MockClient((req) async => throw Exception('DNS fail')),
      );
      final m = await client.fetch();
      expect(m, isNull);
    });

    test('respects timeout argument', () async {
      final client = ForgeManifestClient(
        url: 'https://test.example/forge-manifest.json',
        client: MockClient((req) async {
          await Future.delayed(const Duration(seconds: 2));
          return http.Response('{}', 200);
        }),
      );
      final m = await client.fetch(timeout: const Duration(milliseconds: 200));
      expect(m, isNull, reason: 'timed-out fetch must return null');
    });
  });
}
