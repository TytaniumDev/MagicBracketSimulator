import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/worker/sim_claim.dart';

/// Unit tests for SimClaimer.tryClaim and reportTerminal using
/// fake_cloud_firestore so no real Firebase project is required.
void main() {
  group('SimClaimer.tryClaim', () {
    late FakeFirebaseFirestore firestore;
    late SimClaimer claimer;

    setUp(() {
      firestore = FakeFirebaseFirestore();
      claimer = SimClaimer(
        firestore: firestore,
        workerId: 'w1',
        workerName: 'test-worker',
      );
    });

    test('returns ClaimNoneAvailable when no PENDING sims exist', () async {
      final result = await claimer.tryClaim();
      expect(result, isA<ClaimNoneAvailable>());
    });

    test(
      'claims a PENDING sim and flips it to RUNNING with workerId',
      () async {
        final jobRef = await seedJob(firestore, 'job1');
        await seedSim(jobRef, 'sim1', index: 0);

        final result = await claimer.tryClaim();
        expect(result, isA<ClaimSucceeded>());
        final claimed = (result as ClaimSucceeded).sim;
        expect(claimed.simId, 'sim1');
        expect(claimed.jobId, 'job1');
        expect(claimed.workerId, 'w1');

        // Verify Firestore was updated.
        final fresh = await jobRef.collection('simulations').doc('sim1').get();
        expect(fresh.data()!['state'], 'RUNNING');
        expect(fresh.data()!['workerId'], 'w1');
        expect(fresh.data()!['workerName'], 'test-worker');
      },
    );

    test('promotes a QUEUED job to RUNNING on its first claim', () async {
      final jobRef = await seedJob(firestore, 'job1');
      await seedSim(jobRef, 'sim1', index: 0);

      await claimer.tryClaim();

      final job = (await jobRef.get()).data()!;
      expect(job['status'], 'RUNNING');
      expect(job['workerId'], 'w1');
      expect(job['workerName'], 'test-worker');
      expect(job['startedAt'], isNotNull);
      expect(job['claimedAt'], isNotNull);
    });

    test('leaves an already RUNNING job untouched', () async {
      final jobRef = await seedJob(firestore, 'job1', status: 'RUNNING');
      await seedSim(jobRef, 'sim1', index: 0);

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimSucceeded>());

      final job = (await jobRef.get()).data()!;
      expect(job['status'], 'RUNNING');
      expect(job.containsKey('startedAt'), isFalse);
      expect(job.containsKey('workerId'), isFalse);
    });

    test('picks a sim from the oldest active job', () async {
      final newerJob = await seedJob(
        firestore,
        'job-a',
        createdAt: DateTime(2026, 1, 2),
      );
      final olderJob = await seedJob(
        firestore,
        'job-b',
        createdAt: DateTime(2026, 1, 1),
      );
      await seedSim(newerJob, 's1', index: 0);
      await seedSim(olderJob, 's2', index: 0);

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimSucceeded>());
      expect((result as ClaimSucceeded).sim.simId, 's2');
    });

    test('picks the lowest-index PENDING sim within a job', () async {
      final jobRef = await seedJob(firestore, 'job1');
      await seedSim(jobRef, 's0', index: 0, state: 'COMPLETED');
      await seedSim(jobRef, 's2', index: 2);
      await seedSim(jobRef, 's1', index: 1);

      final result = await claimer.tryClaim();
      expect((result as ClaimSucceeded).sim.simId, 's1');
      expect(result.sim.index, 1);
    });

    test('does not return COMPLETED or FAILED sims', () async {
      final jobRef = await seedJob(firestore, 'j');
      await seedSim(jobRef, 's1', index: 0, state: 'COMPLETED');
      await seedSim(jobRef, 's2', index: 1, state: 'FAILED');

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimNoneAvailable>());
    });

    test('skips PENDING sims whose job is FAILED or CANCELLED', () async {
      final failed = await seedJob(
        firestore,
        'failed',
        status: 'FAILED',
        createdAt: DateTime(2026, 1, 1),
      );
      final cancelled = await seedJob(
        firestore,
        'cancelled',
        status: 'CANCELLED',
        createdAt: DateTime(2026, 1, 1),
      );
      final live = await seedJob(
        firestore,
        'live',
        createdAt: DateTime(2026, 1, 3),
      );
      await seedSim(failed, 'stale1', index: 0);
      await seedSim(cancelled, 'stale2', index: 0);
      await seedSim(live, 'fresh', index: 0);

      final result = await claimer.tryClaim();
      expect((result as ClaimSucceeded).sim.jobId, 'live');
    });

    test('skips orphaned PENDING sims whose job doc was deleted', () async {
      await seedSim(
        firestore.collection('jobs').doc('gone'),
        'orphan',
        index: 0,
      );

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimNoneAvailable>());
    });

    test('skips flutter-local jobs', () async {
      final local = await seedJob(
        firestore,
        'local',
        source: 'flutter-local',
        createdAt: DateTime(2026, 1, 1),
      );
      final cloud = await seedJob(
        firestore,
        'cloud',
        createdAt: DateTime(2026, 1, 2),
      );
      await seedSim(local, 'l0', index: 0);
      await seedSim(cloud, 'c0', index: 0);

      final result = await claimer.tryClaim();
      expect((result as ClaimSucceeded).sim.jobId, 'cloud');
    });
  });

  group('SimClaimer.reportTerminal', () {
    late FakeFirebaseFirestore firestore;
    late SimClaimer claimer;
    late SimDoc sim;

    setUp(() async {
      firestore = FakeFirebaseFirestore();
      claimer = SimClaimer(
        firestore: firestore,
        workerId: 'w1',
        workerName: 'test-worker',
      );
      sim = SimDoc(
        simId: 'sim1',
        jobId: 'job1',
        index: 0,
        state: 'RUNNING',
        workerId: 'w1',
        workerName: 'test-worker',
      );
      // Seed Firestore with the sim in RUNNING state.
      await firestore
          .collection('jobs')
          .doc('job1')
          .collection('simulations')
          .doc('sim1')
          .set({
            'simId': 'sim1',
            'index': 0,
            'state': 'RUNNING',
            'workerId': 'w1',
            'workerName': 'test-worker',
          });
      await firestore.collection('jobs').doc('job1').set({
        'jobId': 'job1',
        'completedSimCount': 0,
      });
    });

    test(
      'marks sim COMPLETED and increments completedSimCount on success',
      () async {
        await claimer.reportTerminal(
          sim: sim,
          result: SimResult(
            success: true,
            durationMs: 5000,
            winners: ['Ai(1)-Alpha'],
            winningTurns: [12],
            logText: 'log text',
          ),
        );

        final fresh = await firestore
            .collection('jobs')
            .doc('job1')
            .collection('simulations')
            .doc('sim1')
            .get();
        expect(fresh.data()!['state'], 'COMPLETED');
        expect(fresh.data()!['durationMs'], 5000);
        expect(fresh.data()!['winners'], ['Ai(1)-Alpha']);
        expect(fresh.data()!['winningTurns'], [12]);

        final job = await firestore.collection('jobs').doc('job1').get();
        expect(job.data()!['completedSimCount'], 1);
      },
    );

    test('marks sim FAILED with errorMessage on failure', () async {
      await claimer.reportTerminal(
        sim: sim,
        result: SimResult(
          success: false,
          durationMs: 1000,
          winners: const [],
          winningTurns: const [],
          logText: 'partial log',
          errorMessage: 'java crashed',
        ),
      );

      final fresh = await firestore
          .collection('jobs')
          .doc('job1')
          .collection('simulations')
          .doc('sim1')
          .get();
      expect(fresh.data()!['state'], 'FAILED');
      expect(fresh.data()!['errorMessage'], 'java crashed');

      // completedSimCount IS incremented on failure: the Flutter worker
      // writes terminal state directly to Firestore (no API retry path),
      // so a FAILED sim is final from the worker's perspective. Failing to
      // increment would leave the job stuck until the API-side stale-sweeper
      // takes 2h to convert FAILED -> CANCELLED.
      final job = await firestore.collection('jobs').doc('job1').get();
      expect(job.data()!['completedSimCount'], 1);
    });
  });
}

/// Seed an active job doc. Defaults match a freshly queued cloud job.
Future<DocumentReference<Map<String, dynamic>>> seedJob(
  FakeFirebaseFirestore firestore,
  String jobId, {
  String status = 'QUEUED',
  String source = 'user',
  DateTime? createdAt,
}) async {
  final ref = firestore.collection('jobs').doc(jobId);
  await ref.set({
    'status': status,
    'source': source,
    'createdAt': createdAt ?? DateTime(2026, 1, 1),
    'completedSimCount': 0,
    'totalSimCount': 25,
  });
  return ref;
}

/// Seed a sim doc under [jobRef].
Future<void> seedSim(
  DocumentReference<Map<String, dynamic>> jobRef,
  String simId, {
  required int index,
  String state = 'PENDING',
}) {
  return jobRef.collection('simulations').doc(simId).set({
    'simId': simId,
    'index': index,
    'state': state,
    'createdAt': DateTime(2026, 1, 1),
  });
}
