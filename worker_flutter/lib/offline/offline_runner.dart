import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

import '../config.dart';
import '../models/sim.dart';
import '../worker/sim_runner.dart';
import 'db/app_db.dart';
import 'deck_source.dart';

/// Drives offline jobs from PENDING through COMPLETED. Local mirror of
/// the cloud-mode `WorkerEngine` — talks to the on-disk `AppDb`
/// instead of Firestore and uses bundled precons from
/// `<forgePath>/res/Decks/Commander/`.
///
/// One `OfflineRunner` per app instance; tracks in-flight jobs in a
/// `_cancels` map keyed by jobId so the UI can cancel a long run.
class OfflineRunner {
  OfflineRunner({
    required this.db,
    required this.config,
    SimRunner? runnerOverride,
  }) : _runner =
           runnerOverride ??
           SimRunner(javaPath: config.javaPath, forgePath: config.forgePath);

  final AppDb db;
  final WorkerConfig config;
  final SimRunner _runner;

  /// Cancel signals keyed by jobId. Cleared when the run loop exits.
  final Map<int, Completer<void>> _cancels = {};

  /// Trigger cancellation of `jobId` if currently running.
  /// Marks any remaining PENDING sims as CANCELLED and flips the job
  /// state. SimRunner's already-running Java child gets a SIGTERM and
  /// returns a `'cancelled'` `SimResult`.
  Future<void> cancel(int jobId) async {
    final completer = _cancels[jobId];
    if (completer != null && !completer.isCompleted) {
      completer.complete();
    }
  }

  /// True if `jobId` is currently being driven by this runner.
  bool isRunning(int jobId) => _cancels.containsKey(jobId);

  /// Find any jobs left RUNNING (or with PENDING sims) from a prior
  /// session and re-drive them. Called on app launch — without this,
  /// closing the app mid-run permanently strands those jobs.
  Future<void> resumeInFlightJobs() async {
    final all = await db.recentJobs(limit: 100);
    for (final job in all) {
      if (job.state == 'RUNNING' ||
          (job.completedSims < job.totalSims &&
              job.state != 'CANCELLED' &&
              job.state != 'FAILED')) {
        // Don't await — start each in parallel-ish (the actual sim
        // runs are sequential per job, but multiple jobs interleave).
        unawaited(run(job.id));
      }
    }
  }

  /// Run every PENDING sim of `jobId` sequentially. Returns when the
  /// job is COMPLETED / CANCELLED / FAILED. UI watches the AppDb
  /// stream for per-sim progress.
  Future<void> run(int jobId) async {
    if (_cancels.containsKey(jobId)) return; // already running
    final cancel = Completer<void>();
    _cancels[jobId] = cancel;
    try {
      await _drive(jobId, cancel);
    } finally {
      _cancels.remove(jobId);
    }
  }

  Future<void> _drive(int jobId, Completer<void> cancel) async {
    final job = await db.jobById(jobId);
    if (job == null) return;

    await db.updateJobState(jobId, 'RUNNING');

    final precons = await loadBundledPrecons(config.forgePath);
    final byName = {for (final d in precons) d.displayName: d};

    // Resolve all four decks first so a missing precon fails the whole
    // job atomically rather than producing partial results.
    final picked = <PreconDeck>[];
    final declared = [
      job.deck1Name,
      job.deck2Name,
      job.deck3Name,
      job.deck4Name,
    ];
    for (final name in declared) {
      final precon = byName[name];
      if (precon == null) {
        await _failJob(jobId, 'precon not installed: $name');
        return;
      }
      picked.add(precon);
    }

    // Stage decks into Forge's user decks dir (idempotent).
    final deckFilenames = <String>[];
    for (final precon in picked) {
      deckFilenames.add(await _stageDeck(precon));
    }
    final filenameToDisplay = {
      for (var i = 0; i < picked.length; i++)
        deckFilenames[i].replaceAll(
          RegExp(r'\.dck$', caseSensitive: false),
          '',
        ): picked[i].displayName,
    };

    final sims = await db.simsForJob(jobId);
    for (final sim in sims.where((s) => s.state == 'PENDING')) {
      if (cancel.isCompleted) {
        await _cancelRemaining(jobId);
        return;
      }
      await _runSim(sim, deckFilenames, filenameToDisplay, cancel.future);
    }

    final fresh = await db.jobById(jobId);
    if (fresh != null &&
        fresh.state != 'CANCELLED' &&
        fresh.state != 'FAILED') {
      if (fresh.completedSims >= fresh.totalSims) {
        await db.updateJobState(jobId, 'COMPLETED');
      }
    }
  }

