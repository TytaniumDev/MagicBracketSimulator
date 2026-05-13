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

    test('claims a PENDING sim and flips it to RUNNING with workerId', () async {
      final now = DateTime.now();
      final jobRef = firestore.collection('jobs').doc('job1');
      await jobRef.collection('simulations').doc('sim1').set({
        'simId': 'sim1',
        'index': 0,
        'state': 'PENDING',
        'createdAt': now,
      });

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
    });

    test('picks the oldest PENDING sim across multiple jobs', () async {
      final older = DateTime(2026, 1, 1);
      final newer = DateTime(2026, 1, 2);
      await firestore
          .collection('jobs').doc('job-a').collection('simulations').doc('s1')
          .set({'simId': 's1', 'index': 0, 'state': 'PENDING', 'createdAt': newer});
      await firestore
          .collection('jobs').doc('job-b').collection('simulations').doc('s2')
          .set({'simId': 's2', 'index': 0, 'state': 'PENDING', 'createdAt': older});

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimSucceeded>());
      expect((result as ClaimSucceeded).sim.simId, 's2');
    });

    test('does not return COMPLETED or FAILED sims', () async {
      final now = DateTime.now();
      await firestore
          .collection('jobs').doc('j').collection('simulations').doc('s1')
          .set({'simId': 's1', 'index': 0, 'state': 'COMPLETED', 'createdAt': now});
      await firestore
          .collection('jobs').doc('j').collection('simulations').doc('s2')
          .set({'simId': 's2', 'index': 1, 'state': 'FAILED', 'createdAt': now});

      final result = await claimer.tryClaim();
      expect(result, isA<ClaimNoneAvailable>());
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
          .collection('jobs').doc('job1').collection('simulations').doc('sim1')
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

    test('marks sim COMPLETED and increments completedSimCount on success', () async {
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
          .collection('jobs').doc('job1').collection('simulations').doc('sim1').get();
      expect(fresh.data()!['state'], 'COMPLETED');
      expect(fresh.data()!['durationMs'], 5000);
      expect(fresh.data()!['winners'], ['Ai(1)-Alpha']);
      expect(fresh.data()!['winningTurns'], [12]);

      final job = await firestore.collection('jobs').doc('job1').get();
      expect(job.data()!['completedSimCount'], 1);
    });

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
          .collection('jobs').doc('job1').collection('simulations').doc('sim1').get();
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
