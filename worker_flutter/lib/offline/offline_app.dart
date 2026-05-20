import 'dart:async';

import 'package:flutter/material.dart';

import '../config.dart';
import '../decks/deck_repo.dart';
import '../decks/offline_deck_repo.dart';
import '../launch/mode_picker_screen.dart';
import '../sims/simulate_screen.dart';
import 'db/app_db.dart';
import 'local_job_screen.dart';
import 'offline_runner.dart';

/// Top-level offline-mode shell. Owns the AppDb + WorkerConfig and
/// hosts a Navigator with the home, deck picker, progress, and
/// results screens.
class OfflineApp extends StatefulWidget {
  const OfflineApp({
    super.key,
    required this.config,
    required this.onSwitchMode,
  });

  final WorkerConfig config;
  final VoidCallback onSwitchMode;

  @override
  State<OfflineApp> createState() => _OfflineAppState();
}

class _OfflineAppState extends State<OfflineApp> {
  late final AppDb _db;
  late final OfflineRunner _runner;

  @override
  void initState() {
    super.initState();
    _db = AppDb();
    _runner = OfflineRunner(db: _db, config: widget.config);
    // Pick up any job that was mid-run last session. Sequentially-
    // queued, runs in the background; the UI doesn't block on it.
    unawaited(_runner.resumeInFlightJobs());
  }

  @override
  void dispose() {
    _db.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Magic Bracket — Offline',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF1F2937),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF60A5FA),
          surface: Color(0xFF111827),
        ),
      ),
      home: _HomeScreen(
        db: _db,
        runner: _runner,
        config: widget.config,
        onSwitchMode: widget.onSwitchMode,
      ),
    );
  }
}

// ── Home: tabbed History | Simulate ──────────────────────────────

class _HomeScreen extends StatefulWidget {
  const _HomeScreen({
    required this.db,
    required this.runner,
    required this.config,
    required this.onSwitchMode,
  });

  final AppDb db;
  final OfflineRunner runner;
  final WorkerConfig config;
  final VoidCallback onSwitchMode;

  @override
  State<_HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<_HomeScreen> {
  late final DeckRepo _deckRepo;

  @override
  void initState() {
    super.initState();
    _deckRepo = OfflineDeckRepo(db: widget.db, config: widget.config);
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Magic Bracket — Offline'),
          backgroundColor: const Color(0xFF111827),
          actions: [
            IconButton(
              tooltip: 'Switch to Cloud Sync',
              icon: const Icon(Icons.cloud_sync_outlined),
              onPressed: () async {
                await clearRememberedLaunchMode();
                widget.onSwitchMode();
              },
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(icon: Icon(Icons.history), text: 'History'),
              Tab(icon: Icon(Icons.play_arrow), text: 'Simulate'),
            ],
            labelColor: Color(0xFF60A5FA),
            unselectedLabelColor: Colors.white70,
            indicatorColor: Color(0xFF60A5FA),
          ),
        ),
        body: TabBarView(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: _HistoryList(db: widget.db, runner: widget.runner),
            ),
            SimulateScreen(
              repo: _deckRepo,
              // Offline mode is local by definition — ignore the
              // `runLocally` flag and always dispatch to the local
              // runner. The flag exists for cloud mode's checkbox.
              onStart: (decks, simCount, {required bool runLocally}) async {
                final jobId = await widget.db.createJob(
                  deckNames: decks.map((d) => d.name).toList(),
                  simCount: simCount,
                );
                unawaited(widget.runner.run(jobId));
                return jobId.toString();
              },
              onJobCreated: (ctx, jobId) {
                final id = int.tryParse(jobId);
                if (id == null) return;
                Navigator.of(ctx).push(
                  MaterialPageRoute(
                    builder: (_) => LocalJobScreen(
                      db: widget.db,
                      runner: widget.runner,
                      jobId: id,
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.db, required this.runner});

  final AppDb db;
  final OfflineRunner runner;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Job>>(
      // Drift's table watch fires on every relevant write — no polling,
      // no 1-second staleness.
      stream: db.watchRecentJobs(limit: 50),
      initialData: const [],
      builder: (context, snap) {
        final jobs = snap.data ?? const [];
        if (jobs.isEmpty) {
          return const Center(
            child: Text(
              'No runs yet — kick off one above.',
              style: TextStyle(color: Colors.white54),
            ),
          );
        }
        return ListView.separated(
          itemCount: jobs.length,
          separatorBuilder: (_, _) => const SizedBox(height: 6),
          itemBuilder: (context, i) => _JobRow(
            job: jobs[i],
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) =>
                    LocalJobScreen(db: db, runner: runner, jobId: jobs[i].id),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _JobRow extends StatelessWidget {
  const _JobRow({required this.job, required this.onTap});

  final Job job;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final progress = job.totalSims == 0
        ? 0.0
        : job.completedSims / job.totalSims;
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF111827),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: switch (job.state) {
                  'COMPLETED' => const Color(0xFF34D399),
                  'FAILED' => const Color(0xFFF87171),
                  'RUNNING' => const Color(0xFF60A5FA),
                  _ => const Color(0xFF6B7280),
                },
                borderRadius: BorderRadius.circular(5),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '#${job.id} • ${job.completedSims}/${job.totalSims} sims',
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${job.deck1Name} · ${job.deck2Name} · ${job.deck3Name} · ${job.deck4Name}',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 60,
              child: LinearProgressIndicator(value: progress.clamp(0.0, 1.0)),
            ),
          ],
        ),
      ),
    );
  }
}
