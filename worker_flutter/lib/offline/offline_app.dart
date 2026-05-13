import 'dart:async';

import 'package:flutter/material.dart';

import '../config.dart';
import '../launch/mode_picker_screen.dart';
import 'db/app_db.dart';
import 'deck_source.dart';
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

// ── Home: new run + history ──────────────────────────────────────

class _HomeScreen extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Magic Bracket — Offline'),
        backgroundColor: const Color(0xFF111827),
        actions: [
          IconButton(
            tooltip: 'Switch to Cloud Sync',
            icon: const Icon(Icons.cloud_sync_outlined),
            onPressed: () async {
              await clearRememberedLaunchMode();
              onSwitchMode();
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                icon: const Icon(Icons.add),
                label: const Text('New simulation run'),
                onPressed: () => _startNewRun(context),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Recent runs',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _HistoryList(db: db, runner: runner, config: config),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _startNewRun(BuildContext context) async {
    final precons = await loadBundledPrecons(config.forgePath);
    if (!context.mounted) return;
    if (precons.length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Only ${precons.length} precons found in ${config.forgePath}/res/Decks/Commander. Need at least 4.',
          ),
        ),
      );
      return;
    }
    final picked = await Navigator.of(context).push<List<PreconDeck>>(
      MaterialPageRoute(builder: (_) => _DeckPickerScreen(precons: precons)),
    );
    if (picked == null || picked.length != 4) return;
    if (!context.mounted) return;
    final simCount = await Navigator.of(context).push<int>(
      MaterialPageRoute(builder: (_) => _NewJobScreen(decks: picked)),
    );
    if (simCount == null || simCount <= 0) return;
    final jobId = await db.createJob(
      deckNames: picked.map((d) => d.displayName).toList(),
      simCount: simCount,
    );
    // Fire-and-forget the run; the progress screen streams from the DB.
    unawaited(runner.run(jobId));
    if (!context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _JobScreen(db: db, jobId: jobId),
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({
    required this.db,
    required this.runner,
    required this.config,
  });

  final AppDb db;
  final OfflineRunner runner;
  final WorkerConfig config;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Job>>(
      // A 1-second poll is plenty for a small history list — drift
      // doesn't expose a `watchAll` shortcut on `recentJobs` and we
      // don't need true reactivity here.
      stream: Stream.periodic(
        const Duration(seconds: 1),
      ).asyncMap((_) => db.recentJobs(limit: 50)),
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
                builder: (_) => _JobScreen(db: db, jobId: jobs[i].id),
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

// ── Deck picker (multi-select 4) ─────────────────────────────────

class _DeckPickerScreen extends StatefulWidget {
  const _DeckPickerScreen({required this.precons});

  final List<PreconDeck> precons;

  @override
  State<_DeckPickerScreen> createState() => _DeckPickerScreenState();
}

class _DeckPickerScreenState extends State<_DeckPickerScreen> {
  final Set<String> _picked = {};
  String _search = '';

  @override
  Widget build(BuildContext context) {
    final filtered = widget.precons
        .where(
          (d) => d.displayName.toLowerCase().contains(_search.toLowerCase()),
        )
        .toList(growable: false);
    return Scaffold(
      appBar: AppBar(
        title: Text('Pick 4 decks (${_picked.length}/4)'),
        backgroundColor: const Color(0xFF111827),
        actions: [
          TextButton(
            onPressed: _picked.length == 4
                ? () {
                    final result = widget.precons
                        .where((d) => _picked.contains(d.displayName))
                        .toList(growable: false);
                    Navigator.of(context).pop(result);
                  }
                : null,
            child: const Text('Next'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Search precons',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: filtered.length,
              itemBuilder: (context, i) {
                final d = filtered[i];
                final picked = _picked.contains(d.displayName);
                return CheckboxListTile(
                  value: picked,
                  title: Text(d.displayName),
                  controlAffinity: ListTileControlAffinity.leading,
                  onChanged: (v) {
                    setState(() {
                      if (v == true && _picked.length < 4) {
                        _picked.add(d.displayName);
                      } else {
                        _picked.remove(d.displayName);
                      }
                    });
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── New job confirm (sim count) ──────────────────────────────────

class _NewJobScreen extends StatefulWidget {
  const _NewJobScreen({required this.decks});

  final List<PreconDeck> decks;

  @override
  State<_NewJobScreen> createState() => _NewJobScreenState();
}

class _NewJobScreenState extends State<_NewJobScreen> {
  int _sims = 10;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Confirm run'),
        backgroundColor: const Color(0xFF111827),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Decks',
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 6),
            for (final d in widget.decks)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '• ${d.displayName}',
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                ),
              ),
            const SizedBox(height: 24),
            Text(
              'Simulations: $_sims',
              style: const TextStyle(color: Colors.white70, fontSize: 13),
            ),
            Slider(
              value: _sims.toDouble(),
              min: 1,
              max: 200,
              divisions: 199,
              label: '$_sims',
              onChanged: (v) => setState(() => _sims = v.round()),
            ),
            const Spacer(),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(_sims),
              child: const Text('Start'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Live progress + results for one job ──────────────────────────

class _JobScreen extends StatelessWidget {
  const _JobScreen({required this.db, required this.jobId});

  final AppDb db;
  final int jobId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Run #$jobId'),
        backgroundColor: const Color(0xFF111827),
      ),
      body: StreamBuilder<Job?>(
        stream: db.watchJob(jobId),
        builder: (context, jobSnap) {
          final job = jobSnap.data;
          if (job == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return StreamBuilder<List<Sim>>(
            stream: db.watchSimsForJob(jobId),
            initialData: const [],
            builder: (context, simsSnap) {
              final sims = simsSnap.data ?? const [];
              return _JobBody(job: job, sims: sims);
            },
          );
        },
      ),
    );
  }
}

class _JobBody extends StatelessWidget {
  const _JobBody({required this.job, required this.sims});

  final Job job;
  final List<Sim> sims;

  @override
  Widget build(BuildContext context) {
    final decks = [job.deck1Name, job.deck2Name, job.deck3Name, job.deck4Name];
    final wins = <String, int>{for (final d in decks) d: 0};
    final winTurns = <String, List<int>>{for (final d in decks) d: []};
    var failures = 0;
    for (final s in sims) {
      if (s.state == 'COMPLETED' && s.winnerDeckName != null) {
        wins[s.winnerDeckName!] = (wins[s.winnerDeckName!] ?? 0) + 1;
        if (s.winningTurn != null) {
          winTurns[s.winnerDeckName!]!.add(s.winningTurn!);
        }
      } else if (s.state == 'FAILED') {
        failures++;
      }
    }
    final completed = sims
        .where((s) => s.state == 'COMPLETED' || s.state == 'FAILED')
        .length;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _StateBadge(state: job.state),
              const SizedBox(width: 8),
              Text(
                '$completed / ${job.totalSims} sims complete'
                '${failures > 0 ? "  •  $failures failed" : ""}',
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ],
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(
            value: job.totalSims == 0 ? 0 : completed / job.totalSims,
          ),
          const SizedBox(height: 24),
          const Text(
            'Win rate by deck',
            style: TextStyle(color: Colors.white70, fontSize: 13),
          ),
          const SizedBox(height: 8),
          for (final d in decks)
            _DeckResultRow(
              name: d,
              wins: wins[d] ?? 0,
              completed: completed - failures,
              winTurns: winTurns[d] ?? const [],
            ),
        ],
      ),
    );
  }
}

class _StateBadge extends StatelessWidget {
  const _StateBadge({required this.state});

  final String state;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (state) {
      'COMPLETED' => ('Done', const Color(0xFF34D399)),
      'FAILED' => ('Failed', const Color(0xFFF87171)),
      'RUNNING' => ('Running', const Color(0xFF60A5FA)),
      _ => ('Pending', const Color(0xFF6B7280)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

class _DeckResultRow extends StatelessWidget {
  const _DeckResultRow({
    required this.name,
    required this.wins,
    required this.completed,
    required this.winTurns,
  });

  final String name;
  final int wins;
  final int completed;
  final List<int> winTurns;

  @override
  Widget build(BuildContext context) {
    final rate = completed == 0 ? 0.0 : wins / completed;
    final avgTurn = winTurns.isEmpty
        ? null
        : winTurns.reduce((a, b) => a + b) / winTurns.length;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  name,
                  style: const TextStyle(color: Colors.white, fontSize: 15),
                ),
              ),
              Text(
                '$wins win${wins == 1 ? "" : "s"}'
                '${avgTurn != null ? "  •  avg turn ${avgTurn.toStringAsFixed(1)}" : ""}',
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(value: rate, minHeight: 6),
          ),
        ],
      ),
    );
  }
}