  Future<void> _runSim(
    Sim sim,
    List<String> deckFilenames,
    Map<String, String> filenameToDisplay,
    Future<void> cancel,
  ) async {
    await db.markSimRunning(sim.id);
    final result = await _runner.runOne(
      job: JobInfo(
        jobId: 'offline-${sim.jobId}',
        deckFilenames: deckFilenames,
        simulationsPerJob: 1,
      ),
      cancelSignal: cancel,
    );

    final logRelPath = await _maybePersistLog(sim, result.logText);

    if (result.success && result.winners.isNotEmpty) {
      final winnerDeck =
          _matchDeck(result.winners.first, filenameToDisplay) ??
          result.winners.first;
      await db.markSimCompleted(
        sim.id,
        winnerDeckName: winnerDeck,
        winningTurn: result.winningTurns.isEmpty
            ? null
            : result.winningTurns.first,
        durationMs: result.durationMs,
        logRelPath: logRelPath,
      );
    } else {
      await db.markSimFailed(
        sim.id,
        error: result.errorMessage ?? 'no winner detected',
        durationMs: result.durationMs,
        logRelPath: logRelPath,
      );
    }
  }

  /// Map `"Ai(2)-Marchesa-control-upgraded"` back to the picker's
  /// display name (e.g. `"Marchesa Control Upgraded"`). Without this
  /// round-trip the win-rate UI keys on the Forge-internal name and
  /// the deck rows stay at zero.
  String? _matchDeck(
    String forgeWinner,
    Map<String, String> filenameToDisplay,
  ) {
    final stripped = forgeWinner
        .replaceFirst(RegExp(r'^Ai\(\d+\)-'), '')
        .replaceAll(' ', '-');
    // Direct hit on the filename base.
    if (filenameToDisplay.containsKey(stripped)) {
      return filenameToDisplay[stripped];
    }
    // Case-insensitive fallback.
    final low = stripped.toLowerCase();
    for (final entry in filenameToDisplay.entries) {
      if (entry.key.toLowerCase() == low) return entry.value;
    }
    return null;
  }

  /// Stage a precon .dck into `config.decksPath` (idempotent).
  Future<String> _stageDeck(PreconDeck precon) async {
    final dest = File(p.join(config.decksPath, precon.filename));
    if (!dest.existsSync()) {
      dest.parent.createSync(recursive: true);
      File(precon.path).copySync(dest.path);
    }
    return precon.filename;
  }

  /// Persist a sim's stdout to `<logsPath>/offline-<jobId>-<idx>.log`.
  /// Returns the filename relative to `logsPath`. Errors are logged
  /// (debug-only) and return null so the run continues.
  Future<String?> _maybePersistLog(Sim sim, String logText) async {
    if (logText.isEmpty) return null;
    final relName = 'offline-${sim.jobId}-${sim.simIndex}.log';
    final path = p.join(config.logsPath, relName);
    try {
      File(path).writeAsStringSync(logText);
      return relName;
    } catch (e) {
      debugPrint('OfflineRunner: failed to persist log for sim ${sim.id}: $e');
      return null;
    }
  }

  /// Mark every still-PENDING sim of `jobId` as FAILED with the given
  /// reason, then flip the job to FAILED. Used when a job can't run
  /// at all (e.g. missing precon).
  Future<void> _failJob(int jobId, String reason) async {
    final sims = await db.simsForJob(jobId);
    for (final sim in sims.where((s) => s.state == 'PENDING')) {
      await db.markSimFailed(sim.id, error: reason, durationMs: 0);
    }
    await db.updateJobState(jobId, 'FAILED');
  }

  /// Cancel-path equivalent of `_failJob`: mark PENDING sims as
  /// CANCELLED (not FAILED — distinguishes user-initiated stops from
  /// crashes) and flip the job to CANCELLED.
  Future<void> _cancelRemaining(int jobId) async {
    final sims = await db.simsForJob(jobId);
    for (final sim in sims.where((s) => s.state == 'PENDING')) {
      await db.markSimFailed(sim.id, error: 'cancelled', durationMs: 0);
    }
    await db.updateJobState(jobId, 'CANCELLED');
  }
}
