import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'db/app_db.dart';
import 'offline_runner.dart';

/// Live progress + results for a single AppDb-backed job. Used by both
/// offline mode and cloud mode's "Run locally" path so the user sees the
/// same UI regardless of which boot mode they're in.
///
/// The screen is purely read-driven: it streams the job + per-sim docs
/// from `AppDb` and renders win-rate / failure detail. The optional
/// `OfflineRunner` is only used to surface a Cancel button — pass null
/// to view a historical job read-only.
class LocalJobScreen extends StatelessWidget {
  const LocalJobScreen({
    super.key,
    required this.db,
    required this.jobId,
    this.runner,
  });

  final AppDb db;
  final OfflineRunner? runner;
  final int jobId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Run #$jobId'),
        backgroundColor: const Color(0xFF111827),
        actions: [
          if (runner != null)
            StreamBuilder<Job?>(
              stream: db.watchJob(jobId),
              builder: (context, snap) {
                final job = snap.data;
                if (job == null) return const SizedBox.shrink();
                final canCancel =
                    job.state == 'PENDING' || job.state == 'RUNNING';
                if (!canCancel) return const SizedBox.shrink();
                return TextButton.icon(
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Cancel'),
                  onPressed: () async {
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('Cancel run?'),
                        content: const Text(
                          'Any sim currently running will be killed; '
                          'remaining queued sims will be marked cancelled.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.of(ctx).pop(false),
                            child: const Text('Keep running'),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: const Color(0xFFF87171),
                            ),
                            onPressed: () => Navigator.of(ctx).pop(true),
                            child: const Text('Cancel run'),
                          ),
                        ],
                      ),
                    );
                    if (confirmed == true) await runner!.cancel(jobId);
                  },
                );
              },
            ),
        ],
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
    final failedSims = <Sim>[];
    for (final s in sims) {
      if (s.state == 'COMPLETED' && s.winnerDeckName != null) {
        wins[s.winnerDeckName!] = (wins[s.winnerDeckName!] ?? 0) + 1;
        if (s.winningTurn != null) {
          winTurns[s.winnerDeckName!]!.add(s.winningTurn!);
        }
      } else if (s.state == 'FAILED') {
        failedSims.add(s);
      }
    }
    final completed = sims
        .where((s) => s.state == 'COMPLETED' || s.state == 'FAILED')
        .length;
    final failures = failedSims.length;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            _StateBadge(state: job.state),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '$completed / ${job.totalSims} sims complete'
                '${failures > 0 ? "  •  $failures failed" : ""}',
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: job.totalSims == 0 ? 0 : completed / job.totalSims,
            minHeight: 6,
          ),
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
        if (failedSims.isNotEmpty) ...[
          const SizedBox(height: 16),
          _FailedSimsCard(failedSims: failedSims),
        ],
      ],
    );
  }
}

/// Collapsible card that lists each failed sim's error message + a
/// "View log" button if the runner persisted stdout. Without this the
/// user only sees "$N failed" with no path to root-cause.
class _FailedSimsCard extends StatelessWidget {
  const _FailedSimsCard({required this.failedSims});

  final List<Sim> failedSims;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF111827),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: Color(0xFF374151)),
      ),
      child: ExpansionTile(
        iconColor: Colors.white70,
        collapsedIconColor: Colors.white70,
        title: Text(
          '${failedSims.length} failed sim${failedSims.length == 1 ? "" : "s"}',
          style: const TextStyle(color: Colors.white, fontSize: 14),
        ),
        children: [
          for (final s in failedSims)
            ListTile(
              dense: true,
              title: Text(
                'Sim #${s.simIndex}',
                style: const TextStyle(color: Colors.white, fontSize: 13),
              ),
              subtitle: Text(
                s.errorMessage ?? '(no error message)',
                style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 12),
              ),
              trailing: s.logRelPath == null
                  ? null
                  : TextButton(
                      onPressed: () =>
                          _showLog(context, sim: s, relPath: s.logRelPath!),
                      child: const Text('View log'),
                    ),
            ),
        ],
      ),
    );
  }

  Future<void> _showLog(
    BuildContext context, {
    required Sim sim,
    required String relPath,
  }) async {
    final appSupport = (await getApplicationSupportDirectory()).path;
    final path = p.join(appSupport, 'sim-logs', relPath);
    String body;
    try {
      body = await File(path).readAsString();
    } catch (e) {
      body = 'Failed to read log at $path: $e';
    }
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: const Color(0xFF111827),
        child: Container(
          width: 800,
          height: 600,
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Sim #${sim.simIndex} log',
                      style: const TextStyle(color: Colors.white, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    color: Colors.white70,
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ],
              ),
              const Divider(color: Color(0xFF374151)),
              Expanded(
                child: Scrollbar(
                  child: SingleChildScrollView(
                    child: SelectableText(
                      body,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontFamily: 'Menlo',
                        fontSize: 11,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
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
