import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/offline/db/app_db.dart';

/// Drift schema tests. In-memory SQLite, hermetic.
///
/// These are tight, mechanical guarantees the offline-mode UI relies
/// on — atomic counter bumps, terminal-state preservation, and the
/// reactive table watch that drives the live job screen.
void main() {
  late AppDb db;

  setUp(() {
    db = AppDb.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
  });

  const decks = ['One', 'Two', 'Three', 'Four'];

  group('createJob', () {
    test('inserts job + N PENDING sims atomically', () async {
      final id = await db.createJob(deckNames: decks, simCount: 5);
      final job = await db.jobById(id);
      expect(job, isNotNull);
      expect(job!.state, 'PENDING');
      expect(job.totalSims, 5);
      expect(job.completedSims, 0);

      final sims = await db.simsForJob(id);
      expect(sims.length, 5);
      expect(sims.every((s) => s.state == 'PENDING'), isTrue);
      expect(sims.map((s) => s.simIndex).toList(), [0, 1, 2, 3, 4]);
    });

    test('refuses brackets that are not exactly 4 decks', () async {
      // The assert lives on the public API to enforce the Commander
      // 4-player invariant. Test in debug-mode (assertions on).
      expect(
        () => db.createJob(deckNames: const ['Only', 'Three'], simCount: 1),
        throwsA(isA<AssertionError>()),
      );
    });
  });

  group('markSimCompleted', () {
    test('bumps completedSims atomically with the sim state update', () async {
      final jobId = await db.createJob(deckNames: decks, simCount: 3);
      final sims = await db.simsForJob(jobId);

      await db.markSimCompleted(
        sims[0].id,
        winnerDeckName: 'One',
        winningTurn: 12,
        durationMs: 1500,
      );

      final job = await db.jobById(jobId);
      expect(job!.completedSims, 1);
      expect(job.state, 'RUNNING');

      final refreshed = await db.simsForJob(jobId);
      expect(refreshed[0].state, 'COMPLETED');
      expect(refreshed[0].winnerDeckName, 'One');
      expect(refreshed[0].winningTurn, 12);
      expect(refreshed[0].durationMs, 1500);
    });

    test('flips job to COMPLETED on the last sim completion', () async {
      final jobId = await db.createJob(deckNames: decks, simCount: 2);
      final sims = await db.simsForJob(jobId);

      await db.markSimCompleted(
        sims[0].id,
        winnerDeckName: 'One',
        winningTurn: 5,
        durationMs: 100,
      );
      var job = await db.jobById(jobId);
      expect(job!.state, 'RUNNING');

      await db.markSimCompleted(
        sims[1].id,
        winnerDeckName: 'Two',
        winningTurn: 11,
        durationMs: 200,
      );
      job = await db.jobById(jobId);
      expect(job!.state, 'COMPLETED');
      expect(job.completedSims, 2);
    });
  });

  group('markSimFailed', () {
    test('counts as completion for progress purposes', () async {
      final jobId = await db.createJob(deckNames: decks, simCount: 2);
      final sims = await db.simsForJob(jobId);

      await db.markSimFailed(sims[0].id, error: 'java crashed', durationMs: 0);
      await db.markSimFailed(sims[1].id, error: 'java crashed', durationMs: 0);

      final job = await db.jobById(jobId);
      expect(
        job!.completedSims,
        2,
        reason:
            'failed sims still increment the counter so the job '
            'finalizes rather than hanging on the 2h stale-sweeper',
      );
      expect(job.state, 'COMPLETED');
    });
  });

  group('terminal-state preservation', () {
    test('late sim completion does NOT resurrect a CANCELLED job', () async {
      // Regression guard: an earlier bug in `_bumpJobCompletedCount`
      // unconditionally rewrote `state` on every increment, which
      // could flip a user-cancelled (or precon-failed) job back to
      // RUNNING/COMPLETED when a stale in-flight sim finally landed.
      final jobId = await db.createJob(deckNames: decks, simCount: 3);
      final sims = await db.simsForJob(jobId);

      // Simulate the runner cancelling the job mid-run.
      await db.updateJobState(jobId, 'CANCELLED');

      // A sim that was already running at cancel time finalizes.
      await db.markSimCompleted(
        sims[0].id,
        winnerDeckName: 'One',
        winningTurn: 8,
        durationMs: 500,
      );

      final job = await db.jobById(jobId);
      expect(
        job!.state,
        'CANCELLED',
        reason: 'sim completion must not flip the job out of CANCELLED',
      );
      expect(
        job.completedSims,
        1,
        reason:
            'the counter still increments — only the state field is preserved',
      );
    });

    test('late sim completion does NOT resurrect a FAILED job', () async {
      final jobId = await db.createJob(deckNames: decks, simCount: 3);
      final sims = await db.simsForJob(jobId);

      await db.updateJobState(jobId, 'FAILED');
      await db.markSimCompleted(
        sims[0].id,
        winnerDeckName: 'One',
        winningTurn: 8,
        durationMs: 500,
      );

      final job = await db.jobById(jobId);
      expect(job!.state, 'FAILED');
    });
  });

  group('reactive watches', () {
    test('watchSimsForJob emits on every sim write', () async {
      final jobId = await db.createJob(deckNames: decks, simCount: 2);
      final stream = db.watchSimsForJob(jobId);
      final received = <int>[];
      final sub = stream.listen(
        (sims) =>
            received.add(sims.where((s) => s.state == 'COMPLETED').length),
      );

      // The history list + live job screen depend on this stream
      // updating after each `markSim*` call.
      final sims = await db.simsForJob(jobId);
      await db.markSimCompleted(
        sims[0].id,
        winnerDeckName: 'One',
        winningTurn: 5,
        durationMs: 100,
      );
      await db.markSimCompleted(
        sims[1].id,
        winnerDeckName: 'Two',
        winningTurn: 11,
        durationMs: 200,
      );
      // Drift batches notifications; give them a turn to flush.
      await Future.delayed(const Duration(milliseconds: 50));
      await sub.cancel();

      // First emission is the initial state (0 completed); subsequent
      // emissions reflect 1 then 2 completed.
      expect(
        received,
        containsAllInOrder([0, 1, 2]),
        reason:
            'each completion must produce a stream emission so the '
            'live job screen updates in real time',
      );
    });

    test('watchRecentJobs emits on every new job', () async {
      final stream = db.watchRecentJobs();
      var lastCount = 0;
      final sub = stream.listen((jobs) => lastCount = jobs.length);

      await db.createJob(deckNames: decks, simCount: 1);
      await db.createJob(deckNames: decks, simCount: 1);
      await Future.delayed(const Duration(milliseconds: 50));
      await sub.cancel();

      expect(
        lastCount,
        2,
        reason: 'history list must show new runs without a refresh',
      );
    });
  });

  group('recentJobs ordering', () {
    test('returns jobs newest-first', () async {
      final a = await db.createJob(deckNames: decks, simCount: 1, name: 'a');
      await Future.delayed(const Duration(milliseconds: 5));
      final b = await db.createJob(deckNames: decks, simCount: 1, name: 'b');
      await Future.delayed(const Duration(milliseconds: 5));
      final c = await db.createJob(deckNames: decks, simCount: 1, name: 'c');

      final jobs = await db.recentJobs();
      expect(jobs.map((j) => j.id).toList(), [c, b, a]);
    });

    test('honors the limit argument', () async {
      for (var i = 0; i < 5; i++) {
        await db.createJob(deckNames: decks, simCount: 1);
      }
      final jobs = await db.recentJobs(limit: 3);
      expect(jobs.length, 3);
    });
  });

  group('deleteJob', () {
    test('cascades to all sims for the job', () async {
      final id = await db.createJob(deckNames: decks, simCount: 5);
      await db.deleteJob(id);
      expect(await db.jobById(id), isNull);
      expect(await db.simsForJob(id), isEmpty);
    });
  });
}
