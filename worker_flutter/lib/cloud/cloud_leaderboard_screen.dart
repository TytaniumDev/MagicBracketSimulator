import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'cloud_job_detail_screen.dart' show CloudJobDetailScreen;

/// Lightweight client-side leaderboard.
///
/// The web frontend's `Leaderboard.tsx` reads pre-aggregated, Bayesian-
/// adjusted ratings from `/api/leaderboard`, which requires auth. The
/// Flutter cloud-mode worker doesn't have auth yet, so we aggregate
/// from the public-read `jobs` collection instead. Less sophisticated
/// (no Bayesian smoothing, no win-turn histogram) but works without
/// any new rules. Plan 3 can swap in the API endpoint once Google
/// Sign-In ships.
class CloudLeaderboardScreen extends StatelessWidget {
  const CloudLeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // Limit to recent jobs to keep aggregation cheap. Frontend defaults
    // to 500; 200 here is plenty for an at-a-glance view.
    final query = FirebaseFirestore.instance
        .collection('jobs')
        .orderBy('createdAt', descending: true)
        .limit(200);
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: query.snapshots(),
      builder: (context, snap) {
        if (snap.hasError) {
          return _Message(
            icon: Icons.cloud_off,
            text: 'Couldn\'t reach Firestore: ${snap.error}',
          );
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final entries = _aggregate(snap.data!.docs);
        if (entries.isEmpty) {
          return const _Message(
            icon: Icons.leaderboard_outlined,
            text: 'No completed games yet.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          itemCount: entries.length + 1,
          separatorBuilder: (_, _) => const SizedBox(height: 6),
          itemBuilder: (context, i) {
            if (i == 0) return const _HeaderRow();
            return _LeaderboardRow(entry: entries[i - 1], rank: i);
          },
        );
      },
    );
  }
}

class _LeaderboardEntry {
  _LeaderboardEntry({
    required this.deckName,
    required this.wins,
    required this.games,
    required this.totalWinTurns,
    required this.lastSeenJobId,
  });

  final String deckName;
  int wins;
  int games;
  int totalWinTurns;
  int totalWinTurnSamples = 0;
  String lastSeenJobId;

  double get winRate => games == 0 ? 0 : wins / games;

  double? get avgWinTurn =>
      totalWinTurnSamples == 0 ? null : totalWinTurns / totalWinTurnSamples;
}

/// Walk completed jobs once. Each deck listed on a job contributes
/// `simsCompleted` games (regardless of whether it won — that's the
/// denominator). Each completed sim's winner contributes one win to
/// the matching deck.
List<_LeaderboardEntry> _aggregate(
  List<QueryDocumentSnapshot<Map<String, dynamic>>> docs,
) {
  final byName = <String, _LeaderboardEntry>{};
  for (final doc in docs) {
    final data = doc.data();
    final status = data['status'] as String?;
    // Skip in-flight or failed jobs — incomplete sims would skew the
    // denominator. Only finished or partially-finished-and-finalized
    // jobs contribute.
    if (status != 'COMPLETED' && status != 'CANCELLED') continue;

    final deckNames = _deckNames(data);
    if (deckNames.isEmpty) continue;
    final completedSims = (data['completedSimCount'] as num?)?.toInt() ?? 0;
    if (completedSims == 0) continue;

    // Each deck participated in completedSims games.
    for (final name in deckNames) {
      final e = byName.putIfAbsent(
        name,
        () => _LeaderboardEntry(
          deckName: name,
          wins: 0,
          games: 0,
          totalWinTurns: 0,
          lastSeenJobId: doc.id,
        ),
      );
      e.games += completedSims;
      e.lastSeenJobId = doc.id;
    }

    // Per-deck wins live in `aggregateResults.winsByDeck` once
    // aggregation has run; fall back to walking sims if missing.
    final agg = data['aggregateResults'] as Map?;
    final wins = agg?['winsByDeck'];
    final turns = agg?['avgWinTurnsByDeck'];
    if (wins is Map) {
      wins.forEach((k, v) {
        final e = byName[k];
        if (e == null || v is! num) return;
        e.wins += v.toInt();
        if (turns is Map) {
          final t = turns[k];
          if (t is num) {
            e.totalWinTurns += (t * v.toInt()).round();
            e.totalWinTurnSamples += v.toInt();
          }
        }
      });
    }
  }

  final list = byName.values.where((e) => e.games > 0).toList(growable: false);
  // Sort by win rate descending, with games-played as a tiebreaker
  // (more games = more stable rate).
  list.sort((a, b) {
    final cmp = b.winRate.compareTo(a.winRate);
    return cmp != 0 ? cmp : b.games.compareTo(a.games);
  });
  return list;
}

class _HeaderRow extends StatelessWidget {
  const _HeaderRow();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 36,
            child: Text(
              '#',
              style: TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ),
          Expanded(
            child: Text(
              'Deck',
              style: TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ),
          SizedBox(
            width: 70,
            child: Text(
              'Win rate',
              textAlign: TextAlign.right,
              style: TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ),
          SizedBox(
            width: 60,
            child: Text(
              'Games',
              textAlign: TextAlign.right,
              style: TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ),
          SizedBox(
            width: 80,
            child: Text(
              'Avg turn',
              textAlign: TextAlign.right,
              style: TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }
}

class _LeaderboardRow extends StatelessWidget {
  const _LeaderboardRow({required this.entry, required this.rank});

  final _LeaderboardEntry entry;
  final int rank;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CloudJobDetailScreen(jobId: entry.lastSeenJobId),
        ),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF111827),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 36,
              child: Text(
                '$rank',
                style: TextStyle(
                  color: rank <= 3 ? const Color(0xFFFCD34D) : Colors.white70,
                  fontSize: 14,
                  fontWeight: rank <= 3 ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
            Expanded(
              child: Text(
                entry.deckName,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            SizedBox(
              width: 70,
              child: Text(
                '${(entry.winRate * 100).toStringAsFixed(1)}%',
                textAlign: TextAlign.right,
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
            SizedBox(
              width: 60,
              child: Text(
                '${entry.games}',
                textAlign: TextAlign.right,
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
            ),
            SizedBox(
              width: 80,
              child: Text(
                entry.avgWinTurn == null
                    ? '—'
                    : entry.avgWinTurn!.toStringAsFixed(1),
                textAlign: TextAlign.right,
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Colors.white38, size: 40),
            const SizedBox(height: 12),
            Text(text, style: const TextStyle(color: Colors.white54)),
          ],
        ),
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
