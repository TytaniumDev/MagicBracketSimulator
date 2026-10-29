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
/// Handles claim-sim, lease extension, sim PATCH and log upload, and
/// records each call in [calls] (e.g. `patch sim-0 COMPLETED`) so tests can
/// assert on order.
class FakeSimApi {
  FakeSimApi(this.firestore);

  final FakeFirebaseFirestore firestore;

  /// Every handled request, in order.
  final List<String> calls = [];

  /// Bodies of sim PATCHes, in order.
  final List<Map<String, dynamic>> patches = [];

  /// What lease extensions answer.
  String leaseStatus = 'extended';

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
    // /api/jobs/:id/...
    final jobId = segments.length > 2 ? segments[2] : '';
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
