import 'dart:async';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/worker/sim_runner.dart';
import 'package:worker_flutter/worker/worker_engine.dart';

/// Cloud-mode `WorkerEngine` error paths. The happy-path is covered by
/// `worker_engine_test.dart`; the cases here pin the contract that
/// PENDING sims always end in a terminal state (COMPLETED / FAILED)
/// rather than being left stranded if the runner crashes or the job
/// doc disappears.
void main() {
  late FakeFirebaseFirestore firestore;
  late WorkerConfig config;

  setUp(() {
    firestore = FakeFirebaseFirestore();
    config = WorkerConfig(
      workerId: 'test-engine-worker',
      workerName: 'engine-test',
      maxCapacity: 1,
      forgePath: '/tmp/forge',
      javaPath: '/usr/bin/java',
      decksPath: '/tmp/decks',
      logsPath: '/tmp/logs',
      apiUrl: 'http://localhost',
      workerSecret: null,
    );
  });

  Future<String> seedJob({
    required String jobId,
    int simCount = 1,
    bool skipJobDoc = false,
  }) async {
    final jobRef = firestore.collection('jobs').doc(jobId);
    if (!skipJobDoc) {
      await jobRef.set({
        'status': 'QUEUED',
        'decks': [
          {'name': 'Alpha', 'dck': '[Main]\n'},
          {'name': 'Beta', 'dck': '[Main]\n'},
          {'name': 'Gamma', 'dck': '[Main]\n'},
          {'name': 'Delta', 'dck': '[Main]\n'},
        ],
        'createdAt': DateTime.now().toIso8601String(),
        'completedSimCount': 0,
        'totalSimCount': simCount,
        'simulations': simCount,
      });
    }
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

  test(
    'SimRunner throwing lands the sim in FAILED with error metadata',
    () async {
      // The engine's outer try/catch catches any exception from
      // `_runner.runOne()` and reports a terminal SimResult with the
      // exception's message — so the sim doesn't sit in RUNNING forever.
      // Without this safety net, a transient Java crash would strand
      // every sim it touched.
      final runner = _ThrowingSimRunner(error: StateError('java OOM'));
      final engine = WorkerEngine(
        config: config,
        firestore: firestore,
        runnerOverride: runner,
      );
      addTearDown(() async => engine.dispose());

      await seedJob(jobId: 'job-runner-throws');
      await engine.start();

      await _waitForCondition(() async {
        final sims = await firestore
            .collection('jobs')
            .doc('job-runner-throws')
            .collection('simulations')
            .get();
        return sims.docs.any((d) => d.data()['state'] != 'PENDING');
      }, timeout: const Duration(seconds: 3));

      final sims = await firestore
          .collection('jobs')
          .doc('job-runner-throws')
          .collection('simulations')
          .get();
      expect(sims.docs.length, 1);
      final terminalState = sims.docs.first.data()['state'];
      expect(
        terminalState,
        'FAILED',
        reason:
            'reportTerminal uses FAILED for unsuccessful results so the '
            'frontend can distinguish "ran but errored" from "ran ok"',
      );
      final err = sims.docs.first.data()['errorMessage'] as String?;
      expect(err, isNotNull);
      expect(
        err!,
        contains('java OOM'),
        reason:
            'the runner exception message must round-trip into Firestore '
            'so the dashboard / web UI can surface it to the user',
      );
    },
  );

  test('jobs/{id} missing → sim terminates with "job not found"', () async {
    // Real-world recovery: a sim doc can outlive its parent job if the
    // job was deleted (rare but possible — admin tooling, retention
    // sweeps, etc.). The engine has a `_loadJobInfo` null-check that
    // surfaces a clean error rather than throwing an NPE deep in the
    // claim path.
    await seedJob(jobId: 'job-orphan', skipJobDoc: true);

    final engine = WorkerEngine(
      config: config,
      firestore: firestore,
      runnerOverride: _NeverCalledSimRunner(),
    );
    addTearDown(() async => engine.dispose());

    await engine.start();
    await _waitForCondition(() async {
      final sims = await firestore
          .collection('jobs')
          .doc('job-orphan')
          .collection('simulations')
          .get();
      return sims.docs.any((d) => d.data()['state'] != 'PENDING');
    }, timeout: const Duration(seconds: 3));

    final sims = await firestore
        .collection('jobs')
        .doc('job-orphan')
        .collection('simulations')
        .get();
    expect(sims.docs.length, 1);
    final err = sims.docs.first.data()['errorMessage'] as String?;
    expect(
      err,
      contains('not found'),
      reason:
          'orphan sims must report the job-missing reason, not get '
          'silently swallowed (or worse, retried forever)',
    );
  });
}

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

class _ThrowingSimRunner extends SimRunner {
  _ThrowingSimRunner({required this.error})
    : super(javaPath: '/usr/bin/java', forgePath: '/tmp/forge');

  final Object error;

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    // ignore: only_throw_errors
    throw error;
  }
}

class _NeverCalledSimRunner extends SimRunner {
  _NeverCalledSimRunner()
    : super(javaPath: '/usr/bin/java', forgePath: '/tmp/forge');

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    throw StateError(
      'runOne must not be reached when the job doc is missing — the '
      'engine should short-circuit at _loadJobInfo',
    );
  }
}
