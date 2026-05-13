import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/offline/db/app_db.dart';
import 'package:worker_flutter/offline/offline_runner.dart';
import 'package:worker_flutter/worker/sim_runner.dart';

/// End-to-end-ish tests of `OfflineRunner`. We stand up:
///   - An in-memory drift `AppDb`
///   - A temp dir laid out like a real Forge install (with `.dck` files
///     under `<forgePath>/res/Decks/Commander/`)
///   - A stub `SimRunner` that returns predetermined `SimResult`s and
///     records what it was asked to do (deck filenames, cancel signal)
///
/// Each test runs the real `OfflineRunner` against this rig and asserts
/// on the resulting AppDb state — the same SQL the offline-mode UI
/// streams from.
void main() {
  late Directory tempRoot;
  late WorkerConfig config;
  late AppDb db;

  setUp(() async {
    tempRoot = await Directory.systemTemp.createTemp('offline_runner_test_');
    final forgeDir = Directory(
      p.join(tempRoot.path, 'forge', 'res', 'Decks', 'Commander'),
    );
    forgeDir.createSync(recursive: true);

    // Five fake precons so tests can pick any 4 + verify "all 4 play".
    // Forge's CLI is mocked by StubSimRunner so the file contents don't
    // matter — only the filenames do.
    for (final name in [
      'Alpha-Test',
      'Beta-Test',
      'Gamma-Test',
      'Delta-Test',
      'Epsilon-Test',
    ]) {
      File(p.join(forgeDir.path, '$name.dck')).writeAsStringSync('[Main]\n');
    }

    final decksDir = Directory(p.join(tempRoot.path, 'staged-decks'))
      ..createSync(recursive: true);
    final logsDir = Directory(p.join(tempRoot.path, 'sim-logs'))
      ..createSync(recursive: true);

    config = WorkerConfig(
      workerId: 'test-worker',
      workerName: 'test',
      maxCapacity: 1,
      forgePath: p.join(tempRoot.path, 'forge'),
      javaPath: '/usr/bin/java',
      decksPath: decksDir.path,
      logsPath: logsDir.path,
      apiUrl: 'http://localhost',
      workerSecret: null,
    );
    db = AppDb.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
    if (tempRoot.existsSync()) tempRoot.deleteSync(recursive: true);
  });

  group('OfflineRunner.run', () {
    test('runs all PENDING sims and flips the job to COMPLETED', () async {
      final runner = OfflineRunner(
        db: db,
        config: config,
        runnerOverride: _StubSimRunner.successAll(
          winnerForgeName: 'Ai(1)-Alpha-Test',
        ),
      );

      final jobId = await db.createJob(
        deckNames: const [
          'Alpha Test',
          'Beta Test',
          'Gamma Test',
          'Delta Test',
        ],
        simCount: 3,
      );

      await runner.run(jobId);

      final job = await db.jobById(jobId);
      expect(job!.state, 'COMPLETED');
      expect(job.completedSims, 3);

      final sims = await db.simsForJob(jobId);
      expect(sims.length, 3);
      expect(sims.every((s) => s.state == 'COMPLETED'), isTrue);
      expect(sims.first.winnerDeckName, 'Alpha Test');
    });

    test('passes all 4 deck filenames to SimRunner on every sim', () async {
      // "All 4 decks play at least once" is enforced at the runOne boundary:
      // SimRunner's argv expects `-d d1 d2 d3 d4`. We assert that.
      final stub = _StubSimRunner.successAll(
        winnerForgeName: 'Ai(2)-Beta-Test',
      );
      final runner = OfflineRunner(
        db: db,
        config: config,
        runnerOverride: stub,
      );

      final jobId = await db.createJob(
        deckNames: const [
          'Alpha Test',
          'Beta Test',
          'Gamma Test',
          'Delta Test',
        ],
        simCount: 2,
      );
      await runner.run(jobId);

      expect(stub.calls.length, 2, reason: 'two sims expected');
      for (final call in stub.calls) {
        expect(
          call.deckFilenames.length,
          4,
          reason: 'every sim must invoke Forge with 4 decks',
        );
        expect(
          call.deckFilenames.toSet(),
          {
            'Alpha-Test.dck',
            'Beta-Test.dck',
            'Gamma-Test.dck',
            'Delta-Test.dck',
          },
          reason: 'all four picked decks must be present',
        );
      }
    });

    test(
      'missing precon fails the whole job + marks PENDING sims FAILED',
      () async {
        final runner = OfflineRunner(
          db: db,
          config: config,
          runnerOverride: _StubSimRunner.successAll(
            winnerForgeName: 'Ai(1)-Alpha-Test',
          ),
        );

        final jobId = await db.createJob(
          // "Phantom Test" doesn't exist on disk.
          deckNames: const [
            'Alpha Test',
            'Phantom Test',
            'Gamma Test',
            'Delta Test',
          ],
          simCount: 4,
        );
        await runner.run(jobId);

        final job = await db.jobById(jobId);
        expect(job!.state, 'FAILED');

        final sims = await db.simsForJob(jobId);
        expect(
          sims.every((s) => s.state == 'FAILED'),
          isTrue,
          reason: 'all sims should be marked FAILED, not orphaned in PENDING',
        );
        expect(sims.first.errorMessage, contains('Phantom Test'));
      },
    );

    test(
      'Forge winner name "Ai(N)-Deck-Name" maps back to display name',
      () async {
        // Forge writes winners as "Ai(2)-Marchesa-control-upgraded"; the
        // round-trip must produce the picker's display name
        // ("Marchesa Control Upgraded") so the win-rate UI keys match.
        File(
          p.join(
            config.forgePath,
            'res',
            'Decks',
            'Commander',
            'Marchesa-control-upgraded.dck',
          ),
        ).writeAsStringSync('[Main]\n');

        final stub = _StubSimRunner.successAll(
          winnerForgeName: 'Ai(2)-Marchesa-control-upgraded',
        );
        final runner = OfflineRunner(
          db: db,
          config: config,
          runnerOverride: stub,
        );

        final jobId = await db.createJob(
          deckNames: const [
            'Alpha Test',
            'Marchesa Control Upgraded',
            'Gamma Test',
            'Delta Test',
          ],
          simCount: 1,
        );
        await runner.run(jobId);

        final sims = await db.simsForJob(jobId);
        expect(
          sims.first.winnerDeckName,
          'Marchesa Control Upgraded',
          reason: 'winner must round-trip to the picker display name',
        );
      },
    );
  });

  group('OfflineRunner.cancel', () {
    test('cancel during a run stops new sims immediately', () async {
      // The stub holds open the FIRST sim until `release` is signaled
      // so we can race a cancel into the loop and watch only one sim
      // get to COMPLETED.
      final stub = _StubSimRunner.gated();
      final runner = OfflineRunner(
        db: db,
        config: config,
        runnerOverride: stub,
      );

      final jobId = await db.createJob(
        deckNames: const [
          'Alpha Test',
          'Beta Test',
          'Gamma Test',
          'Delta Test',
        ],
        simCount: 5,
      );

      // Kick off; first sim will block at runOne until we release it.
      final runFuture = runner.run(jobId);

      // Wait until the runner has actually entered the first sim.
      await stub.firstCallStarted.future;

      // Cancel mid-run. The cancellation completer fires; the in-flight
      // call's `cancelSignal` resolves so SimRunner would normally
      // SIGTERM the Java child. Then the run loop short-circuits.
      await runner.cancel(jobId);

      // Release the first sim so it can finalize with its 'cancelled'
      // result (mirrors what SimRunner does when the signal fires).
      stub.releaseFirstAsCancelled();
      await runFuture;

      final job = await db.jobById(jobId);
      expect(job!.state, 'CANCELLED', reason: 'job must end in CANCELLED');

      final sims = await db.simsForJob(jobId);
      // First sim got far enough to be marked RUNNING then FAILED (with
      // 'cancelled' errorMessage). The remaining four never started.
      expect(sims.first.state, 'FAILED');
      expect(sims.first.errorMessage, 'cancelled');
      // The remaining sims should be marked FAILED with reason 'cancelled'
      // by `_cancelRemaining` rather than left in PENDING.
      for (final s in sims.skip(1)) {
        expect(
          s.state,
          'FAILED',
          reason: 'cancel must finalize remaining sims, not orphan them',
        );
        expect(s.errorMessage, 'cancelled');
      }
      expect(
        stub.calls.length,
        1,
        reason: 'only the first sim should ever reach SimRunner',
      );
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────

class _RunOneCall {
  _RunOneCall({required this.deckFilenames});
  final List<String> deckFilenames;
}

/// A stand-in `SimRunner` we drive from tests. Captures the deck list
/// for every invocation so we can assert "all 4 decks were passed".
class _StubSimRunner extends SimRunner {
  _StubSimRunner._(this._respond)
    : super(javaPath: '/usr/bin/java', forgePath: '/tmp');

  /// Always returns a successful sim with the given Forge-format winner.
  factory _StubSimRunner.successAll({required String winnerForgeName}) {
    return _StubSimRunner._(
      (_, __) async => SimResult(
        success: true,
        durationMs: 10,
        winners: [winnerForgeName],
        winningTurns: const [7],
        logText: 'stub',
        errorMessage: null,
      ),
    );
  }

  /// First call blocks until the test releases it; subsequent calls
  /// (which shouldn't happen if cancel works) return immediately as
  /// 'cancelled' results.
  factory _StubSimRunner.gated() {
    final firstCallStarted = Completer<void>();
    final firstCallGate = Completer<SimResult>();
    var first = true;
    final stub = _StubSimRunner._((call, cancel) {
      if (first) {
        first = false;
        firstCallStarted.complete();
        // Wait for either the gate to be released OR the cancelSignal
        // to fire (which the test triggers by calling runner.cancel).
        cancel?.then((_) {
          if (!firstCallGate.isCompleted) {
            firstCallGate.complete(
              SimResult(
                success: false,
                durationMs: 5,
                winners: const [],
                winningTurns: const [],
                logText: 'cancelled by signal',
                errorMessage: 'cancelled',
              ),
            );
          }
        });
        return firstCallGate.future;
      }
      return Future.value(
        SimResult(
          success: false,
          durationMs: 1,
          winners: const [],
          winningTurns: const [],
          logText: '',
          errorMessage: 'unexpected — cancel should have prevented this call',
        ),
      );
    });
    stub._firstCallStarted = firstCallStarted;
    stub._firstCallGate = firstCallGate;
    return stub;
  }

  final Future<SimResult> Function(_RunOneCall, Future<void>?) _respond;
  final calls = <_RunOneCall>[];
  Completer<void>? _firstCallStarted;
  Completer<SimResult>? _firstCallGate;

  Completer<void> get firstCallStarted => _firstCallStarted!;
  void releaseFirstAsCancelled() {
    if (_firstCallGate != null && !_firstCallGate!.isCompleted) {
      _firstCallGate!.complete(
        SimResult(
          success: false,
          durationMs: 5,
          winners: const [],
          winningTurns: const [],
          logText: '',
          errorMessage: 'cancelled',
        ),
      );
    }
  }

  @override
  Future<SimResult> runOne({required JobInfo job, Future<void>? cancelSignal}) {
    final call = _RunOneCall(deckFilenames: List.of(job.deckFilenames));
    calls.add(call);
    return _respond(call, cancelSignal);
  }
}
