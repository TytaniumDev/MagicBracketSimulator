import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/sim.dart';

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

/// Atomically flip the oldest PENDING sim to RUNNING for this worker.
///
/// Mirrors the API's `/api/jobs/claim-sim` endpoint, but via the
/// `cloud_firestore` SDK directly. The transactional precondition
/// (state == 'PENDING') is what makes this safe against races with
/// Docker workers also claiming via the API endpoint — both paths run
/// the same atomic Firestore transaction primitive.
///
/// Strategy: query for oldest PENDING sim across all jobs ordered by
/// `createdAt`, then transactionally re-read and flip. If someone else
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
    // Step 1: find a PENDING sim across all jobs.
    // We use a collectionGroup query so we don't have to know which job
    // the sim belongs to up front. Requires a collectionGroup index on
    // `simulations.state` which the existing app already has.
    final snapshot = await firestore
        .collectionGroup('simulations')
        .where('state', isEqualTo: 'PENDING')
        .orderBy('createdAt')
        .limit(1)
        .get();

    if (snapshot.docs.isEmpty) {
      return ClaimNoneAvailable();
    }

    final candidate = snapshot.docs.first;
    final simRef = candidate.reference;
    final data = candidate.data();

    // Step 2: transactional claim with re-read.
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

        return ClaimSucceeded(SimDoc(
          simId: simRef.id,
          jobId: jobId,
          index: (data['index'] as num?)?.toInt() ?? 0,
          state: 'RUNNING',
          workerId: workerId,
          workerName: workerName,
        ));
      });
    } on FirebaseException catch (e) {
      return ClaimLostRace('firestore: ${e.code}');
    } catch (e) {
      return ClaimLostRace('unexpected: $e');
    }
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

    // Bump the parent job's completedSimCount atomic counter so the
    // existing API-side aggregation trigger fires when all sims finish.
    // Same field the Docker worker increments via the API.
    if (result.success) {
      await firestore.collection('jobs').doc(sim.jobId).set({
        'completedSimCount': FieldValue.increment(1),
      }, SetOptions(merge: true));
    }
  }
}
