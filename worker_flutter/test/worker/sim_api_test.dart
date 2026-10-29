import 'dart:convert';

import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/worker/sim_api.dart';

/// Unit tests for SimApi: the request each call sends and how it reads the
/// API's answer. The API side is covered by api/lib/claim-sim.test.ts.
void main() {
  late List<http.Request> requests;
  late http.Response Function(http.Request) respond;

  SimApi simApi() => SimApi(
    api: ApiClient(
      baseUrl: 'https://api.test',
      client: MockClient((req) async {
        requests.add(req);
        return respond(req);
      }),
      auth: MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
      ),
      appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
    ),
    workerId: 'w1',
    workerName: 'my mac',
  );

  final sim = SimDoc(
    simId: 'sim_002',
    jobId: 'job1',
    index: 2,
    state: 'RUNNING',
  );

  setUp(() {
    requests = [];
    respond = (_) => http.Response('{}', 200);
  });

  group('claim', () {
    test('asks for a leased claim and returns the sim', () async {
      respond = (_) => http.Response(
        json.encode({'jobId': 'job1', 'simId': 'sim_002', 'simIndex': 2}),
        200,
      );

      final result = await simApi().claim();

      final url = requests.single.url;
      expect(requests.single.method, 'GET');
      expect(url.path, '/api/jobs/claim-sim');
      expect(url.queryParameters, {
        'workerId': 'w1',
        'workerName': 'my mac',
        'lease': '1',
      });
      expect(requests.single.headers['Authorization'], startsWith('Bearer '));
      final claimed = (result as ClaimSucceeded).sim;
      expect(claimed.jobId, 'job1');
      expect(claimed.simId, 'sim_002');
      expect(claimed.index, 2);
      expect(claimed.workerId, 'w1');
    });

    test('204 means no work', () async {
      respond = (_) => http.Response('', 204);
      expect(await simApi().claim(), isA<ClaimNoneAvailable>());
    });

    test('an API error throws', () async {
      respond = (_) => http.Response('{"error":"boom"}', 500);
      await expectLater(simApi().claim(), throwsA(isA<ApiException>()));
    });
  });

  group('extendLease', () {
    for (final (answer, status) in [
      ('extended', SimLeaseStatus.extended),
      ('cancelled', SimLeaseStatus.cancelled),
      ('lost', SimLeaseStatus.lost),
    ]) {
      test('reads "$answer"', () async {
        respond = (_) => http.Response(json.encode({'status': answer}), 200);

        expect(await simApi().extendLease(sim), status);
        expect(requests.single.method, 'POST');
        expect(
          requests.single.url.path,
          '/api/jobs/job1/simulations/sim_002/lease',
        );
        expect(json.decode(requests.single.body), {'workerId': 'w1'});
      });
    }
  });

  group('reports', () {
    test('a successful run reports COMPLETED with its winners', () async {
      await simApi().reportResult(
        sim,
        SimResult(
          success: true,
          durationMs: 1234,
          winners: const ['Ai(1)-Alpha', 'Ai(2)-Beta'],
          winningTurns: const [7, 9],
          logText: 'log',
        ),
      );

      expect(requests.single.method, 'PATCH');
      expect(requests.single.url.path, '/api/jobs/job1/simulations/sim_002');
      expect(json.decode(requests.single.body), {
        'workerId': 'w1',
        'state': 'COMPLETED',
        'durationMs': 1234,
        'winners': ['Ai(1)-Alpha', 'Ai(2)-Beta'],
        'winningTurns': [7, 9],
      });
    });

    test('a failed run reports FAILED with its error', () async {
      await simApi().reportResult(
        sim,
        SimResult(
          success: false,
          durationMs: 10,
          winners: const [],
          winningTurns: const [],
          logText: '',
          errorMessage: 'java exited 1',
        ),
      );

      expect(json.decode(requests.single.body), {
        'workerId': 'w1',
        'state': 'FAILED',
        'durationMs': 10,
        'errorMessage': 'java exited 1',
      });
    });

    test('reportCancelled reports CANCELLED', () async {
      await simApi().reportCancelled(sim, durationMs: 50);

      expect(json.decode(requests.single.body), {
        'workerId': 'w1',
        'state': 'CANCELLED',
        'durationMs': 50,
      });
    });
  });
}
