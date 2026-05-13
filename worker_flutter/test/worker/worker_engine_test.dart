import 'dart:async';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/worker/sim_runner.dart';
import 'package:worker_flutter/worker/worker_engine.dart';

/// Integration tests for the cloud-mode `WorkerEngine` against an
/// in-memory fake Firestore. Covers the same code path the real
/// worker takes when the web frontend queues a new bracket — the
/// `collectionGroup('simulations')` listener firing on a PENDING
/// state change drives the claim loop.
void main() {
  late FakeFirebaseFirestore firestore;
  late _StubSimRunner stubRunner;
  late WorkerEngine engine;
  late WorkerConfig config;

  setUp(() {
    firestore = FakeFirebaseFirestore();
    stubRunner = _StubSimRunner();
    config = WorkerConfig(
      workerId: 'test-engine-worker',
      workerName: 'engine-test',
      maxCapacity: 2,
      forgePath: '/tmp/forge',
      javaPath: '/usr/bin/java',
      decksPath: '/tmp/decks',
      logsPath: '/tmp/logs',
      apiUrl: 'http://localhost',
      workerSecret: null,
    );
    engine = WorkerEngine(
      config: config,
      firestore: firestore,
      runnerOverride: stubRunner,
    );
  });

  tearDown(() async {
    await engine.dispose();
  });

  /// Build a JOB doc + its `simulations` subcollection. Returns the
  /// jobId so tests can also read it back.
  Future<String> seedJob({
    required String jobId,
    required int simCount,
    List<Map<String, String>> decks = const [
      {'name': 'Alpha', 'dck': '[Main]\n'},
      {'name': 'Beta', 'dck': '[Main]\n'},
      {'name': 'Gamma', 'dck': '[Main]\n'},
      {'name': 'Delta', 'dck': '[Main]\n'},
    ],
  }) async {
    final jobRef = firestore.collection('jobs').doc(jobId);
    await jobRef.set({
      'status': 'QUEUED',
      'decks': decks,
      'createdAt': DateTime.now().toIso8601String(),
      'completedSimCount': 0,
      'totalSimCount': simCount,
      'simulations': simCount,
    });
    final now = DateTime.now();
    for (var i = 0; i < simCount; i++) {
      await jobRef.collection('simulations').doc('sim-$i').set({
        'simId': 'sim-$i',
        'index': i,
        'state': 'PENDING',
        'createdAt': now.add(Duration(microseconds: i)),
      });
    }
    return jobId;
  }

  group('PENDING listener', () {
    test('claims and runs sims as soon as they appear', () async {
      // The listener fires on subscription too (initial snapshot), so
      // pre-seeded data is picked up.
      await seedJob(jobId: 'job1', simCount: 2);
      await engine.start();

      // Give the listener + claim transactions a moment to flow.
      await _waitForCondition(
        () async => stubRunner.invocations >= 2,
        timeout: const Duration(seconds: 3),
      );

      expect(
        stubRunner.invocations,
        2,
        reason: 'both PENDING sims should be claimed and run',
      );

      // Verify the sims terminated in Firestore with the right shape.
      final sims = await firestore
          .collection('jobs')
          .doc('job1')
          .collection('simulations')
          .get();
      expect(sims.docs.length, 2);
      final states = sims.docs.map((d) => d.data()['state']).toSet();
      expect(states, {
        'COMPLETED',
      }, reason: 'every sim should land in COMPLETED');
    });

    // NOTE: A "new PENDING sim arrives AFTER engine.start()" test
    // belongs here in principle — that's the actual cloud-mode signal
    // path. We don't have it because fake_cloud_firestore doesn't
    // re-fire collectionGroup snapshots on subcollection inserts; the
    // production Firestore SDK does. End-to-end coverage of the
    // reactive path requires the Firebase emulator (separate test
    // tier) or a real Firestore instance.

    test('claim races: two sims, capacity 2, both processed', () async {
      // Capacity is 2 so both can run concurrently.
      await seedJob(jobId: 'job2', simCount: 4);
      await engine.start();
      await _waitForCondition(
        () async => stubRunner.invocations >= 4,
        timeout: const Duration(seconds: 5),
      );
      expect(stubRunner.invocations, 4);
    });
  });
}

/// Block until [check] returns true. Polls every 20ms.
Future<void> _waitForCondition(
  Future<bool> Function() check, {
  required Duration timeout,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (await check()) return;
    await Future.delayed(const Duration(milliseconds: 20));
  }
  throw TimeoutException('condition not met within $timeout');
}

/// A SimRunner stand-in that immediately returns success without
/// spawning Java. Counts invocations so tests can assert on them.
class _StubSimRunner extends SimRunner {
  _StubSimRunner() : super(javaPath: '/usr/bin/java', forgePath: '/tmp/forge');

  int invocations = 0;

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    invocations++;
    return SimResult(
      success: true,
      durationMs: 10,
      winners: const ['Ai(1)-Alpha'],
      winningTurns: const [7],
      logText: 'stub run',
      errorMessage: null,
    );
  }
}
