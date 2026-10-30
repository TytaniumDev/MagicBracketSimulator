import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:rxdart/subjects.dart';

import '../api_client.dart';
import '../app_log.dart';
import '../config.dart';
import '../models/sim.dart';
import '../telemetry.dart';
import 'job_loader.dart';
import 'log_uploader.dart';
import 'sim_api.dart';
import 'sim_lease_keeper.dart';
import 'sim_runner.dart';
import 'worker_presence.dart';

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
///   - the Firestore `simulations where state==PENDING` listener, a
///     read-only wake-up signal that new work exists
///   - the WorkerPresence (Realtime Database entry listing this worker as
///     online in the web UI)
///   - the SimApi (claims, lease extensions and results, all through the
///     API)
///   - one SimLeaseKeeper per running sim, which also delivers cancellation
///   - the SimRunner (Java child process spawning)
///   - a counter on `config.maxCapacity` to bound concurrency
///
/// Lifecycle: [start] kicks everything off. [stop] cancels active sims and
/// drains. [stateStream] exposes a snapshot of what's running for the UI.
class WorkerEngine {
  WorkerEngine({
    required this.config,
    required this.firestore,
    required PresenceSink presenceSink,
    SimRunner? runnerOverride,
    ApiClient? apiClient,
    this.leaseInterval = const Duration(seconds: 60),
  }) : _runner =
           runnerOverride ??
           SimRunner(javaPath: config.javaPath, forgePath: config.forgePath),
       _presence = WorkerPresence(
         sink: presenceSink,
         workerName: config.workerName,
         capacity: config.maxCapacity,
       ),
       _api = apiClient ?? ApiClient(baseUrl: config.apiUrl);

  final WorkerConfig config;
  final FirebaseFirestore firestore;

  /// How often each running sim's lease is extended.
  final Duration leaseInterval;
  final SimRunner _runner;
  final WorkerPresence _presence;
  final ApiClient _api;
  late final SimApi _simApi = SimApi(
    api: _api,
    workerId: config.workerId,
    workerName: config.workerName,
  );
  late final LogUploader _logUploader = LogUploader(api: _api);
  late final JobLoader _jobLoader = JobLoader(
    api: _api,
    decksPath: config.decksPath,
  );

  final _stateSubject = BehaviorSubject<EngineState>.seeded(
    EngineState.initial(),
  );
  Stream<EngineState> get stateStream => _stateSubject.stream;
  EngineState get currentState => _stateSubject.value;

  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _pendingSub;

  /// Holds per-sim cancellation completers, so [stop] or a cancelled lease
  /// can ask the corresponding sim runner to terminate.
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
    _emit(currentState.copyWith(running: true, lastError: null));

