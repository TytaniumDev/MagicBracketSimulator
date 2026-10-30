import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worker_flutter/api_client.dart';
import 'package:worker_flutter/worker/worker_presence.dart';

/// In-memory stand-in for the API endpoints the worker engine calls, backed
/// by a [FakeFirebaseFirestore] so tests can seed jobs and read sims back
/// the way the real API stores them.
///
/// Handles claim-sim, the job worker view, lease extension, sim PATCH, log
/// upload and coverage requests. Records each sim call in [calls] (e.g.
/// `patch sim-0 COMPLETED`) so tests can assert on order; coverage requests
/// are only counted, in [coverageRequests], because an idle engine makes
/// them at times that depend on scheduling.
class FakeSimApi {
  FakeSimApi(this.firestore);

  final FakeFirebaseFirestore firestore;

  /// Every handled request, in order.
  final List<String> calls = [];

  /// Bodies of sim PATCHes, in order.
  final List<Map<String, dynamic>> patches = [];

  /// What lease extensions answer.
  String leaseStatus = 'extended';

  /// How many coverage jobs were asked for.
  int coverageRequests = 0;

  /// Answers `POST /api/coverage/next-job`: `{id}` for a created job (sent
  /// as 201) or `{reason}` when there is nothing to do.
  Future<Map<String, dynamic>> Function() coverageHandler = () async => {
    'reason': 'disabled',
  };

  late final ApiClient client = ApiClient(
    baseUrl: 'https://api.test',
    client: MockClient(_handle),
    auth: MockFirebaseAuth(
      signedIn: true,
      mockUser: MockUser(uid: 'u1', email: 'u1@example.com'),
    ),
    appCheckTokenProvider: ({bool forceRefresh = false}) async => null,
  );

  Future<http.Response> _handle(http.Request req) async {
    final segments = req.url.pathSegments;
    if (req.method == 'GET' && req.url.path == '/api/jobs/claim-sim') {
      return _claim(req.url.queryParameters);
    }
    if (req.method == 'POST' && req.url.path == '/api/coverage/next-job') {
      coverageRequests++;
      final answer = await coverageHandler();
      return http.Response(
        json.encode(answer),
        answer['id'] is String ? 201 : 200,
      );
    }
    // /api/jobs/:id/...
    final jobId = segments.length > 2 ? segments[2] : '';
    if (req.method == 'GET' &&
        segments.length == 3 &&
        req.url.queryParameters['view'] == 'worker') {
      return _workerView(jobId);
    }
    final body = req.body.isEmpty
        ? <String, dynamic>{}
        : json.decode(req.body) as Map<String, dynamic>;
    if (req.method == 'POST' && segments.last == 'lease') {
      calls.add('lease ${segments[4]}');
      return http.Response(json.encode({'status': leaseStatus}), 200);
    }
    if (req.method == 'PATCH' && segments.length == 5) {
      final simId = segments[4];
      calls.add('patch $simId ${body['state']}');
      patches.add(body);
      await _sim(jobId, simId).set({
        for (final e in body.entries)
          if (e.key != 'workerId') e.key: e.value,
      }, SetOptions(merge: true));
      return http.Response(json.encode({'updated': true}), 200);
    }
    if (req.method == 'POST' && segments.last == 'simulation') {
      calls.add('upload ${body['filename']}');
      return http.Response(json.encode({'success': true}), 200);
    }
    return http.Response(json.encode({'error': 'not found'}), 404);
  }

  /// The job doc as the API's worker view returns it (seeded decks already
  /// carry their `dck` content).
  Future<http.Response> _workerView(String jobId) async {
    calls.add('job $jobId');
    final job = await firestore.collection('jobs').doc(jobId).get();
    final data = job.data();
    if (data == null) {
      return http.Response(json.encode({'error': 'Job not found'}), 404);
    }
    return http.Response(
      json.encode({
        'id': jobId,
        'simulations': data['simulations'],
        'decks': data['decks'],
      }),
      200,
    );
  }

  /// Mirrors the API's claimNextSim: the lowest-index PENDING sim of the
  /// oldest QUEUED/RUNNING job.
  Future<http.Response> _claim(Map<String, String> query) async {
    final jobs = await firestore
        .collection('jobs')
        .where('status', whereIn: ['QUEUED', 'RUNNING'])
        .orderBy('createdAt')
        .get();
    for (final job in jobs.docs) {
      final sims = await job.reference
          .collection('simulations')
          .orderBy('index')
          .get();
      for (final sim in sims.docs) {
        if (sim.data()['state'] != 'PENDING') continue;
        await sim.reference.update({
          'state': 'RUNNING',
          'workerId': query['workerId'],
          'workerName': query['workerName'],
        });
        calls.add('claim ${sim.id}');
        return http.Response(
          json.encode({
            'jobId': job.id,
            'simId': sim.id,
            'simIndex': sim.data()['index'],
          }),
          200,
        );
      }
    }
    return http.Response('', 204);
  }

  DocumentReference<Map<String, dynamic>> _sim(String jobId, String simId) =>
      firestore
          .collection('jobs')
          .doc(jobId)
          .collection('simulations')
          .doc(simId);
}

/// Records presence writes instead of sending them to the Realtime Database.
class FakePresenceSink implements PresenceSink {
  final connectedController = StreamController<bool>.broadcast();
  final List<Map<String, Object?>> writes = [];
  int removes = 0;
  int disconnectArms = 0;

  @override
  Stream<bool> get connected => connectedController.stream;

  @override
  Future<void> removeOnDisconnect() async => disconnectArms++;

  @override
  Future<void> write(Map<String, Object?> fields) async => writes.add(fields);

  @override
  Future<void> remove() async => removes++;
}
