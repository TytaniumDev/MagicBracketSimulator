import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:rxdart/subjects.dart';

import '../config.dart';
import '../models/sim.dart';
import 'lease_writer.dart';
import 'sim_claim.dart';
import 'sim_runner.dart';

/// Worker lifecycle state observable from the UI.
class EngineState {
  EngineState({
    required this.running,
    required this.activeSims,
    required this.lastError,
    required this.completedCount,
  });

  final bool running;
  final List<SimDoc> activeSims;
  final String? lastError;
  final int completedCount;

  EngineState copyWith({
    bool? running,
    List<SimDoc>? activeSims,
    String? lastError,
    int? completedCount,
  }) =>
      EngineState(
        running: running ?? this.running,
        activeSims: activeSims ?? this.activeSims,
        lastError: lastError ?? this.lastError,
        completedCount: completedCount ?? this.completedCount,
      );

  static EngineState initial() => EngineState(
        running: false,
        activeSims: const [],
        lastError: null,
        completedCount: 0,
      );
}

/// Top-level orchestrator. Owns:
///   - the Firestore `simulations where state==PENDING` listener
///   - the per-job `jobs/{id} status==CANCELLED` listeners (one per active job)
///   - the LeaseWriter (5s heartbeat with lease)
///   - the SimClaimer (atomic Firestore transaction to claim PENDING sims)
///   - the SimRunner (Java child process spawning)
///   - a Semaphore on `config.maxCapacity` to bound concurrency
///
/// Lifecycle: [start] kicks everything off. [stop] cancels active sims and
/// drains. [stateStream] exposes a snapshot of what's running for the UI.
class WorkerEngine {
  WorkerEngine({
    required this.config,
    required this.firestore,
    SimRunner? runnerOverride,
  })  : _runner = runnerOverride ??
            SimRunner(
              javaPath: config.javaPath,
              forgePath: config.forgePath,
            ),
        _leaseWriter = LeaseWriter(
          firestore: firestore,
          workerId: config.workerId,
          workerName: config.workerName,
          capacity: config.maxCapacity,
        ),
        _claimer = SimClaimer(
          firestore: firestore,
          workerId: config.workerId,
          workerName: config.workerName,
        );

  final WorkerConfig config;
  final FirebaseFirestore firestore;
  final SimRunner _runner;
  final LeaseWriter _leaseWriter;
  final SimClaimer _claimer;

  final _stateSubject = BehaviorSubject<EngineState>.seeded(EngineState.initial());
  Stream<EngineState> get stateStream => _stateSubject.stream;
  EngineState get currentState => _stateSubject.value;

  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _pendingSub;
  final Map<String, StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>>
      _cancelSubs = {};

  /// Holds per-sim cancellation completers so a `jobs/{id}.status=CANCELLED`
  /// listener can ask the corresponding sim runner to terminate.
  final Map<String, Completer<void>> _cancelByComposite = {};

  /// Cap concurrent sims at config.maxCapacity. We use a simple counter
  /// (not a wait queue) because new work arrives via the Firestore listener,
  /// so we don't need to block in-process — we just decline to claim when at
  /// capacity and let the next listener tick re-evaluate.
  int _semaphoreActive = 0;
  int get _semaphoreCapacity => config.maxCapacity;

  bool _stopped = false;

  Future<void> start() async {
    if (_stateSubject.value.running) return;
    _stopped = false;
    _stateSubject.add(currentState.copyWith(running: true, lastError: null));

    await _leaseWriter.start();

    // Listen to PENDING sims across all jobs. Every time the listener
    // fires (a new PENDING sim appears, or an existing one's state
    // changes) we try to claim if we have capacity.
    _pendingSub = firestore
        .collectionGroup('simulations')
        .where('state', isEqualTo: 'PENDING')
        .snapshots()
        .listen(
      (_) => _tryClaimLoop(),
      onError: (Object err) {
        _stateSubject.add(currentState.copyWith(lastError: err.toString()));
      },
    );
  }

  Future<void> stop() async {
    _stopped = true;
    await _pendingSub?.cancel();
    _pendingSub = null;
    for (final sub in _cancelSubs.values) {
      await sub.cancel();
    }
    _cancelSubs.clear();
    // Signal any running sims to terminate.
    for (final c in _cancelByComposite.values) {
      if (!c.isCompleted) c.complete();
    }
    _cancelByComposite.clear();
    await _leaseWriter.stop();
    _stateSubject.add(currentState.copyWith(running: false));
  }

  /// Pump the claim loop while we have capacity and PENDING sims exist.
  /// Runs until either we hit capacity or a claim returns NoneAvailable.
  Future<void> _tryClaimLoop() async {
    if (_stopped) return;
    while (_semaphoreActive < _semaphoreCapacity && !_stopped) {
      final result = await _claimer.tryClaim();
      if (result is ClaimNoneAvailable) {
        return;
      }
      if (result is ClaimLostRace) {
        // Wait briefly and try once more; the listener will fire again
        // on next state change anyway.
        await Future<void>.delayed(const Duration(milliseconds: 200));
        return;
      }
      if (result is ClaimSucceeded) {
        unawaited(_runSim(result.sim));
      }
    }
  }

