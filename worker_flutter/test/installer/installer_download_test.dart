import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:worker_flutter/installer/forge_manifest.dart';
import 'package:worker_flutter/installer/installer.dart';

/// End-to-end-ish download tests for `Installer`. The redirect cap and
/// SHA-256 verification are the two safety nets between the worker
/// and a tampered/garbage Forge bundle — they have to fail loud, fail
/// fast, and clean up after themselves.
void main() {
  late Directory supportDir;

  setUp(() async {
    supportDir = await Directory.systemTemp.createTemp('installer_test_');
  });

  tearDown(() async {
    if (supportDir.existsSync()) supportDir.deleteSync(recursive: true);
  });

  ForgeManifestClient deadManifest() => ForgeManifestClient(
    url: 'unused://manifest',
    client: MockClient((_) async => http.Response('', 500)),
  );

  test('aborts after >5 redirects with a descriptive error message', () async {
    // Build a MockClient that keeps issuing 302s forever. The
    // installer's redirect cap is 5; we should see exactly 6
    // requests (1 original + 5 follows) before it bails.
    var hops = 0;
    final client = MockClient((req) async {
      hops++;
      return http.Response(
        '',
        302,
        headers: {'location': 'https://example.com/hop-$hops'},
      );
    });

    final installer = Installer(
      client: client,
      manifestClient: deadManifest(),
      supportDirOverride: () async => supportDir.path,
    );

    Object? caught;
    try {
      await installer.install();
    } catch (e) {
      caught = e;
    }
    expect(caught, isA<Exception>());
    expect(
      caught.toString(),
      contains('exceeded 5 redirects'),
      reason:
          'failure message must name the cap so the maintainer can '
          'tell a CDN loop apart from a normal 4xx/5xx',
    );
    expect(hops, 6, reason: '1 original request + 5 follows before bail-out');
  });

  test('SHA-256 mismatch deletes the temp file and throws', () async {
    // Pre-populate a fake JRE so install() jumps straight to Forge.
    // Otherwise the JRE download would fire first and fail on the same
    // mock client setup, masking the SHA check we want to exercise.
    // Match the platform-specific JRE layout the installer looks for
    // (`Contents/Home/bin/java` on macOS/Linux, `bin\java.exe` on
    // Windows) — otherwise this test fails on whichever runner doesn't
    // match the hard-coded path.
    final jreBin = Platform.isWindows
        ? p.join(supportDir.path, 'jre', 'bin', 'java.exe')
        : p.join(supportDir.path, 'jre', 'Contents', 'Home', 'bin', 'java');
    final fakeJre = File(jreBin);
    fakeJre.parent.createSync(recursive: true);
    fakeJre.writeAsStringSync('#!/bin/sh\nexit 0\n');

    final wrongHash = 'a' * 64;
    final manifestJarName = 'forge-gui-desktop-0.0.0-jar-with-dependencies.jar';
    final manifestClient = ForgeManifestClient(
      url: 'https://stub/manifest.json',
      client: MockClient((req) async {
        return http.Response(
          '{"version":"0.0.0","url":"https://test/forge.tar.bz2",'
          '"sha256":"$wrongHash","size":4,'
          '"jarName":"$manifestJarName"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    final tarballBytes = List<int>.filled(4, 0x42); // bytes won't match
    final client = MockClient(
      (req) async => http.Response.bytes(tarballBytes, 200),
    );

    final installer = Installer(
      client: client,
      manifestClient: manifestClient,
      supportDirOverride: () async => supportDir.path,
    );

    Object? caught;
    try {
      await installer.install();
    } catch (e) {
      caught = e;
    }
    expect(caught, isA<Exception>());
    expect(
      caught.toString(),
      contains('SHA-256 mismatch'),
      reason:
          'verifier must name itself in the error so a sha mismatch '
          'is unambiguous',
    );
    expect(
      caught.toString(),
      contains(wrongHash),
      reason: 'expected hash from the manifest must appear in the error',
    );

    final tmp = File(p.join(supportDir.path, 'forge-download.tar.bz2'));
    expect(
      tmp.existsSync(),
      isFalse,
      reason: 'failed SHA verification must delete the temp download',
    );
  });
}
