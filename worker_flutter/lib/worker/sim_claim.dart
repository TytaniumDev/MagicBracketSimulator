import 'package:cloud_firestore/cloud_firestore.dart';

import '../app_log.dart';
import '../models/sim.dart';
import '../telemetry.dart';

/// Result of an atomic claim attempt.
sealed class ClaimResult {}

class ClaimSucceeded extends ClaimResult {
  ClaimSucceeded(this.sim);
  final SimDoc sim;
}

class ClaimNoneAvailable extends ClaimResult {}

class ClaimLostRace extends ClaimResult {
  ClaimLostRace(this.reason);
  final String reason;
}

/// Job statuses whose PENDING sims are still claimable.
const _activeJobStatuses = ['QUEUED', 'RUNNING'];

/// Atomically flip the next PENDING sim to RUNNING for this worker.
///
/// Mirrors the API's `claimNextSim` (`api/lib/firestore-job-store.ts`),
/// but via the `cloud_firestore` SDK directly. The transactional
/// precondition (state == 'PENDING') is what makes this safe against
/// races with Docker workers also claiming via the API endpoint — both
/// paths run the same atomic Firestore transaction primitive.
///
/// Strategy: scan the oldest active (QUEUED/RUNNING) jobs, pick the
/// lowest-index PENDING sim of the first one that has any, then
/// transactionally re-read and flip. Going job-first means PENDING sims
/// left behind by deleted, FAILED, or CANCELLED jobs are never claimed
/// and can't crowd live work out of the scan window. If someone else
/// got there first the txn observes state != PENDING and returns
/// [ClaimLostRace] — caller should retry on the next listener tick.
class SimClaimer {
  SimClaimer({
    required this.firestore,
    required this.workerId,
    required this.workerName,
  });

  final FirebaseFirestore firestore;
  final String workerId;
  final String workerName;

  /// Try to claim one PENDING simulation. Single attempt — caller decides
  /// whether to retry.
  Future<ClaimResult> tryClaim() async {
    // Step 1: find the first PENDING sim of the oldest active job.
    // Uses the existing (status, createdAt) composite index on `jobs`.
    final candidate = await _findPendingSim();
    if (candidate == null) {
      return ClaimNoneAvailable();
    }

    final simRef = candidate.reference;
    final data = candidate.data();

    // Step 2: transactional claim with re-read. Logged before the call so
    // a native crash inside the transaction still leaves a trail.
    AppLog.event(
      TelemetryCategory.engineRuntime,
      'claim: transaction start',
      data: {'path': simRef.path},
    );
    try {
      return await firestore.runTransaction<ClaimResult>((tx) async {
        final fresh = await tx.get(simRef);
        if (!fresh.exists) {
          return ClaimLostRace('sim deleted between query and txn');
        }
        final freshData = fresh.data() as Map<String, dynamic>;
        if (freshData['state'] != 'PENDING') {
          return ClaimLostRace('state=${freshData['state']} at txn time');
        }
        tx.update(simRef, {
          'state': 'RUNNING',
          'workerId': workerId,
          'workerName': workerName,
          'startedAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });

        // jobId is the parent of the parent of the sim doc
        final jobId = simRef.parent.parent!.id;

        return ClaimSucceeded(
          SimDoc(
            simId: simRef.id,
            jobId: jobId,
            index: (data['index'] as num?)?.toInt() ?? 0,
            state: 'RUNNING',
            workerId: workerId,
            workerName: workerName,
          ),
        );
      });
    } on FirebaseException catch (e) {
      return ClaimLostRace('firestore: ${e.code}');
    } catch (e) {
      return ClaimLostRace('unexpected: $e');
    }
  }

  /// Scan up to 10 oldest active jobs for one with a PENDING sim and return
  /// its lowest-index PENDING sim, or null if none is available.
  ///
  /// Sims are fetched by index and filtered in memory (per-job sim count is
  /// small) to avoid a composite (state, index) index — same trade-off as
  /// the API's `claimNextSim`.
  Future<QueryDocumentSnapshot<Map<String, dynamic>>?> _findPendingSim() async {
    final jobs = await firestore
        .collection('jobs')
        .where('status', whereIn: _activeJobStatuses)
        .orderBy('createdAt')
        .limit(10)
        .get();

    for (final job in jobs.docs) {
      final jobData = job.data();
      if (jobData['source'] == 'flutter-local') continue;
      final completed = (jobData['completedSimCount'] as num?)?.toInt() ?? 0;
      final total = (jobData['totalSimCount'] as num?)?.toInt() ?? 0;
      if (total > 0 && completed >= total) continue;

      final sims = await job.reference
          .collection('simulations')
          .orderBy('index')
          .get();
      for (final sim in sims.docs) {
        if (sim.data()['state'] == 'PENDING') return sim;
      }
    }
    return null;
  }

  /// Report a sim's terminal state back to Firestore. Used after sim_runner
  /// completes. Mirrors the PATCH /api/jobs/:id/simulations/:simId logic
  /// but writes directly to Firestore.
  Future<void> reportTerminal({
    required SimDoc sim,
    required SimResult result,
  }) async {
    final docRef = firestore
        .collection('jobs')
        .doc(sim.jobId)
        .collection('simulations')
        .doc(sim.simId);

    final state = result.success ? 'COMPLETED' : 'FAILED';
    final update = <String, dynamic>{
      'state': state,
      'completedAt': FieldValue.serverTimestamp(),
      'durationMs': result.durationMs,
      'updatedAt': FieldValue.serverTimestamp(),
    };
    if (result.winners.isNotEmpty) {
      update['winners'] = result.winners;
      update['winner'] = result.winners.first;
    }
    if (result.winningTurns.isNotEmpty) {
      update['winningTurns'] = result.winningTurns;
      update['winningTurn'] = result.winningTurns.first;
    }
    if (result.errorMessage != null) {
      update['errorMessage'] = result.errorMessage;
    }

    await docRef.set(update, SetOptions(merge: true));

    // Bump the parent job's completedSimCount atomic counter for every
    // terminal write (COMPLETED, FAILED, or cancelled) so the aggregation
    // trigger fires when all sims finish. Otherwise a single FAILED sim
    // stalls the job forever — no later increment would catch up to
    // totalSimCount and aggregation would never fire.
    await firestore.collection('jobs').doc(sim.jobId).set({
      'completedSimCount': FieldValue.increment(1),
    }, SetOptions(merge: true));
  }
}
