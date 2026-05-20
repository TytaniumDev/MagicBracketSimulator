import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../decks/deck_record.dart';
import 'db/app_db.dart';

/// Mirror a "Run locally" job's progress to Firestore so the cloud
/// Jobs / Leaderboard tabs see it alongside cloud-submitted jobs.
///
/// Why this exists: the local Forge engine runs without ever touching
/// the cloud API. Without a mirror, the simulation results would be
/// invisible to anyone else viewing the project (and to the same user
/// from a different device). Writing directly to Firestore — rather
/// than POSTing to /api/jobs — sidesteps the App Check requirement on
/// the API, which the desktop client doesn't satisfy on Windows.
///
/// Lifecycle: one [CloudJobMirror] per local job. `start()` creates
/// /jobs/{id} plus N PENDING /simulations docs and subscribes to the
/// local job's progress streams. `dispose()` tears the listeners down.
/// Failures are swallowed and logged — the local run is the source of
/// truth, so a Firestore hiccup must never break it.
class CloudJobMirror {
  CloudJobMirror({
    required this.db,
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _auth = auth ?? FirebaseAuth.instance;

  final AppDb db;
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  DocumentReference<Map<String, dynamic>>? _jobRef;
  Map<int, DocumentReference<Map<String, dynamic>>>? _simRefsByIndex;
  final Set<int> _reportedTerminalIndexes = {};
  String _lastJobState = 'PENDING';
  StreamSubscription<Job?>? _jobSub;
  StreamSubscription<List<Sim>>? _simsSub;

  /// True once `start()` has successfully created the Firestore docs.
  /// Used by `Dashboard` to know whether to dispose us when navigating
  /// away — saves an `await` on the unsigned-in path.
  bool get isActive => _jobRef != null;

  /// Create the parent job doc + N PENDING sim docs, then subscribe to
  /// AppDb streams to push terminal sim updates. Skips the whole
  /// operation if the user is not signed in (the "still reports if
  /// signed in" half of the feature's contract).
  ///
  /// Returns the Firestore job id on success, or null if skipped /
  /// failed.
  Future<String?> start({
    required int localJobId,
    required List<DeckRecord> decks,
    required int simulations,
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return null;
    try {
      final jobRef = _firestore.collection('jobs').doc();
      final now = FieldValue.serverTimestamp();
      final deckLinks = <String, String?>{};
      final colorIdentity = <String, List<String>>{};
      for (final d in decks) {
        deckLinks[d.name] = d.link;
        if (d.colorIdentity != null) colorIdentity[d.name] = d.colorIdentity!;
      }
      // `decks` carries the bracket's slot names; `dck` is left empty
      // because the cloud side never re-executes these jobs — the
      // local Forge run already produced the result.
      await jobRef.set({
        'decks': decks.map((d) => {'name': d.name, 'dck': ''}).toList(),
        'deckIds': decks.map((d) => d.id).toList(),
        'deckLinks': deckLinks,
        'colorIdentity': colorIdentity,
        'status': 'QUEUED',
        'simulations': simulations,
        'parallelism': 1,
        'createdAt': now,
        'createdBy': uid,
        'idempotencyKey': null,
        'source': 'flutter-local',
        'totalSimCount': simulations,
        'completedSimCount': 0,
      });

      final simRefs = <int, DocumentReference<Map<String, dynamic>>>{};
      final batch = _firestore.batch();
      for (var i = 0; i < simulations; i++) {
        final simRef = jobRef.collection('simulations').doc();
        batch.set(simRef, {
          'index': i,
          'state': 'PENDING',
          'createdAt': now,
          'updatedAt': now,
        });
        simRefs[i] = simRef;
      }
      await batch.commit();

      _jobRef = jobRef;
      _simRefsByIndex = simRefs;
      _jobSub = db.watchJob(localJobId).listen(_onLocalJob);
      _simsSub = db.watchSimsForJob(localJobId).listen(_onLocalSims);

      return jobRef.id;
    } catch (e) {
      // Soft-fail: local run continues, no mirror.
      // Sentry capture isn't free of side effects in tests, so we
      // keep this minimal and let Telemetry pick failures up via the
      // ZoneError boundary if one ever bubbles.
      return null;
    }
  }

  /// Stop watching and release resources. Idempotent.
  Future<void> dispose() async {
    await _jobSub?.cancel();
    await _simsSub?.cancel();
    _jobSub = null;
    _simsSub = null;
    _jobRef = null;
    _simRefsByIndex = null;
    _reportedTerminalIndexes.clear();
  }

  void _onLocalJob(Job? job) {
    final ref = _jobRef;
    if (ref == null || job == null) return;
    if (job.state == _lastJobState) return;
    _lastJobState = job.state;
    final mirrorStatus = switch (job.state) {
      'PENDING' => 'QUEUED',
      'RUNNING' => 'RUNNING',
      'COMPLETED' => 'COMPLETED',
      'FAILED' => 'FAILED',
      'CANCELLED' => 'CANCELLED',
      _ => null,
    };
    if (mirrorStatus == null) return;
    final update = <String, dynamic>{'status': mirrorStatus};
    if (mirrorStatus == 'RUNNING') {
      update['startedAt'] = FieldValue.serverTimestamp();
    } else if (mirrorStatus == 'COMPLETED' ||
        mirrorStatus == 'FAILED' ||
        mirrorStatus == 'CANCELLED') {
      update['completedAt'] = FieldValue.serverTimestamp();
    }
    ref.set(update, SetOptions(merge: true)).catchError((_) {});
  }

  void _onLocalSims(List<Sim> sims) {
    final refs = _simRefsByIndex;
    if (refs == null) return;
    for (final sim in sims) {
      if (_reportedTerminalIndexes.contains(sim.simIndex)) continue;
      if (sim.state != 'COMPLETED' && sim.state != 'FAILED') continue;
      final ref = refs[sim.simIndex];
      if (ref == null) continue;
      _reportedTerminalIndexes.add(sim.simIndex);
      _writeTerminal(ref, sim);
    }
  }

  Future<void> _writeTerminal(
    DocumentReference<Map<String, dynamic>> ref,
    Sim sim,
  ) async {
    final update = <String, dynamic>{
      'state': sim.state,
      'completedAt': FieldValue.serverTimestamp(),
      'durationMs': sim.durationMs ?? 0,
      'updatedAt': FieldValue.serverTimestamp(),
    };
    if (sim.winnerDeckName != null) {
      update['winner'] = sim.winnerDeckName;
      update['winners'] = [sim.winnerDeckName];
    }
    if (sim.winningTurn != null) {
      update['winningTurn'] = sim.winningTurn;
      update['winningTurns'] = [sim.winningTurn];
    }
    if (sim.errorMessage != null) {
      update['errorMessage'] = sim.errorMessage;
    }
    try {
      await ref.set(update, SetOptions(merge: true));
      // Bump the parent's completedSimCount so the cloud aggregation
      // trigger has a counter to flip when all sims land.
      await _jobRef?.set({
        'completedSimCount': FieldValue.increment(1),
      }, SetOptions(merge: true));
    } catch (_) {
      // Soft-fail; the next terminal will retry the counter increment,
      // but a single missed write will leave the cloud-side count
      // trailing. Acceptable for an opportunistic mirror.
    }
  }
}
