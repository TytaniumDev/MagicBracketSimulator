import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:worker_flutter/config.dart';
import 'package:worker_flutter/models/sim.dart';
import 'package:worker_flutter/offline/db/app_db.dart';
import 'package:worker_flutter/offline/offline_runner.dart';
import 'package:worker_flutter/worker/sim_runner.dart';

/// `_maybePersistLog` is intentionally non-throwing — the sim's
/// terminal state should be writable even when the log file can't be
/// dropped to disk (full /tmp, read-only mount, etc.). These tests
/// pin that contract so a refactor toward "fail loudly" doesn't
/// silently flip the offline mode into hanging-on-log-write mode.
void main() {
  late Directory tempRoot;
  late WorkerConfig config;
  late AppDb db;

  Future<void> setUpConfig({required String logsPath}) async {
    tempRoot = await Directory.systemTemp.createTemp('log_persist_test_');
    final commander = Directory(
      p.join(tempRoot.path, 'forge', 'res', 'Decks', 'Commander'),
    );
    commander.createSync(recursive: true);
    for (final name in ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      File(p.join(commander.path, '$name.dck')).writeAsStringSync('[Main]\n');
    }
    final decksDir = Directory(p.join(tempRoot.path, 'staged'))
      ..createSync(recursive: true);

    config = WorkerConfig(
      workerId: 'w',
      workerName: 'w',
      maxCapacity: 1,
      forgePath: p.join(tempRoot.path, 'forge'),
      javaPath: '/usr/bin/java',
      decksPath: decksDir.path,
      logsPath: logsPath,
      apiUrl: 'http://localhost',
      workerSecret: null,
    );
    db = AppDb.forTesting(NativeDatabase.memory());
  }

  tearDown(() async {
    await db.close();
    if (tempRoot.existsSync()) tempRoot.deleteSync(recursive: true);
  });

  test('sim still marks COMPLETED when log directory does not exist', () async {
    // Point logsPath at a directory that was never created. Dart's
    // `File.writeAsStringSync` throws FileSystemException on missing
    // parents; this is the exact "log persistence fails" shape we
    // want to prove doesn't infect the sim's terminal state.
    final ephemeral = await Directory.systemTemp.createTemp('log_missing_');
    ephemeral.deleteSync();
    await setUpConfig(logsPath: p.join(ephemeral.path, 'never-created'));

    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _SuccessStubRunner(),
    );
    final jobId = await db.createJob(
      deckNames: const ['Alpha', 'Beta', 'Gamma', 'Delta'],
      simCount: 1,
    );
    await runner.run(jobId);

    final job = await db.jobById(jobId);
    expect(
      job!.state,
      'COMPLETED',
      reason:
          'A log write failure must not infect the sim terminal state. '
          'Even with the logsPath missing, the SimRunner succeeded and '
          'the job should finalize.',
    );
    final sims = await db.simsForJob(jobId);
    expect(sims.single.state, 'COMPLETED');
    expect(
      sims.single.logRelPath,
      isNull,
      reason:
          'log path is nulled out when persistence fails — null is the '
          'sentinel UI code checks before offering a "View log" button',
    );
  });

  test('logs are persisted to logsPath when writable', () async {
    // Sanity counter-test: with a normal writable logs dir, the
    // persistence succeeds and logRelPath round-trips into the Sim
    // row. Ensures the "missing path" test above is exercising the
    // failure branch, not the normal one.
    final tempLogs = await Directory.systemTemp.createTemp('log_ok_');
    await setUpConfig(logsPath: tempLogs.path);

    final runner = OfflineRunner(
      db: db,
      config: config,
      runnerOverride: _SuccessStubRunner(logText: 'real sim stdout'),
    );
    final jobId = await db.createJob(
      deckNames: const ['Alpha', 'Beta', 'Gamma', 'Delta'],
      simCount: 1,
    );
    await runner.run(jobId);

    final sims = await db.simsForJob(jobId);
    expect(sims.single.logRelPath, isNotNull);
    final written = File(p.join(tempLogs.path, sims.single.logRelPath!));
    expect(written.existsSync(), isTrue);
    expect(written.readAsStringSync(), 'real sim stdout');

    if (tempLogs.existsSync()) tempLogs.deleteSync(recursive: true);
  });
}

class _SuccessStubRunner extends SimRunner {
  _SuccessStubRunner({this.logText = 'stub log'})
    : super(javaPath: '/usr/bin/java', forgePath: '/tmp');

  final String logText;

  @override
  Future<SimResult> runOne({
    required JobInfo job,
    Future<void>? cancelSignal,
  }) async {
    return SimResult(
      success: true,
      durationMs: 10,
      winners: const ['Ai(1)-Alpha'],
      winningTurns: const [7],
      logText: logText,
      errorMessage: null,
    );
  }
}
