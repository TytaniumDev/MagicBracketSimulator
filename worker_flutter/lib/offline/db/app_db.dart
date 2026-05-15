import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_db.g.dart';

/// Offline-mode local persistence. One SQLite file per install at
/// `<app-support>/offline.sqlite`. Schema is intentionally narrow for
/// v1 — Jobs, Sims, Settings. Storage pruner trims oldest jobs when
/// the on-disk total exceeds `settings.max_storage_bytes`.
@DataClassName('Job')
class Jobs extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get totalSims => integer()();
  IntColumn get completedSims => integer().withDefault(const Constant(0))();
  TextColumn get state => text().withDefault(const Constant('PENDING'))();
  TextColumn get deck1Name => text()();
  TextColumn get deck2Name => text()();
  TextColumn get deck3Name => text()();
  TextColumn get deck4Name => text()();
}

@DataClassName('Sim')
class Sims extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get jobId => integer().references(Jobs, #id)();
  IntColumn get simIndex => integer()();
  TextColumn get state => text().withDefault(const Constant('PENDING'))();
  TextColumn get winnerDeckName => text().nullable()();
  IntColumn get winningTurn => integer().nullable()();
  IntColumn get durationMs => integer().nullable()();
  TextColumn get errorMessage => text().nullable()();
  TextColumn get logRelPath => text().nullable()();
  DateTimeColumn get startedAt => dateTime().nullable()();
  DateTimeColumn get completedAt => dateTime().nullable()();
}

class Settings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

/// User-created decks. Bundled precons are NOT stored here — they're
/// always listed live from the asset bundle so a `flutter run` after
/// adding a new precon file picks it up without a DB migration.
@DataClassName('DeckRow')
class Decks extends Table {
  IntColumn get id => integer().autoIncrement()();
  // Name is also unique. The offline runner resolves declared job
  // decks by name; the repo's pre-insert check guards the happy
  // path, but the SQL-level UNIQUE makes a race or external write
  // physically impossible.
  TextColumn get name => text().unique()();
  // Slugified filename incl. `.dck` — also the path under
  // `<config.decksPath>/` where the materialized deck lives.
  TextColumn get filename => text().unique()();
  TextColumn get dckContent => text()();
  // Stored as a packed string like "WUB" — null when Scryfall lookup
  // failed or was skipped.
  TextColumn get colorIdentity => text().nullable()();
  TextColumn get link => text().nullable()();
  TextColumn get primaryCommander => text().nullable()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
}

@DriftDatabase(tables: [Jobs, Sims, Settings, Decks])
class AppDb extends _$AppDb {
  AppDb() : super(_openConnection());

