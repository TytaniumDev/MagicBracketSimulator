import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/job_aggregator.dart';

JobAggregator _aggregator(http.Client client, {bool signedIn = true}) =>
    JobAggregator(
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

/// `JobAggregator` is a best-effort fast path; the stale-sweeper is the
/// safety net. These tests pin that it calls the right endpoint with the
/// signed-in user's token and never throws.
void main() {
  group('JobAggregator.triggerIfDone', () {
    test('posts to aggregate-if-done with the user token', () async {
      late String capturedUrl;
      late Map<String, String> capturedHeaders;
      final client = MockClient((req) async {
        capturedUrl = req.url.toString();
        capturedHeaders = req.headers;
        return http.Response('{"triggered":true}', 200);
      });

      await _aggregator(client).triggerIfDone('job-abc');

      expect(
        capturedUrl,
        'https://api.example.com/api/jobs/job-abc/aggregate-if-done',
      );
      expect(capturedHeaders['Authorization'], startsWith('Bearer '));
    });

    test('returns silently without posting when signed out', () async {
      var posted = false;
      final client = MockClient((req) async {
        posted = true;
        return http.Response('', 200);
      });

      await expectLater(
        _aggregator(client, signedIn: false).triggerIfDone('job'),
        completes,
      );
      expect(posted, isFalse);
    });

    test('swallows a 401 without throwing', () async {
      final client = MockClient(
        (req) async => http.Response('{"error":"Unauthorized"}', 401),
      );

      await expectLater(_aggregator(client).triggerIfDone('job'), completes);
    });
  });
}
