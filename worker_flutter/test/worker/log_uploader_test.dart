import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/log_uploader.dart';

LogUploader _uploader(http.Client client, {bool signedIn = true}) =>
    LogUploader(
      api: ApiClient(
        baseUrl: 'https://api.example.com',
        client: client,
        auth: MockFirebaseAuth(
          signedIn: signedIn,
          mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
        ),
        appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
      ),
    );

/// `LogUploader` is intentionally non-throwing — a sim's terminal
/// state lands in Firestore before the upload runs, so missing logs
/// are cosmetic. These tests pin that contract so a future "throw on
/// error" rewrite trips the regression and we'd notice that a 5xx
/// from the API was silently killing the job's terminal write.
void main() {
  group('LogUploader.upload', () {
    test('posts to the per-sim endpoint with the right shape', () async {
      late String capturedUrl;
      late Map<String, String> capturedHeaders;
      late Map<String, dynamic> capturedBody;
      final client = MockClient((req) async {
        capturedUrl = req.url.toString();
        capturedHeaders = req.headers;
        capturedBody = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response('{"ok":true}', 200);
      });
      await _uploader(
        client,
      ).upload(jobId: 'job-abc', simIndex: 4, logText: 'sim 5 stdout');

      expect(
        capturedUrl,
        'https://api.example.com/api/jobs/job-abc/logs/simulation',
      );
      expect(
        capturedHeaders['Authorization'],
        startsWith('Bearer '),
        reason: "the API accepts the signed-in allowlisted user's token",
      );
      expect(capturedHeaders.containsKey('X-Worker-Secret'), isFalse);
      expect(capturedHeaders['Content-Type'], contains('application/json'));
      expect(
        capturedBody['filename'],
        'raw/game_005.txt',
        reason:
            'simIndex is 0-based but the cloud filename is 1-based + zero '
            'padded so it sorts naturally next to game_001..N',
      );
      expect(capturedBody['logText'], 'sim 5 stdout');
    });

    test('returns silently without posting when signed out', () async {
      var posted = false;
      final client = MockClient((req) async {
        posted = true;
        return http.Response('', 200);
      });
      await expectLater(
        _uploader(
          client,
          signedIn: false,
        ).upload(jobId: 'job', simIndex: 0, logText: 'x'),
        completes,
      );
      expect(posted, isFalse);
    });

    test('swallows a 5xx without throwing', () async {
      final client = MockClient(
        (req) async => http.Response('upstream down', 503),
      );
      final uploader = _uploader(client);
      // The contract: terminal sim state is written before this runs,
      // so an upload failure must not bubble and undo that write.
      await expectLater(
        uploader.upload(jobId: 'j', simIndex: 0, logText: 'x'),
        completes,
      );
    });

    test('swallows a transport exception without throwing', () async {
      final client = MockClient(
        (req) async => throw const SocketExceptionLike('DNS failure'),
      );
      final uploader = _uploader(client);
      await expectLater(
        uploader.upload(jobId: 'j', simIndex: 0, logText: 'x'),
        completes,
      );
    });

    test(
      'respects the 30s timeout (returns silently after deadline)',
      () async {
        final client = MockClient((req) async {
          // Block the response far past the uploader's deadline. The
          // uploader times itself out, returns silently, and the test's
          // `completes` proves we didn't deadlock.
          await Future.delayed(const Duration(seconds: 35));
          return http.Response('', 200);
        });
        final uploader = _uploader(client);
        await expectLater(
          uploader
              .upload(jobId: 'j', simIndex: 0, logText: 'x')
              .timeout(const Duration(seconds: 35)),
          completes,
        );
      },
      timeout: const Timeout(Duration(seconds: 45)),
    );
  });
}

/// Plain `SocketException` would force dart:io import in tests that
/// otherwise stay platform-agnostic; this stand-in is enough to drive
/// the `catch (e)` branch.
class SocketExceptionLike implements Exception {
  const SocketExceptionLike(this.message);
  final String message;
  @override
  String toString() => 'SocketExceptionLike: $message';
}
