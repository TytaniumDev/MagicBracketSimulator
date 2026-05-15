import 'dart:async';
import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/offline/db/app_db.dart';
import 'package:worker_flutter/offline/offline_runner.dart';
import 'package:worker_flutter/worker/sim_runner.dart';

/// `resumeInFlightJobs` runs on app launch and is the only guard
/// against permanently stranded sims after a hard quit. Its filter is
/// "RUNNING, OR (incomplete AND not terminal)". The tests here pin
/// each branch of that filter so a refactor of the boolean — or of
/// the terminal-state list — doesn't quietly drop or duplicate work.
void main() {
  late Directory tempRoot;
  late WorkerConfig config;
  late AppDb db;

  setUp(() async {
    tempRoot = await Directory.systemTemp.createTemp('resume_test_');
    Directory(
      p.join(tempRoot.path, 'forge', 'res', 'Decks', 'Commander'),
    ).createSync(recursive: true);
    final decksDir = Directory(p.join(tempRoot.path, 'staged'))
      ..createSync(recursive: true);
    final logsDir = Directory(p.join(tempRoot.path, 'logs'))
      ..createSync(recursive: true);
    config = WorkerConfig(
      workerId: 'w',
      workerName: 'w',
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

  Future<int> insertJob({
    required String state,
    required int total,
    required int completed,
  }) async {
    final id = await db
        .into(db.jobs)
        .insert(
          JobsCompanion.insert(
            createdAt: DateTime.now(),
            totalSims: total,
            completedSims: Value(completed),
            state: Value(state),
            deck1Name: 'A',
            deck2Name: 'B',
            deck3Name: 'C',
            deck4Name: 'D',
          ),
        );
    return id;
  }

  test('resumes RUNNING jobs with incomplete sim counts', () async {
    final id = await insertJob(state: 'RUNNING', total: 3, completed: 1);
    final stub = _NeverCalledSimRunner();
    final runner = OfflineRunner(db: db, config: config, runnerOverride: stub);

    await runner.resumeInFlightJobs();
    // The runner kicks `run()` in unawaited microtasks; wait briefly
    // for the state flip from PENDING/RUNNING.
    await _waitFor(
      () async => (await db.jobById(id))?.state != 'RUNNING',
      timeout: const Duration(seconds: 2),
    );
    // Without bundled precons available, `_drive` will fail the job —
    // but the key signal is that resumption picked it up at all, which
    // we prove via the state transitioning out of plain RUNNING.
    final after = await db.jobById(id);
    expect(after, isNotNull);
    expect(
      after!.state,
      isNot('RUNNING'),
      reason:
          'resumed job must move past plain RUNNING (to FAILED or COMPLETED)',
    );
  });

  test('resumes jobs in PENDING state with PENDING sims remaining', () async {
    final id = await insertJob(state: 'PENDING', total: 5, completed: 2);
    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _NeverCalledSimRunner(),
    );

    await runner.resumeInFlightJobs();
    await _waitFor(
      () async => (await db.jobById(id))?.state != 'PENDING',
      timeout: const Duration(seconds: 2),
    );
    final after = await db.jobById(id);
    expect(after!.state, isNot('PENDING'));
  });

  test('does NOT resume CANCELLED jobs', () async {
    final id = await insertJob(state: 'CANCELLED', total: 5, completed: 1);
    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _NeverCalledSimRunner(),
    );

    await runner.resumeInFlightJobs();
    // Give the unawaited runs a chance to misfire if the filter broke.
    await Future.delayed(const Duration(milliseconds: 150));
    final after = await db.jobById(id);
    expect(
      after!.state,
      'CANCELLED',
      reason:
          'A user-cancelled job must stay cancelled across restarts. '
          'Resuming it would silently re-run sims the user explicitly '
          'stopped.',
    );
  });

  test('does NOT resume FAILED jobs', () async {
    final id = await insertJob(state: 'FAILED', total: 5, completed: 3);
    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _NeverCalledSimRunner(),
    );

    await runner.resumeInFlightJobs();
    await Future.delayed(const Duration(milliseconds: 150));
    final after = await db.jobById(id);
    expect(after!.state, 'FAILED');
  });

  test('does NOT resume COMPLETED jobs even if counters look off', () async {
    // Inconsistent-state regression guard: a job ending COMPLETED with
    // completedSims < totalSims (which can only happen via direct DB
    // edits or future bugs) must still NOT be resumed. The filter's
    // "RUNNING OR (incomplete AND not CANCELLED/FAILED)" branch would
    // pick this up if it didn't also exclude COMPLETED.
    final id = await insertJob(state: 'COMPLETED', total: 5, completed: 3);
    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _NeverCalledSimRunner(),
    );

    await runner.resumeInFlightJobs();
    await Future.delayed(const Duration(milliseconds: 150));
    final after = await db.jobById(id);
    expect(
      after!.state,
      'COMPLETED',
      reason:
          'Inconsistent counters must not resurrect a terminally '
          'COMPLETED job. Better to keep stale-but-stable state than '
          'silently overwrite a finalized run.',
    );
  });
}

/// Polls `check` until it returns true or the deadline passes. Used to
/// wait for the unawaited Futures `resumeInFlightJobs` kicks off.
Future<void> _waitFor(
  Future<bool> Function() check, {
  required Duration timeout,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (await check()) return;
    await Future.delayed(const Duration(milliseconds: 25));
  }
  // Don't throw — the resume tests assert on terminal state, so a
  // polling timeout just means the assertion will fail with a clearer
  // message than a TimeoutException buried in the test harness.
}

class _NeverCalledSimRunner extends SimRunner {
  _NeverCalledSimRunner() : super(javaPath: '/usr/bin/java', forgePath: '/tmp');

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    // Resume should fail-fast on the missing-precons branch before
    // ever calling runOne, since the test rig has no .dck files.
    throw StateError('runOne should not be reached in resume tests');
  }
}
