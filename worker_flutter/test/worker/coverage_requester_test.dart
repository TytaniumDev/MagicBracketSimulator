import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/coverage_requester.dart';

/// `CoverageRequester` throttles asks for auto-coverage jobs, because each
/// ask costs the API Firestore reads. These tests pin when an ask goes out
/// and that a failed ask never throws into the claim loop.
void main() {
  late DateTime now;
  late List<http.Request> requests;
  late http.Response Function() respond;

  CoverageRequester requester() => CoverageRequester(
    api: ApiClient(
      baseUrl: 'https://api.example.com',
      client: MockClient((req) async {
        requests.add(req);
        return respond();
      }),
      auth: MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
      ),
      appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
    ),
    minInterval: const Duration(minutes: 5),
    now: () => now,
  );

  http.Response created() =>
      http.Response(json.encode({'id': 'job-1', 'source': 'coverage'}), 201);
  http.Response noJob(String reason) =>
      http.Response(json.encode({'reason': reason}), 200);

  setUp(() {
    now = DateTime(2026, 10, 30, 12);
    requests = [];
    respond = () => noJob('all-pairs-covered');
  });

  test('posts to the coverage endpoint with the user token', () async {
    respond = created;
    expect(await requester().maybeRequest(), isTrue);

    final req = requests.single;
    expect(req.method, 'POST');
    expect(req.url.toString(), 'https://api.example.com/api/coverage/next-job');
    expect(req.headers['Authorization'], startsWith('Bearer '));
  });

  test('a reason means no job, and the next ask waits', () async {
    final coverage = requester();
    expect(await coverage.maybeRequest(), isFalse);

    now = now.add(const Duration(minutes: 4));
    expect(await coverage.maybeRequest(), isFalse);
    expect(requests, hasLength(1), reason: 'still inside the interval');

    now = now.add(const Duration(minutes: 1));
    expect(await coverage.maybeRequest(), isFalse);
    expect(requests, hasLength(2));
  });

  test('asks again at once after a job was created', () async {
    final coverage = requester();
    respond = created;
    expect(await coverage.maybeRequest(), isTrue);

    respond = () => noJob('active-job-exists');
    expect(await coverage.maybeRequest(), isFalse);
    expect(requests, hasLength(2));

    expect(await coverage.maybeRequest(), isFalse);
    expect(requests, hasLength(2), reason: 'no job, so the interval applies');
  });

  test('a failed ask returns false and waits out the interval', () async {
    final coverage = requester();
    respond = () => http.Response(json.encode({'error': 'boom'}), 500);
    expect(await coverage.maybeRequest(), isFalse);

    expect(await coverage.maybeRequest(), isFalse);
    expect(requests, hasLength(1));
  });
}
