import 'dart:async';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/worker/sim_runner.dart';
import 'package:worker_flutter/worker/worker_engine.dart';

import 'fake_sim_api.dart';

/// Integration tests for the cloud-mode `WorkerEngine` against an
/// in-memory fake Firestore. Covers the same code path the real
/// worker takes when the web frontend queues a new bracket — the
/// `collectionGroup('simulations')` listener firing on a PENDING
/// state change drives the claim loop.
void main() {
  late FakeFirebaseFirestore firestore;
  late FakeSimApi api;
  late _StubSimRunner stubRunner;
  late WorkerEngine engine;
  late WorkerConfig config;

  setUp(() {
    firestore = FakeFirebaseFirestore();
    api = FakeSimApi(firestore);
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
    );
    engine = WorkerEngine(
      config: config,
      firestore: firestore,
      apiClient: api.client,
      presenceSink: FakePresenceSink(),
      runnerOverride: stubRunner,
      leaseInterval: const Duration(milliseconds: 50),
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

  group('setMaxCapacity', () {
    test('raising the cap claims more sims without a restart', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final gate = Completer<void>();
      stubRunner.gate = gate.future;
      config.maxCapacity = 1;

      await seedJob(jobId: 'job3', simCount: 3);
      await engine.start();
      await _waitForCondition(
        () async => stubRunner.invocations >= 1,
        timeout: const Duration(seconds: 3),
      );
      // Give the claim loop a chance to over-claim if the cap were ignored.
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(stubRunner.invocations, 1, reason: 'cap of 1 holds');

      await engine.setMaxCapacity(3);
      await _waitForCondition(
        () async => stubRunner.invocations >= 3,
        timeout: const Duration(seconds: 3),
      );
      expect(stubRunner.invocations, 3);
      expect(config.maxCapacity, 3);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('worker.capacity'), 3);

      gate.complete();
    });

    test('overlapping triggers never claim past the cap', () async {
      // Two claim loops running at once both pass the capacity check
      // before either claim lands, and start two Firestore transactions
      // in parallel (a native crash on Windows). Triggers that arrive
      // mid-loop must fold into the running loop instead.
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final gate = Completer<void>();
      stubRunner.gate = gate.future;

      await seedJob(jobId: 'job4', simCount: 5);
      await engine.start();
      await _waitForCondition(
        () async => stubRunner.invocations >= 2,
        timeout: const Duration(seconds: 3),
      );

      await Future.wait([engine.setMaxCapacity(3), engine.setMaxCapacity(3)]);
      await _waitForCondition(
        () async => stubRunner.invocations >= 3,
        timeout: const Duration(seconds: 3),
      );
      // Give a second, overlapping loop time to over-claim.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(stubRunner.invocations, 3, reason: 'cap of 3 holds');

      gate.complete();
    });
  });

  group('reporting through the API', () {
    test('uploads the log before reporting the result', () async {
      await seedJob(jobId: 'job5', simCount: 1);
      await engine.start();
      await _waitForCondition(
        () async => api.calls.any((c) => c.startsWith('patch')),
        timeout: const Duration(seconds: 3),
      );

      expect(api.calls, [
        'claim sim-0',
        'upload raw/game_001.txt',
        'patch sim-0 COMPLETED',
      ], reason: 'aggregation on the last report reads the uploaded logs');
      expect(api.patches.single['workerId'], 'test-engine-worker');
      expect(api.patches.single['winners'], ['Ai(1)-Alpha']);
      expect(api.patches.single['winningTurns'], [7]);
    });

    test('extends the lease while a sim runs', () async {
      final gate = Completer<void>();
      stubRunner.gate = gate.future;
      await seedJob(jobId: 'job6', simCount: 1);
      await engine.start();
      await _waitForCondition(
        () async => api.calls.where((c) => c == 'lease sim-0').length >= 2,
        timeout: const Duration(seconds: 3),
      );
      gate.complete();
    });

    test('a cancelled lease stops the sim and reports CANCELLED', () async {
      stubRunner.waitForCancel = true;
      api.leaseStatus = 'cancelled';
      await seedJob(jobId: 'job7', simCount: 1);
      await engine.start();
      await _waitForCondition(
        () async => api.calls.contains('patch sim-0 CANCELLED'),
        timeout: const Duration(seconds: 3),
      );
      expect(
        api.calls.where((c) => c.startsWith('upload')),
        isEmpty,
        reason: 'a cancelled sim has no games to keep',
      );
    });

    test('a lost lease stops the sim without reporting', () async {
      stubRunner.waitForCancel = true;
      api.leaseStatus = 'lost';
      await seedJob(jobId: 'job8', simCount: 1);
      await engine.start();
      await _waitForCondition(
        () async =>
            engine.currentState.activeSims.isEmpty &&
            stubRunner.invocations == 1,
        timeout: const Duration(seconds: 3),
      );
      // Leave time for a stray report to land.
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(
        api.calls.where((c) => c.startsWith('patch') || c.startsWith('upload')),
        isEmpty,
        reason: 'the sim belongs to another worker now',
      );
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

  /// When set, each run blocks until this completes, so tests can hold
  /// sims "in flight" and observe the concurrency cap.
  Future<void>? gate;

  /// When true, each run blocks until the engine cancels it, then returns
  /// the runner's cancelled result.
  bool waitForCancel = false;

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    invocations++;
    if (gate != null) await gate;
    if (waitForCancel) {
      await cancelSignal;
      return SimResult(
        success: false,
        durationMs: 5,
        winners: const [],
        winningTurns: const [],
        logText: 'partial',
        errorMessage: 'cancelled',
      );
    }
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
