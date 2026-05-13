import 'dart:async';
import 'dart:io';

import '../config.dart';
import '../models/sim.dart';
import '../worker/sim_runner.dart';
import 'db/app_db.dart';
import 'deck_source.dart';

/// Drives a single offline job from PENDING through COMPLETED.
///
/// Mirrors the structure of the cloud-mode `WorkerEngine` but talks to
/// the local `AppDb` instead of Firestore, and uses bundled precons
/// from `forgePath/res/Decks/Commander/` rather than staging deck
/// content into `decksPath` from a job document.
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

  /// Run every PENDING sim of `jobId` sequentially. Returns when the
  /// job is COMPLETED (or marked FAILED on a hard error). UI watches
  /// the AppDb stream for per-sim progress.
  Future<void> run(int jobId) async {
    final job = await db.jobById(jobId);
    if (job == null) return;

    await db.updateJobState(jobId, 'RUNNING');

    // Resolve the bundled precon paths once. The .dck files live under
    // Forge's data dir; SimRunner expects filenames it can pass to
    // forge.jar with `-d`, so we copy/symlink into `config.decksPath`
    // (Forge's user decks dir) if they're not already present.
    final precons = await loadBundledPrecons(config.forgePath);
    final byName = {for (final d in precons) d.displayName: d};
    final deckFilenames = <String>[];
    for (final name in [
      job.deck1Name,
      job.deck2Name,
      job.deck3Name,
      job.deck4Name,
    ]) {
      final precon = byName[name];
      if (precon == null) {
        await db.updateJobState(jobId, 'FAILED');
        return;
      }
      deckFilenames.add(await _stageDeck(precon));
    }

    final sims = await db.simsForJob(jobId);
    for (final sim in sims.where((s) => s.state == 'PENDING')) {
      await _runSim(sim, deckFilenames);
    }

    final fresh = await db.jobById(jobId);
    if (fresh != null && fresh.completedSims >= fresh.totalSims) {
      await db.updateJobState(jobId, 'COMPLETED');
    }
  }

  Future<void> _runSim(Sim sim, List<String> deckFilenames) async {
    await db.markSimRunning(sim.id);
    final result = await _runner.runOne(
      job: JobInfo(
        jobId: 'offline-${sim.jobId}',
        deckFilenames: deckFilenames,
        simulationsPerJob: 1,
      ),
    );

    final logRelPath = await _maybePersistLog(sim, result.logText);

    if (result.success && result.winners.isNotEmpty) {
      // Forge's "Ai(N)-<deck-name>" winner format. Map it back to the
      // job's deck names by matching the suffix.
      final winnerRaw = result.winners.first;
      final winnerDeck = _matchDeck(winnerRaw, deckFilenames) ?? winnerRaw;
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

  /// Map "Ai(2)-Marchesa-control-upgraded" → "Marchesa-control-upgraded.dck"
  /// → the deck name we displayed in the picker. Falls back to the raw
  /// Forge string if nothing matches.
  String? _matchDeck(String forgeWinnerName, List<String> deckFilenames) {
    final stripped = forgeWinnerName
        .replaceFirst(RegExp(r'^Ai\(\d+\)-'), '')
        .replaceAll(' ', '-');
    for (final f in deckFilenames) {
      final base = f.endsWith('.dck') ? f.substring(0, f.length - 4) : f;
      if (base == stripped || base.toLowerCase() == stripped.toLowerCase()) {
        return base;
      }
    }
    return null;
  }

  /// Stage a precon .dck into `config.decksPath` (Forge's user decks
  /// dir) if it isn't already there. Returns the filename SimRunner
  /// should pass to `-d`.
  Future<String> _stageDeck(PreconDeck precon) async {
    final dest = File(
      '${config.decksPath}${Platform.pathSeparator}${precon.filename}',
    );
    if (!dest.existsSync()) {
      dest.parent.createSync(recursive: true);
      dest.writeAsStringSync(File(precon.path).readAsStringSync());
    }
    return precon.filename;
  }

  /// Write the sim's stdout to `<logsPath>/offline-<simId>.log` and
  /// return the path relative to the logs dir. Skipped on empty logs.
  Future<String?> _maybePersistLog(Sim sim, String logText) async {
    if (logText.isEmpty) return null;
    final relName = 'offline-${sim.jobId}-${sim.simIndex}.log';
    final path = '${config.logsPath}${Platform.pathSeparator}$relName';
    try {
      File(path).writeAsStringSync(logText);
      return relName;
    } catch (_) {
      return null;
    }
  }
}
