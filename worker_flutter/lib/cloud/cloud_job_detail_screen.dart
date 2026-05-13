import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

/// Read-only view of one cloud job. Mirrors the spine of the web
/// frontend's `JobStatus.tsx` — job metadata, progress, per-deck win
/// counts, and the per-sim grid. Skips actions (cancel / delete /
/// resubmit) because they all require an authenticated user.
class CloudJobDetailScreen extends StatelessWidget {
  const CloudJobDetailScreen({super.key, required this.jobId});

  final String jobId;

  @override
  Widget build(BuildContext context) {
    final jobRef = FirebaseFirestore.instance.collection('jobs').doc(jobId);
    final simsQuery = jobRef.collection('simulations').orderBy('index');
    return Scaffold(
      appBar: AppBar(
        title: Text('Job ${jobId.substring(0, 8)}…'),
        backgroundColor: const Color(0xFF111827),
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: jobRef.snapshots(),
        builder: (context, jobSnap) {
          if (jobSnap.hasError) {
            return _ErrorMessage(error: jobSnap.error.toString());
          }
          if (!jobSnap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final job = jobSnap.data!.data();
          if (job == null) {
            return const _ErrorMessage(error: 'Job not found.');
          }
          return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: simsQuery.snapshots(),
            builder: (context, simsSnap) {
              final sims = (simsSnap.data?.docs ?? const [])
                  .map((d) => d.data())
                  .toList(growable: false);
              return _Body(job: job, sims: sims);
            },
          );
        },
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.job, required this.sims});

  final Map<String, dynamic> job;
  final List<Map<String, dynamic>> sims;

  @override
  Widget build(BuildContext context) {
    final status = (job['status'] as String?) ?? 'QUEUED';
    final deckNames = _deckNames(job);
    final completed = (job['completedSimCount'] as num?)?.toInt() ?? 0;
    final total = (job['totalSimCount'] as num?)?.toInt() ?? sims.length;
    final progress = total == 0 ? 0.0 : (completed / total).clamp(0.0, 1.0);

    // Aggregate per-deck win counts + win turns from finished sims.
    final wins = <String, int>{for (final d in deckNames) d: 0};
    final winTurns = <String, List<int>>{for (final d in deckNames) d: []};
    var failed = 0;
    for (final s in sims) {
      final state = (s['state'] as String?) ?? '';
      if (state == 'COMPLETED') {
        final winner = (s['winner'] as String?) ?? '';
        final match = _matchDeck(winner, deckNames);
        if (match != null) {
          wins[match] = (wins[match] ?? 0) + 1;
          final t = (s['winningTurn'] as num?)?.toInt();
          if (t != null) winTurns[match]!.add(t);
        }
      } else if (state == 'FAILED') {
        failed++;
      }
    }
    final completedSims = sims
        .where((s) => s['state'] == 'COMPLETED' || s['state'] == 'FAILED')
        .length;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            _StatusBadge(status: status),
            const SizedBox(width: 10),
            Text(
              '$completedSims / $total sims'
              '${failed > 0 ? "  •  $failed failed" : ""}',
              style: const TextStyle(color: Colors.white70),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(value: progress, minHeight: 6),
        ),
        const SizedBox(height: 24),
        const Text(
          'Win rate by deck',
          style: TextStyle(color: Colors.white70, fontSize: 13),
        ),
        const SizedBox(height: 8),
        for (final d in deckNames)
          _DeckRow(
            name: d,
            wins: wins[d] ?? 0,
            // exclude failures from rate denominator
            completed: completedSims - failed,
            winTurns: winTurns[d] ?? const [],
          ),
        const SizedBox(height: 24),
        Text(
          'Simulations (${sims.length})',
          style: const TextStyle(color: Colors.white70, fontSize: 13),
        ),
        const SizedBox(height: 8),
        _SimulationGrid(sims: sims),
      ],
    );
  }
}

class _DeckRow extends StatelessWidget {
  const _DeckRow({
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
                '$wins win${wins == 1 ? "" : "s"} '
                '(${(rate * 100).toStringAsFixed(0)}%)'
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

class _SimulationGrid extends StatelessWidget {
  const _SimulationGrid({required this.sims});

  final List<Map<String, dynamic>> sims;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: [
        for (final s in sims)
          Tooltip(
            message: _simTooltip(s),
            child: Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                color: _simColor(s['state'] as String? ?? ''),
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
      ],
    );
  }
}

Color _simColor(String state) {
  return switch (state) {
    'COMPLETED' => const Color(0xFF34D399),
    'FAILED' => const Color(0xFFF87171),
    'CANCELLED' => const Color(0xFFFB923C),
    'RUNNING' => const Color(0xFF60A5FA),
    _ => const Color(0xFF374151),
  };
}

String _simTooltip(Map<String, dynamic> s) {
  final state = s['state'] as String? ?? '';
  final idx = (s['index'] as num?)?.toInt() ?? 0;
  final winner = s['winner'] as String?;
  final dur = (s['durationMs'] as num?)?.toInt();
  final parts = <String>['#$idx', state];
  if (winner != null) parts.add(winner);
  if (dur != null) parts.add('${(dur / 1000).toStringAsFixed(1)}s');
  return parts.join(' · ');
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'COMPLETED' => ('Completed', const Color(0xFF34D399)),
      'FAILED' => ('Failed', const Color(0xFFF87171)),
      'CANCELLED' => ('Cancelled', const Color(0xFFFB923C)),
      'RUNNING' => ('Running', const Color(0xFF60A5FA)),
      _ => ('Queued', const Color(0xFF6B7280)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ErrorMessage extends StatelessWidget {
  const _ErrorMessage({required this.error});

  final String error;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Text(error, style: const TextStyle(color: Colors.redAccent)),
      ),
    );
  }
}

List<String> _deckNames(Map<String, dynamic> data) {
  final raw = data['decks'];
  if (raw is! List) return const [];
  return raw
      .whereType<Map>()
      .map((d) => d['name'] as String?)
      .whereType<String>()
      .toList(growable: false);
}

/// Forge winners come back as `"Ai(N)-deckName"` or just `"deckName"`.
/// Match either form against the job's declared decks.
String? _matchDeck(String forgeWinner, List<String> deckNames) {
  final stripped = forgeWinner.replaceFirst(RegExp(r'^Ai\(\d+\)-'), '');
  for (final d in deckNames) {
    if (d == stripped || d == forgeWinner) return d;
  }
  // Fuzzy: forge sometimes lowercases / hyphenates. Try a normalized
  // compare.
  final norm = stripped.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toLowerCase();
  for (final d in deckNames) {
    final dnorm = d.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').toLowerCase();
    if (dnorm == norm) return d;
  }
  return null;
}