  /// Run a single claimed sim end-to-end: ensure decks present, watch for
  /// job cancellation, spawn Java, report result back.
  Future<void> _runSim(SimDoc sim) async {
    _semaphoreActive++;
    final cancelCompleter = Completer<void>();
    _cancelByComposite[sim.compositeId] = cancelCompleter;
    _publishActiveSims();

    // Subscribe to cancellations for this job.
    _watchJobCancellation(sim.jobId, cancelCompleter);

    try {
      final job = await _loadJobInfo(sim.jobId);
      if (job == null) {
        await _claimer.reportTerminal(
          sim: sim,
          result: SimResult(
            success: false,
            durationMs: 0,
            winners: const [],
            winningTurns: const [],
            logText: '',
            errorMessage: 'job ${sim.jobId} not found',
          ),
        );
        return;
      }

      // Verify decks exist on disk; missing decks = FAILED with clear reason.
      final missingDecks = <String>[];
      for (final name in job.deckFilenames) {
        if (!File('${config.decksPath}/$name').existsSync()) {
          missingDecks.add(name);
        }
      }
      if (missingDecks.isNotEmpty) {
        await _claimer.reportTerminal(
          sim: sim,
          result: SimResult(
            success: false,
            durationMs: 0,
            winners: const [],
            winningTurns: const [],
            logText: '',
            errorMessage: 'missing deck files: ${missingDecks.join(', ')}',
          ),
        );
        return;
      }

      final result = await _runner.runOne(
        job: job,
        cancelSignal: cancelCompleter.future,
      );
      await _claimer.reportTerminal(sim: sim, result: result);

      if (result.success) {
        _stateSubject.add(currentState.copyWith(
          completedCount: currentState.completedCount + 1,
        ));
      }
    } catch (e) {
      await _claimer.reportTerminal(
        sim: sim,
        result: SimResult(
          success: false,
          durationMs: 0,
          winners: const [],
          winningTurns: const [],
          logText: '',
          errorMessage: e.toString(),
        ),
      );
    } finally {
      _semaphoreActive--;
      _cancelByComposite.remove(sim.compositeId);
      _publishActiveSims();
      // Drop the per-job cancel sub if no other sims for that job remain.
      final stillHasSamJob = _cancelByComposite.keys
          .any((k) => k.startsWith('${sim.jobId}:'));
      if (!stillHasSamJob) {
        await _cancelSubs.remove(sim.jobId)?.cancel();
      }
      // Try to pick up more work immediately.
      unawaited(_tryClaimLoop());
    }
  }

  void _watchJobCancellation(String jobId, Completer<void> cancelCompleter) {
    if (_cancelSubs.containsKey(jobId)) return;
    final sub = firestore.collection('jobs').doc(jobId).snapshots().listen(
      (snap) {
        if (!snap.exists) return;
        final status = snap.data()?['status'];
        if (status == 'CANCELLED' && !cancelCompleter.isCompleted) {
          cancelCompleter.complete();
        }
      },
      onError: (Object _) {/* swallow; sim will complete or time out */},
    );
    _cancelSubs[jobId] = sub;
  }

  Future<JobInfo?> _loadJobInfo(String jobId) async {
    final doc = await firestore.collection('jobs').doc(jobId).get();
    if (!doc.exists) return null;
    final data = doc.data();
    if (data == null) return null;

    // Decks may be stored as `deckLinks` (rich) or `deckFilenames` (plain).
    // We accept either, normalising to .dck filenames.
    final raw = data['deckFilenames'] ?? data['deckFiles'];
    final filenames = <String>[];
    if (raw is List) {
      for (final v in raw) {
        if (v is String) filenames.add(v);
      }
    } else if (data['deckLinks'] is List) {
      for (final link in (data['deckLinks'] as List)) {
        if (link is Map && link['filename'] is String) {
          filenames.add(link['filename'] as String);
        }
      }
    }

    return JobInfo(
      jobId: jobId,
      deckFilenames: filenames,
      simulationsPerJob: (data['simulationsRequested'] as num?)?.toInt() ?? 1,
    );
  }

  void _publishActiveSims() {
    final active = _cancelByComposite.keys
        .map((k) {
          final parts = k.split(':');
          if (parts.length != 2) return null;
          return SimDoc(
            simId: parts[1],
            jobId: parts[0],
            index: 0,
            state: 'RUNNING',
            workerId: config.workerId,
            workerName: config.workerName,
          );
        })
        .whereType<SimDoc>()
        .toList(growable: false);
    _stateSubject.add(currentState.copyWith(activeSims: active));
    _leaseWriter.setActive(active.map((s) => s.compositeId));
  }

  Future<void> dispose() async {
    await stop();
    await _stateSubject.close();
  }
}