    try {
      await _presence.start();
    } catch (e, st) {
      _emit(currentState.copyWith(lastError: 'presence: $e'));
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'presence_start'},
      );
    }

    // Listen to PENDING sims across all jobs. Every time the listener
    // fires (a new PENDING sim appears, or an existing one's state
    // changes) we try to claim if we have capacity. The claim itself goes
    // through the API, which picks the sim.
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
              AppLog.event(
                TelemetryCategory.engineRuntime,
                'PENDING listener fired',
                data: {'docs': snap.docs.length},
              );
              _tryClaimLoop();
            },
            onError: (Object err) {
              AppLog.event(
                TelemetryCategory.engineRuntime,
                'PENDING listener error: $err',
              );
              _emit(currentState.copyWith(lastError: err.toString()));
            },
          );
    } catch (e, st) {
      AppLog.event(
        TelemetryCategory.engineStart,
        'PENDING listener setup failed: $e',
      );
      _emit(currentState.copyWith(lastError: 'listener setup: $e'));
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'pending_listener_setup'},
      );
    }
  }

  Future<void> stop() async {
    _stopped = true;
    await _pendingSub?.cancel();
    _pendingSub = null;
    // Signal any running sims to terminate.
    for (final c in _cancelByComposite.values) {
      if (!c.isCompleted) c.complete();
    }
    _cancelByComposite.clear();
    await _presence.stop();
    _emit(currentState.copyWith(running: false));
  }

  /// Change the concurrency cap while the engine is running. Persists the
  /// value, advertises it on the next presence write, and immediately claims
  /// more work if the cap went up. Lowering the cap lets running sims finish;
  /// no new claims happen until the active count drops below it.
  Future<void> setMaxCapacity(int n) async {
    await config.setCapacity(n);
    _presence.capacity = n;
    if (currentState.running) unawaited(_tryClaimLoop());
  }

  /// True while a claim loop is pumping. Every trigger (listener tick, sim
  /// finished, capacity change) funnels through [_tryClaimLoop], and only
  /// one loop may run at a time: overlapping loops could both pass the
  /// capacity check before either claim lands.
  bool _claimLoopRunning = false;

  /// Set when a trigger arrives while a loop is running, so the running loop
  /// makes one more pass instead of the trigger being dropped.
  bool _claimLoopRerun = false;

  /// Pump the claim loop while we have capacity and PENDING sims exist.
  /// Single-flight: a call made while a loop is already running just asks
  /// that loop for another pass.
  Future<void> _tryClaimLoop() async {
    if (_stopped) return;
    if (_claimLoopRunning) {
      _claimLoopRerun = true;
      return;
    }
    _claimLoopRunning = true;
    try {
      do {
        _claimLoopRerun = false;
        await _claimUntilFullOrEmpty();
      } while (_claimLoopRerun && !_stopped);
    } finally {
      _claimLoopRunning = false;
    }
  }

  /// Claim and start sims until we hit capacity or a claim returns
  /// NoneAvailable. Only called from [_tryClaimLoop].
  Future<void> _claimUntilFullOrEmpty() async {
    while (_semaphoreActive < _semaphoreCapacity && !_stopped) {
      final ClaimResult result;
      try {
        result = await _simApi.claim();
      } catch (e, st) {
        // A failed claim (offline, signed out, API down) must not escape
        // as an unhandled async error; the next trigger retries.
        AppLog.event(TelemetryCategory.engineRuntime, 'claim failed: $e');
        _emit(currentState.copyWith(lastError: 'claim: $e'));
        await Telemetry.captureError(
          e,
          st,
          category: TelemetryCategory.engineRuntime,
          extra: {'phase': 'claim'},
        );
        return;
      }
      switch (result) {
        case ClaimNoneAvailable():
          AppLog.event(
            TelemetryCategory.engineRuntime,
            'claim: none available',
          );
          return;
        case ClaimSucceeded(:final sim):
          AppLog.event(
            TelemetryCategory.engineRuntime,
            'claim: succeeded',
            data: {'jobId': sim.jobId, 'simId': sim.simId},
          );
          unawaited(_runSim(sim));
      }
    }
  }

  /// Run a single claimed sim end-to-end: hold its lease, write its decks,
  /// spawn Java, upload the log, then report the result.
  Future<void> _runSim(SimDoc sim) async {
    _semaphoreActive++;
    final cancelCompleter = Completer<void>();
    _cancelByComposite[sim.compositeId] = cancelCompleter;
    _publishActiveSims();

    // Hold the lease while the sim runs. When the API says the job was
    // cancelled, or another worker took the sim over, stop the sim.
    SimLeaseStatus? leaseEnd;
    final leaseKeeper = SimLeaseKeeper(
      extend: () => _simApi.extendLease(sim),
      onEnd: (status) {
        AppLog.event(
          TelemetryCategory.engineRuntime,
          'sim: lease ${status.name}, stopping',
          data: {'jobId': sim.jobId, 'simId': sim.simId},
        );
        leaseEnd = status;
        if (!cancelCompleter.isCompleted) cancelCompleter.complete();
      },
      interval: leaseInterval,
    )..start();

    final simData = {'jobId': sim.jobId, 'simId': sim.simId};
    try {
      final job = await _jobLoader.load(sim.jobId);
      if (job == null) {
        AppLog.event(
          TelemetryCategory.engineRuntime,
          'sim: job not found',
          data: simData,
        );
        await _report(sim, _failure('job ${sim.jobId} not found'));
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
        AppLog.event(
          TelemetryCategory.engineRuntime,
          'sim: missing deck files',
          data: {...simData, 'decks': missingDecks.join(', ')},
        );
        await _report(
          sim,
          _failure('missing deck files: ${missingDecks.join(', ')}'),
        );
        return;
      }

      AppLog.event(
        TelemetryCategory.engineRuntime,
        'sim: started',
        data: simData,
      );
      final result = await _runner.runOne(
        job: job,
        cancelSignal: cancelCompleter.future,
      );
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'sim: finished',
        data: {
          ...simData,
          'success': result.success,
          'durationMs': result.durationMs,
          if (result.errorMessage != null) 'error': result.errorMessage,
        },
      );

      switch (leaseEnd) {
        case SimLeaseStatus.lost:
          // Another worker holds the sim now; its result is theirs to report.
          return;
        case SimLeaseStatus.cancelled:
          await _report(sim, result, cancelled: true);
          return;
        case SimLeaseStatus.extended:
        case null:
          break;
      }

      // Upload the log before reporting: reporting the job's last sim
      // starts aggregation, which reads the uploaded logs. Failures only log.
      if (result.logText.trim().isNotEmpty) {
        await _logUploader.upload(
          jobId: sim.jobId,
          simIndex: sim.index,
          logText: result.logText,
        );
      }
      await _report(sim, result);

      if (result.success) {
        _emit(
          currentState.copyWith(
            completedCount: currentState.completedCount + 1,
          ),
        );
      }
    } catch (e, st) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'sim: failed with exception: $e',
        data: simData,
      );
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'sim_run', 'jobId': sim.jobId, 'simId': sim.simId},
      );
      if (leaseEnd != SimLeaseStatus.lost) {
        await _report(sim, _failure(e.toString()));
      }
    } finally {
      leaseKeeper.stop();
      _semaphoreActive--;
      _cancelByComposite.remove(sim.compositeId);
      _publishActiveSims();
      // Try to pick up more work immediately.
      unawaited(_tryClaimLoop());
    }
  }

  /// Report [result] for [sim] through the API. A failed report is logged
  /// and sent to Sentry; the sim's lease then runs out and another worker
  /// re-runs it.
  Future<void> _report(
    SimDoc sim,
    SimResult result, {
    bool cancelled = false,
  }) async {
    try {
      if (cancelled) {
        await _simApi.reportCancelled(sim, durationMs: result.durationMs);
      } else {
        await _simApi.reportResult(sim, result);
      }
    } catch (e, st) {
      AppLog.event(
        TelemetryCategory.engineRuntime,
        'sim: report failed: $e',
        data: {'jobId': sim.jobId, 'simId': sim.simId},
      );
      await Telemetry.captureError(
        e,
        st,
        category: TelemetryCategory.engineRuntime,
        extra: {'phase': 'sim_report', 'jobId': sim.jobId, 'simId': sim.simId},
      );
    }
  }

  static SimResult _failure(String errorMessage) => SimResult(
    success: false,
    durationMs: 0,
    winners: const [],
    winningTurns: const [],
    logText: '',
    errorMessage: errorMessage,
  );

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
    _emit(currentState.copyWith(activeSims: active));
    _presence.activeSimulations = active.length;
  }

  /// Publish [state] unless the engine has been disposed. Sims that were
  /// in flight when [dispose] ran still finish afterwards and report.
  void _emit(EngineState state) {
    if (_stateSubject.isClosed) return;
    _stateSubject.add(state);
  }

  Future<void> dispose() async {
    await stop();
    await _stateSubject.close();
  }
}
