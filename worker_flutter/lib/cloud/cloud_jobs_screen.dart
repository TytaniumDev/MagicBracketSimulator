import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'cloud_job_detail_screen.dart';

/// Cloud-mode jobs browser — a read-only port of the web frontend's
/// `Browse.tsx`. Mirrors the same Firestore query (recent jobs, ordered
/// by createdAt descending) and the same lifecycle badges.
///
/// Stays read-only for now: creates / cancels / deletes all require
/// auth, which the Flutter worker doesn't have yet (Plan 3).
class CloudJobsScreen extends StatelessWidget {
  const CloudJobsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final query = FirebaseFirestore.instance
        .collection('jobs')
        .orderBy('createdAt', descending: true)
        .limit(100);
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: query.snapshots(),
      builder: (context, snap) {
        if (snap.hasError) {
          return _CenterMessage(
            icon: Icons.cloud_off,
            text: 'Couldn\'t reach Firestore: ${snap.error}',
          );
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final docs = snap.data!.docs;
        if (docs.isEmpty) {
          return const _CenterMessage(
            icon: Icons.inbox,
            text: 'No jobs yet — submit one from the web app.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: docs.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (context, i) => _JobRow(doc: docs[i]),
        );
      },
    );
  }
}

class _JobRow extends StatelessWidget {
  const _JobRow({required this.doc});

  final QueryDocumentSnapshot<Map<String, dynamic>> doc;

  @override
  Widget build(BuildContext context) {
    final data = doc.data();
    final status = (data['status'] as String?) ?? 'QUEUED';
    final completed = (data['completedSimCount'] as num?)?.toInt() ?? 0;
    final total = (data['totalSimCount'] as num?)?.toInt() ?? 0;
    final progress = total == 0 ? 0.0 : (completed / total).clamp(0.0, 1.0);
    final deckNames = _deckNames(data);
    final createdAt = _toDate(data['createdAt']);
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CloudJobDetailScreen(jobId: doc.id)),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF111827),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _StatusBadge(status: status),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    deckNames.isEmpty ? '(no decks)' : deckNames.join(' vs '),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _relativeTime(createdAt),
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: LinearProgressIndicator(
                      value: progress,
                      minHeight: 4,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '$completed / $total sims',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _CenterMessage extends StatelessWidget {
  const _CenterMessage({required this.icon, required this.text});

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

DateTime? _toDate(Object? raw) {
  if (raw is Timestamp) return raw.toDate();
  if (raw is DateTime) return raw;
  return null;
}

String _relativeTime(DateTime? when) {
  if (when == null) return '';
  final diff = DateTime.now().difference(when);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inHours < 1) return '${diff.inMinutes}m ago';
  if (diff.inDays < 1) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return '${when.year}-${when.month.toString().padLeft(2, '0')}-${when.day.toString().padLeft(2, '0')}';
}