  /// Open the schema against an arbitrary `QueryExecutor`. Used by the
  /// test suite with `NativeDatabase.memory()` for hermetic, fast
  /// integration tests that exercise the same SQL the app does at
  /// runtime — but without touching disk.
  AppDb.forTesting(QueryExecutor e) : super(e);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
    },
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        await m.createTable(decks);
      }
    },
  );

  // ── Deck CRUD ────────────────────────────────────────────────────

  /// All user decks newest-first. Caller merges with bundled precons.
  Stream<List<DeckRow>> watchDecks() {
    return (select(decks)..orderBy([
          (d) => OrderingTerm.desc(d.createdAt),
          (d) => OrderingTerm.desc(d.id),
        ]))
        .watch();
  }

  Future<int> insertDeck({
    required String name,
    required String filename,
    required String dckContent,
    String? colorIdentity,
    String? link,
    String? primaryCommander,
  }) {
    return into(decks).insert(
      DecksCompanion.insert(
        name: name,
        filename: filename,
        dckContent: dckContent,
        colorIdentity: Value(colorIdentity),
        link: Value(link),
        primaryCommander: Value(primaryCommander),
      ),
    );
  }

  Future<DeckRow?> deckById(int id) =>
      (select(decks)..where((d) => d.id.equals(id))).getSingleOrNull();

  Future<DeckRow?> deckByFilename(String filename) => (select(
    decks,
  )..where((d) => d.filename.equals(filename))).getSingleOrNull();

  /// First user deck that matches [name]. Used by the offline runner
  /// to resolve job-declared deck names. The repo enforces name
  /// uniqueness at insert time, so callers can trust there is at most
  /// one match.
  Future<DeckRow?> deckByName(String name) =>
      (select(decks)..where((d) => d.name.equals(name))).getSingleOrNull();

  Future<void> deleteDeckById(int id) async {
    await (delete(decks)..where((d) => d.id.equals(id))).go();
  }

  /// All jobs newest-first. Drives the history list.
  ///
  /// Sorted by `createdAt DESC` with `id DESC` as a tiebreaker — two
  /// jobs created in the same millisecond (rare but possible during
  /// scripted bulk-import) still resolve to a stable, monotonically-
  /// newest-first order rather than relying on SQLite's row-storage
  /// order.
  Future<List<Job>> recentJobs({int limit = 50}) {
    return (select(jobs)
          ..orderBy([
            (j) => OrderingTerm.desc(j.createdAt),
            (j) => OrderingTerm.desc(j.id),
          ])
          ..limit(limit))
        .get();
  }

  /// Reactive variant of [recentJobs] — emits a new list whenever the
  /// `jobs` table changes. Avoids per-second polling in the history UI.
  Stream<List<Job>> watchRecentJobs({int limit = 50}) {
    return (select(jobs)
          ..orderBy([
            (j) => OrderingTerm.desc(j.createdAt),
            (j) => OrderingTerm.desc(j.id),
          ])
          ..limit(limit))
        .watch();
  }

  Future<Job?> jobById(int id) =>
      (select(jobs)..where((j) => j.id.equals(id))).getSingleOrNull();

  Future<List<Sim>> simsForJob(int jobId) =>
      (select(sims)
            ..where((s) => s.jobId.equals(jobId))
            ..orderBy([(s) => OrderingTerm.asc(s.simIndex)]))
          .get();

  Stream<Job?> watchJob(int jobId) =>
      (select(jobs)..where((j) => j.id.equals(jobId))).watchSingleOrNull();

  Stream<List<Sim>> watchSimsForJob(int jobId) =>
      (select(sims)
            ..where((s) => s.jobId.equals(jobId))
            ..orderBy([(s) => OrderingTerm.asc(s.simIndex)]))
          .watch();

  /// Insert a brand-new job + N PENDING sim rows in one transaction.
  Future<int> createJob({
    required List<String> deckNames,
    required int simCount,
    String? name,
  }) async {
    assert(deckNames.length == 4, 'Commander bracket needs exactly 4 decks');
    return await transaction(() async {
      final jobId = await into(jobs).insert(
        JobsCompanion.insert(
          name: Value(name),
          createdAt: DateTime.now(),
          totalSims: simCount,
          deck1Name: deckNames[0],
          deck2Name: deckNames[1],
          deck3Name: deckNames[2],
          deck4Name: deckNames[3],
        ),
      );
      for (var i = 0; i < simCount; i++) {
        await into(
          sims,
        ).insert(SimsCompanion.insert(jobId: jobId, simIndex: i));
      }
      return jobId;
    });
  }

  Future<void> updateJobState(int jobId, String state) =>
      (update(jobs)..where((j) => j.id.equals(jobId))).write(
        JobsCompanion(state: Value(state)),
      );

  Future<void> markSimRunning(int simId) =>
      (update(sims)..where((s) => s.id.equals(simId))).write(
        SimsCompanion(
          state: const Value('RUNNING'),
          startedAt: Value(DateTime.now()),
        ),
      );

  Future<void> markSimCompleted(
    int simId, {
    required String winnerDeckName,
    required int? winningTurn,
    required int durationMs,
    String? logRelPath,
  }) async {
    // The read-sim AND its parent-job bump live inside the transaction
    // so a concurrent caller can't observe a partially-updated state.
    await transaction(() async {
      final sim = await (select(
        sims,
      )..where((s) => s.id.equals(simId))).getSingle();
      await (update(sims)..where((s) => s.id.equals(simId))).write(
        SimsCompanion(
          state: const Value('COMPLETED'),
          winnerDeckName: Value(winnerDeckName),
          winningTurn: Value(winningTurn),
          durationMs: Value(durationMs),
          logRelPath: Value(logRelPath),
          completedAt: Value(DateTime.now()),
        ),
      );
      await _bumpJobCompletedCount(sim.jobId);
    });
  }

  Future<void> markSimFailed(
    int simId, {
    required String error,
    required int durationMs,
    String? logRelPath,
  }) async {
    await transaction(() async {
      final sim = await (select(
        sims,
      )..where((s) => s.id.equals(simId))).getSingle();
      await (update(sims)..where((s) => s.id.equals(simId))).write(
        SimsCompanion(
          state: const Value('FAILED'),
          errorMessage: Value(error),
          durationMs: Value(durationMs),
          logRelPath: Value(logRelPath),
          completedAt: Value(DateTime.now()),
        ),
      );
      await _bumpJobCompletedCount(sim.jobId);
    });
  }

  /// Increment the job's `completedSims` counter and only flip the
  /// `state` if the job is still in a non-terminal state. Without the
  /// state guard, a late-arriving sim completion could flip a
  /// user-CANCELLED or precon-FAILED job back to RUNNING/COMPLETED.
  Future<void> _bumpJobCompletedCount(int jobId) async {
    final job = await (select(
      jobs,
    )..where((j) => j.id.equals(jobId))).getSingle();
    final newCompleted = job.completedSims + 1;
    final canFlipState = job.state == 'PENDING' || job.state == 'RUNNING';
    final isDone = newCompleted >= job.totalSims;
    await (update(jobs)..where((j) => j.id.equals(jobId))).write(
      JobsCompanion(
        completedSims: Value(newCompleted),
        state: canFlipState
            ? Value(isDone ? 'COMPLETED' : 'RUNNING')
            : const Value.absent(),
      ),
    );
  }

  /// Settings helpers: a thin string-keyed key/value store for things
  /// that don't justify their own table (storage cap, last-picked decks,
  /// etc.). Default values live in callers — `getSetting` returns null
  /// for unknown keys.
  Future<String?> getSetting(String key) async {
    final row = await (select(
      settings,
    )..where((s) => s.key.equals(key))).getSingleOrNull();
    return row?.value;
  }

  Future<void> setSetting(String key, String value) async {
    await into(
      settings,
    ).insertOnConflictUpdate(SettingsCompanion.insert(key: key, value: value));
  }

  /// Delete a single job and its sims. Used by the storage pruner.
  Future<void> deleteJob(int jobId) async {
    await transaction(() async {
      await (delete(sims)..where((s) => s.jobId.equals(jobId))).go();
      await (delete(jobs)..where((j) => j.id.equals(jobId))).go();
    });
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationSupportDirectory();
    final file = File(p.join(dir.path, 'offline.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
