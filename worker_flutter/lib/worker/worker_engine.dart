import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:rxdart/subjects.dart';

import '../config.dart';
import '../models/sim.dart';
import 'job_aggregator.dart';
import 'lease_writer.dart';
import 'log_uploader.dart';
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
  }) => EngineState(
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
  }) : _runner =
           runnerOverride ??
           SimRunner(javaPath: config.javaPath, forgePath: config.forgePath),
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
       ),
       _logUploader = LogUploader(
         apiUrl: config.apiUrl,
         workerSecret: config.workerSecret,
       ),
       _jobAggregator = JobAggregator(
         apiUrl: config.apiUrl,
         workerSecret: config.workerSecret,
       );

  final WorkerConfig config;
  final FirebaseFirestore firestore;
  final SimRunner _runner;
  final LeaseWriter _leaseWriter;
  final SimClaimer _claimer;
  final LogUploader _logUploader;
  final JobAggregator _jobAggregator;

  final _stateSubject = BehaviorSubject<EngineState>.seeded(
    EngineState.initial(),
  );
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

    try {
      await _leaseWriter.start();
    } catch (e) {
      _stateSubject.add(currentState.copyWith(lastError: 'lease writer: $e'));
    }

    // Listen to PENDING sims across all jobs. Every time the listener
    // fires (a new PENDING sim appears, or an existing one's state
    // changes) we try to claim if we have capacity.
    //
    // Listener errors get printed AND surfaced via lastError on the
    // engine state. Without the print, a firestore.rules misconfig
    // shows up as "worker mysteriously idle" with no log trail.
    try {
      _pendingSub = firestore
          .collectionGroup('simulations')
          .where('state', isEqualTo: 'PENDING')
          .snapshots()
          .listen(
            (snap) {
              debugPrint(
                'WorkerEngine: PENDING listener fired with ${snap.docs.length} doc(s)',
              );
              _tryClaimLoop();
            },
            onError: (Object err) {
              debugPrint('WorkerEngine: PENDING listener error: $err');
              _stateSubject.add(
                currentState.copyWith(lastError: err.toString()),
              );
            },
          );
    } catch (e) {
      debugPrint('WorkerEngine: listener setup failed: $e');
      _stateSubject.add(currentState.copyWith(lastError: 'listener setup: $e'));
    }
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
      var attempt = 0;
      ClaimResult result;
      while (true) {
        result = await _claimer.tryClaim();
        // Retry on ClaimLostRace in-place rather than returning: an internal
        // Firestore txn conflict (no competing worker) won't cause the
        // listener to refire, so leaving the sim PENDING here would orphan
        // it. Cap retries to avoid spinning if a real race keeps losing.
        if (result is! ClaimLostRace || attempt >= 2) break;
        attempt++;
        await Future<void>.delayed(Duration(milliseconds: 100 * attempt));
      }
      if (result is ClaimNoneAvailable) return;
      if (result is ClaimLostRace) {
        // exhausted retries; listener will refire on next change
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

    // Subscribe to cancellations for this job. The listener resolves all
    // active completers via `_cancelByComposite` at event time, so it picks
    // up sims claimed after the subscription was set up.
    _watchJobCancellation(sim.jobId);

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
        unawaited(_jobAggregator.triggerIfDone(sim.jobId));
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
        unawaited(_jobAggregator.triggerIfDone(sim.jobId));
        return;
      }

      final result = await _runner.runOne(
        job: job,
        cancelSignal: cancelCompleter.future,
      );
      await _claimer.reportTerminal(sim: sim, result: result);

      // Best-effort: post the raw sim log to the API so it shows up under
      // the frontend's per-sim log view. Non-blocking; failures only log.
      unawaited(
        _logUploader.upload(
          jobId: sim.jobId,
          simIndex: sim.index,
          logText: result.logText,
        ),
      );

      // Fast-path: ask the API to aggregate the parent job NOW if
      // every sim is terminal. Without this the job sits in RUNNING
      // until the 15-minute stale-sweeper picks it up — see
      // `JobAggregator` docstring. Idempotent + non-fatal.
      unawaited(_jobAggregator.triggerIfDone(sim.jobId));

      if (result.success) {
        _stateSubject.add(
          currentState.copyWith(
            completedCount: currentState.completedCount + 1,
          ),
        );
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
      unawaited(_jobAggregator.triggerIfDone(sim.jobId));
    } finally {
      _semaphoreActive--;
      _cancelByComposite.remove(sim.compositeId);
      _publishActiveSims();
      // Drop the per-job cancel sub if no other sims for that job remain.
      final stillHasSamJob = _cancelByComposite.keys.any(
        (k) => k.startsWith('${sim.jobId}:'),
      );
      if (!stillHasSamJob) {
        await _cancelSubs.remove(sim.jobId)?.cancel();
      }
      // Try to pick up more work immediately.
      unawaited(_tryClaimLoop());
    }
  }

  void _watchJobCancellation(String jobId) {
    if (_cancelSubs.containsKey(jobId)) return;
    final sub = firestore
        .collection('jobs')
        .doc(jobId)
        .snapshots()
        .listen(
          (snap) {
            if (!snap.exists) return;
            final status = snap.data()?['status'];
            if (status != 'CANCELLED') return;
            // Signal every active sim for this job. Looking up completers via
            // `_cancelByComposite` (rather than capturing a single one at
            // subscription time) handles the multi-sim case where additional
            // sims are claimed for the same job after the listener was set up.
            for (final entry in _cancelByComposite.entries) {
              if (entry.key.startsWith('$jobId:') && !entry.value.isCompleted) {
                entry.value.complete();
              }
            }
          },
          onError: (Object err) {
            // Listener errors are non-fatal here — if the cancel signal misses,
            // the sim still completes or times out on its own. Log so a broken
            // Firestore connection is at least visible during dev.
            debugPrint('cancellation listener for job $jobId errored: $err');
          },
        );
    _cancelSubs[jobId] = sub;
  }

  Future<JobInfo?> _loadJobInfo(String jobId) async {
    final doc = await firestore.collection('jobs').doc(jobId).get();
    if (!doc.exists) return null;
    final data = doc.data();
    if (data == null) return null;

    // Job docs store decks as `decks: DeckSlot[]` where each entry has
    // { name, dck } — the dck field is the full .dck file content as a
    // string. We materialize these to disk so Forge's CLI can find them.
    final rawDecks = data['decks'];
    final filenames = <String>[];
    if (rawDecks is List) {
      for (final slot in rawDecks) {
        if (slot is Map && slot['name'] is String && slot['dck'] is String) {
          final name = (slot['name'] as String).replaceAll(
            RegExp(r'[^A-Za-z0-9._-]'),
            '_',
          );
          final filename = '$name.dck';
          final filePath = '${config.decksPath}/$filename';
          final f = File(filePath);
          // Always overwrite — content can change between jobs even for the
          // same deck name (deck editing).
          f.parent.createSync(recursive: true);
          f.writeAsStringSync(slot['dck'] as String);
          filenames.add(filename);
        }
      }
    }

    return JobInfo(
      jobId: jobId,
      deckFilenames: filenames,
      simulationsPerJob: (data['simulations'] as num?)?.toInt() ?? 1,
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
